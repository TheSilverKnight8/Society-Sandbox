import type { BuildingKind } from './buildings';
import type { BuildingDetails, CreatureDetails, CreatureKind, CultureEdit, DisasterKind, EffectKind, FromSim, NationEdit, NationOrder, Order, PersonDetails, PersonEdit, RecordEntry, SettlementDetails, SimState, Snapshot, SoldierKind, Speed, Toggles, ToSim, WeatherView } from './types';

type SettlementOrder = Extract<ToSim, { type: 'settlementOrder' }>['order'];

// The app's side of the simulation: starts the worker, sends it commands, and keeps the
// last two snapshots so people can be drawn moving smoothly between steps.

export class SimClient {
  private worker: Worker;
  private prev: Snapshot | null = null;
  private curr: Snapshot | null = null;
  private currAt = 0;
  /** Milliseconds between the last snapshots, smoothed. */
  private interval = 100;
  private prevIndex = new Map<number, number>();
  private currIndex = new Map<number, number>();
  private saveWaiters = new Map<number, (r: { state: SimState; deposit: Uint8Array }) => void>();
  private req = 0;
  speed: Speed = 0;
  /** Recent blows (a swing landing, or an arrow, bolt or stone in flight) and people fallen in battle, with when they came. */
  shots: { x0: number; y0: number; x1: number; y1: number; kind: number; at: number }[] = [];
  falls: { x: number; y: number; look: number; gear: number; male: boolean; at: number }[] = [];
  onSnapshot?: (s: Snapshot) => void;
  onWatched?: (p: PersonDetails | null, died?: string) => void;
  onWatchedSettlement?: (s: SettlementDetails | null) => void;
  onWatchedBuilding?: (b: BuildingDetails | null) => void;
  onWatchedCreature?: (c: CreatureDetails | null) => void;
  /** Called when entries are added to the record. */
  onRecord?: (entries: RecordEntry[]) => void;
  onError?: (message: string) => void;
  /** The weather and disasters as last sent (they are sent only when they change). */
  weather: WeatherView | null = null;
  /** When an earthquake was last felt (for shaking the view), and where. */
  quake: { tile: number; at: number } | null = null;
  private prevCreatureIndex = new Map<number, number>();
  private currCreatureIndex = new Map<number, number>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromSim>) => this.receive(e.data);
  }

  private send(m: ToSim, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  private receive(m: FromSim) {
    switch (m.type) {
      case 'snap': {
        const now = performance.now();
        if (this.curr) this.interval = this.interval * 0.7 + Math.min(400, now - this.currAt) * 0.3;
        this.prev = this.curr;
        this.prevIndex = this.currIndex;
        this.curr = m;
        this.currAt = now;
        this.currIndex = new Map();
        for (let k = 0; k < m.ids.length; k++) this.currIndex.set(m.ids[k], k);
        // Blows and the fallen, kept a little while for drawing (Caleb after Stage 5: combat animations).
        for (let k = 0; k + 4 < m.shots.length; k += 5) this.shots.push({ x0: m.shots[k], y0: m.shots[k + 1], x1: m.shots[k + 2], y1: m.shots[k + 3], kind: m.shots[k + 4], at: now + Math.random() * 60 });
        for (let k = 0; k + 4 < m.falls.length; k += 5) this.falls.push({ x: m.falls[k], y: m.falls[k + 1], look: m.falls[k + 2], gear: m.falls[k + 3], male: m.falls[k + 4] === 1, at: now });
        if (this.shots.length > 800) this.shots.splice(0, this.shots.length - 800);
        if (this.falls.length > 300) this.falls.splice(0, this.falls.length - 300);
        this.prevCreatureIndex = this.currCreatureIndex;
        this.currCreatureIndex = new Map();
        for (let k = 0; k + 4 < m.creatures.length; k += 5) this.currCreatureIndex.set(m.creatures[k], k);
        if (m.weather) this.weather = m.weather;
        if (m.quake !== undefined) this.quake = { tile: m.quake, at: now };
        if (m.record) this.onRecord?.(m.record);
        this.onSnapshot?.(m);
        break;
      }
      case 'watched':
        this.onWatched?.(m.person, m.died);
        break;
      case 'watchedSettlement':
        this.onWatchedSettlement?.(m.settlement);
        break;
      case 'watchedBuilding':
        this.onWatchedBuilding?.(m.building);
        break;
      case 'watchedCreature':
        this.onWatchedCreature?.(m.creature);
        break;
      case 'saved':
        this.saveWaiters.get(m.req)?.({ state: m.state, deposit: m.deposit });
        this.saveWaiters.delete(m.req);
        break;
      case 'error':
        this.onError?.(m.message);
        break;
    }
  }

  init(size: number, terrain: Uint8Array, elevation: Uint8Array, deposit: Uint8Array, state: SimState) {
    this.prev = this.curr = null;
    this.speed = 0;
    // The worker gets its own copies; the app keeps its tiles for drawing.
    this.send({ type: 'init', size, terrain: terrain.slice(), elevation: elevation.slice(), deposit: deposit.slice(), state });
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    this.send({ type: 'speed', speed });
  }

  place(tiles: number[]) {
    if (tiles.length) this.send({ type: 'place', tiles });
  }

  remove(tiles: number[]) {
    if (tiles.length) this.send({ type: 'remove', tiles });
  }

  removePerson(id: number) {
    this.send({ type: 'removePerson', id });
  }

  watch(id: number | null) {
    this.send({ type: 'watch', id });
  }

  edit(id: number, edit: PersonEdit) {
    this.send({ type: 'edit', id, edit });
  }

  order(ids: number[], order: Order | { kind: 'stop' }) {
    if (ids.length) this.send({ type: 'order', ids, order });
  }

  /** IDs of everyone whose position (blended for drawing) passes the test. */
  idsWhere(now: number, test: (x: number, y: number) => boolean): number[] {
    const out: number[] = [];
    this.forEach(now, (_k, id, x, y) => {
      if (test(x, y)) out.push(id);
    });
    return out;
  }

  placeBuilding(kind: BuildingKind, tile: number, rot: 0 | 1) {
    this.send({ type: 'placeBuilding', kind, tile, rot });
  }

  removeBuildings(tiles: number[]) {
    if (tiles.length) this.send({ type: 'removeBuildings', tiles });
  }

  watchBuilding(id: number | null) {
    this.send({ type: 'watchBuilding', id });
  }

  watchSettlement(id: number | null) {
    this.send({ type: 'watchSettlement', id });
  }

  settlementOrder(id: number, order: SettlementOrder) {
    this.send({ type: 'settlementOrder', id, order });
  }

  nationEdit(id: number, edit: NationEdit) {
    this.send({ type: 'nationEdit', id, edit });
  }

  placeSoldiers(tiles: number[], kind: SoldierKind) {
    if (tiles.length) this.send({ type: 'placeSoldiers', tiles, kind });
  }

  placeNation(settlement: number) {
    this.send({ type: 'placeNation', settlement });
  }

  nationOrder(id: number, order: NationOrder) {
    this.send({ type: 'nationOrder', id, order });
  }

  cultureEdit(id: number, edit: CultureEdit) {
    this.send({ type: 'cultureEdit', id, edit });
  }

  /** Sets a disaster going at a tile (SPEC 4). */
  disaster(kind: DisasterKind, tile: number) {
    this.send({ type: 'disaster', kind, tile });
  }

  /** Sets an effect going over some tiles: weather, sickness or healing (SPEC 4). */
  effect(kind: EffectKind, tiles: number[]) {
    if (tiles.length) this.send({ type: 'effect', kind, tiles });
  }

  placeCreatures(tiles: number[], kind: CreatureKind) {
    if (tiles.length) this.send({ type: 'placeCreatures', tiles, kind });
  }

  placeCriminals(tiles: number[]) {
    if (tiles.length) this.send({ type: 'placeCriminals', tiles });
  }

  watchCreature(id: number | null) {
    this.send({ type: 'watchCreature', id });
  }

  setToggles(toggles: Toggles) {
    this.send({ type: 'toggles', toggles });
  }

  unpair(id: number) {
    this.send({ type: 'unpair', id });
  }

  spawnTest(n: number, x: number, y: number) {
    this.send({ type: 'spawnTest', n, x, y });
  }

  /** Everything the worker would save, as it is now. */
  save(): Promise<{ state: SimState; deposit: Uint8Array }> {
    const req = ++this.req;
    return new Promise((resolve) => {
      this.saveWaiters.set(req, resolve);
      this.send({ type: 'save', req });
    });
  }

  get latest() {
    return this.curr;
  }

  get population() {
    return this.curr?.ids.length ?? 0;
  }

  /**
   * Calls `fn` for each person with their position blended between the last two
   * snapshots, so movement looks smooth between steps.
   */
  forEach(now: number, fn: (k: number, id: number, x: number, y: number, look: number, flags: number, gear: number) => void) {
    const c = this.curr;
    if (!c) return;
    const p = this.prev;
    const a = this.speed === 0 || !p ? 1 : Math.max(0, Math.min(1, (now - this.currAt) / this.interval));
    for (let k = 0; k < c.ids.length; k++) {
      const id = c.ids[k];
      let x = c.pos[k * 2];
      let y = c.pos[k * 2 + 1];
      if (a < 1 && p) {
        const j = this.prevIndex.get(id);
        if (j !== undefined) {
          const px = p.pos[j * 2];
          const py = p.pos[j * 2 + 1];
          x = px + (x - px) * a;
          y = py + (y - py) * a;
        }
      }
      fn(k, id, x, y, c.look[k], c.flags[k], c.gear ? c.gear[k] : 0);
    }
  }

  /** Calls `fn` for each animal, its position blended between the last two snapshots. */
  forEachCreature(now: number, fn: (id: number, x: number, y: number, kind: number, flags: number) => void) {
    const c = this.curr;
    if (!c || !c.creatures) return;
    const p = this.prev;
    const a = this.speed === 0 || !p ? 1 : Math.max(0, Math.min(1, (now - this.currAt) / this.interval));
    const cr = c.creatures;
    for (let k = 0; k + 4 < cr.length; k += 5) {
      const id = cr[k];
      let x = cr[k + 1];
      let y = cr[k + 2];
      if (a < 1 && p && p.creatures) {
        const j = this.prevCreatureIndex.get(id);
        if (j !== undefined) {
          const px = p.creatures[j + 1];
          const py = p.creatures[j + 2];
          x = px + (x - px) * a;
          y = py + (y - py) * a;
        }
      }
      fn(id, x, y, cr[k + 3], cr[k + 4]);
    }
  }

  destroy() {
    this.worker.terminate();
  }
}
