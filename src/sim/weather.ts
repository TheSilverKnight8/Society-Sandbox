import { Terrain } from '../map/terrain';
import { ADULT_AGE, ELDER_AGE, MONTHS_PER_YEAR, TICKS_PER_MONTH, TICKS_PER_YEAR, type Front, type Person, type WeatherKind, type WorldWeather } from './types';
import type { World } from './world';

// Weather, seasons and status effects (Stage 6; SPEC 11: effects are status effects and weather;
// Caleb: weather has real effects).
//
// Fronts of rain, snow, storm or fog drift over the map. Rain falls as snow in winter (December to
// February) and over snowfields. Under bad weather people walk more slowly and outdoor work goes
// slower. Droughts settle on a region for months: crops and berries grow slowly there and fires
// spread. Storms throw lightning that can set a building or a forest alight.
//
// Status effects: someone with no home is cold in winter (they do not heal, and lose health in
// snow); someone sick (plague) loses health, may die of it, and passes it to people close by,
// and is not caught by it again for some years after.

/** The weather is looked up per cell of this many tiles a side. */
const CELL = 16;
/** Fronts move, come and go, and the cells are refreshed this often (steps). */
const REFRESH = 25;
/** What the sky is doing over a cell. */
export const Sky = { Clear: 0, Rain: 1, Snow: 2, Storm: 3, Fog: 4 } as const;
/** Walking speed under each sky. */
const WALK = [1, 0.92, 0.8, 0.82, 0.95];
/** How fast outdoor work goes under each sky. */
const WORK = [1, 0.92, 0.78, 0.72, 1];
/** Months a front lasts, and its size (tiles) and drift (tiles a step). */
const FRONT_MONTHS = [1, 3];
const FRONT_R = [8, 22];
const FRONT_SPEED = [0.03, 0.1];
/** Chance at each refresh that a new front forms (when there is room for one), by season. */
const FRONT_CHANCE = [0.35, 0.2, 0.35, 0.3];
/** Chance at each refresh that a storm throws lightning down somewhere under it. */
const LIGHTNING = 0.12;
/** Chance each summer month that a drought begins (sim-triggered events), how big, and how many months. */
const DROUGHT_CHANCE = 0.05;
const DROUGHT_R = [20, 40];
const DROUGHT_MONTHS = [4, 9];

/** Health lost each step by someone cold in snow, and by someone sick. */
const COLD_LOSS = 0.06;
const SICK_LOSS = 0.05;
/** How long a sickness lasts (steps), and how long they are safe from it after. */
const SICK_STEPS = [120, 240];
const IMMUNE = 10 * TICKS_PER_YEAR;
/** How near (tiles) and how likely (each look, every 10 steps) a sickness passes to someone. */
const SPREAD_RANGE = 2;
const SPREAD_CHANCE = 0.06;
/** Chance each month of dying of the sickness: grown-ups, and the very young and the old. */
const SICK_DEATH = 0.03;
const SICK_DEATH_FRAIL = 0.08;

export class Weather {
  private w: World;
  readonly st: WorldWeather;
  private cols: number;
  /** The sky over each cell, and whether a drought is on it. */
  readonly sky: Uint8Array;
  readonly dry: Uint8Array;
  /** The weather changed since the app last heard. */
  changed = true;
  /** How many people are sick (sickness only spreads when someone is). */
  private sick = 0;

  constructor(w: World) {
    this.w = w;
    w.state.weather ??= { fronts: [], droughts: [], nextFrontId: 1 };
    this.st = w.state.weather;
    this.cols = Math.ceil(w.size / CELL);
    this.sky = new Uint8Array(this.cols * this.cols);
    this.dry = new Uint8Array(this.cols * this.cols);
    for (const p of w.state.people) if (p.sick) this.sick++;
    this.refresh();
  }

  // ---------------------------------------------------------------- seasons

  month() {
    return Math.floor(this.w.state.tick / TICKS_PER_MONTH) % MONTHS_PER_YEAR;
  }

  /** 0 spring (March to May), 1 summer, 2 autumn, 3 winter (December to February). */
  season() {
    return Math.floor(((this.month() + 10) % 12) / 3);
  }

  winter() {
    return this.season() === 3;
  }

  // ---------------------------------------------------------------- every step

  step() {
    const tick = this.w.state.tick;
    if (tick % REFRESH === 0) this.move();
    if (tick % TICKS_PER_MONTH === 7) this.monthly();
    if (this.sick > 0 && tick % 10 === 3) this.spread();
  }

  /** Fronts drift, pass, and form; storms throw lightning; the cells are refreshed. */
  private move() {
    const w = this.w;
    const st = this.st;
    const tick = w.state.tick;
    st.fronts = st.fronts.filter((f) => f.until > tick && f.x > -f.r && f.y > -f.r && f.x < w.size + f.r && f.y < w.size + f.r);
    for (const f of st.fronts) {
      f.x += f.vx * REFRESH;
      f.y += f.vy * REFRESH;
    }
    const most = 2 + Math.floor(w.size / 128);
    if (st.fronts.length < most && w.rand.next() < FRONT_CHANCE[this.season()]) {
      const roll = w.rand.next();
      const kind: WeatherKind = roll < 0.15 ? 'storm' : roll < 0.3 ? 'fog' : 'rain';
      this.addFront(kind, w.rand.next() * w.size, w.rand.next() * w.size, between(FRONT_R, w.rand.next()), Math.round(between(FRONT_MONTHS, w.rand.next()) * TICKS_PER_MONTH), true);
    }
    // Lightning (a disaster, so only when sim-triggered events are on).
    if (w.toggles.events) {
      for (const f of st.fronts) {
        if (f.kind !== 'storm' || w.rand.next() >= LIGHTNING) continue;
        const a = w.rand.next() * Math.PI * 2;
        const r = Math.sqrt(w.rand.next()) * f.r;
        const x = Math.floor(f.x + Math.cos(a) * r);
        const y = Math.floor(f.y + Math.sin(a) * r);
        if (x >= 0 && y >= 0 && x < w.size && y < w.size) w.disasters.lightning(y * w.size + x);
      }
    }
    this.refresh();
  }

  /** A new front: of a kind, at (x, y), lasting some steps; drifting, or staying put (one the player made). */
  addFront(kind: WeatherKind, x: number, y: number, r: number, steps: number, drift: boolean): Front {
    const w = this.w;
    const a = w.rand.next() * Math.PI * 2;
    const v = drift ? between(FRONT_SPEED, w.rand.next()) : 0;
    const f: Front = { id: this.st.nextFrontId++, kind, x, y, r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, until: w.state.tick + steps };
    this.st.fronts.push(f);
    return f;
  }

  /** Works out the sky over each cell, and where droughts are. */
  refresh() {
    const cols = this.cols;
    this.sky.fill(Sky.Clear);
    this.dry.fill(0);
    const winter = this.winter();
    const terrain = this.w.terrain;
    const size = this.w.size;
    for (const f of this.st.fronts) {
      this.cover(f.x, f.y, f.r, (c, cx, cy) => {
        let s: number = f.kind === 'storm' ? Sky.Storm : f.kind === 'fog' ? Sky.Fog : f.kind === 'snow' ? Sky.Snow : Sky.Rain;
        // Rain falls as snow in winter, and over snowfields.
        if (s === Sky.Rain) {
          const mid = Math.min(size - 1, cy * CELL + CELL / 2) * size + Math.min(size - 1, cx * CELL + CELL / 2);
          if (winter || terrain[mid] === Terrain.Snow) s = Sky.Snow;
        }
        // Storms and snow outweigh rain, and rain outweighs fog.
        if (rank(s) > rank(this.sky[c])) this.sky[c] = s;
      });
    }
    for (const d of this.st.droughts) this.cover(d.x, d.y, d.r, (c) => (this.dry[c] = 1));
    void cols;
    this.changed = true;
  }

  private cover(x: number, y: number, r: number, mark: (cell: number, cx: number, cy: number) => void) {
    const cols = this.cols;
    const x0 = Math.max(0, Math.floor((x - r) / CELL));
    const x1 = Math.min(cols - 1, Math.floor((x + r) / CELL));
    const y0 = Math.max(0, Math.floor((y - r) / CELL));
    const y1 = Math.min(cols - 1, Math.floor((y + r) / CELL));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        // The cell's nearest point to the middle is within the radius.
        const nx = Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL));
        const ny = Math.max(cy * CELL, Math.min(y, (cy + 1) * CELL));
        if ((nx - x) ** 2 + (ny - y) ** 2 <= r * r) mark(cy * cols + cx, cx, cy);
      }
    }
  }

  /** Droughts end, and (sim-triggered events) begin in summer. */
  private monthly() {
    const w = this.w;
    const tick = w.state.tick;
    const before = this.st.droughts.length;
    this.st.droughts = this.st.droughts.filter((d) => d.until > tick);
    if (w.toggles.events && this.season() === 1 && w.rand.next() < DROUGHT_CHANCE) {
      const tile = w.disasters.randomLand();
      if (tile >= 0) this.drought(tile);
    }
    if (this.st.droughts.length !== before) this.refresh();
  }

  /** A drought settles on the land around a tile. */
  drought(tile: number, months?: number) {
    const w = this.w;
    const x = (tile % w.size) + 0.5;
    const y = Math.floor(tile / w.size) + 0.5;
    const m = months ?? Math.round(between(DROUGHT_MONTHS, w.rand.next()));
    this.st.droughts.push({ x, y, r: between(DROUGHT_R, w.rand.next()), until: w.state.tick + m * TICKS_PER_MONTH });
    this.refresh();
    w.record.add('disaster', `A drought settled on the land${w.disasters.nearName(tile)}.`, tile);
    w.disasters.strikes(tile, 30);
  }

  // ---------------------------------------------------------------- looking up

  private cellAt(t: number) {
    const size = this.w.size;
    const x = t % size;
    return Math.floor((t - x) / size / CELL) * this.cols + Math.floor(x / CELL);
  }

  skyAt(t: number): number {
    return this.sky[this.cellAt(t)];
  }

  dryAt(t: number): boolean {
    return this.dry[this.cellAt(t)] === 1;
  }

  /** How fast someone walks on this tile under the weather (1 in clear weather). */
  walkFactor(t: number): number {
    return WALK[this.sky[this.cellAt(t)]];
  }

  /** Whether outdoor work on this tile stalls this step for the weather. */
  slowsWork(t: number): boolean {
    const f = WORK[this.sky[this.cellAt(t)]];
    return f < 1 && this.w.rand.next() > f;
  }

  /** How much crops grow here, for the weather and the season: less in drought. */
  growthFactor(t: number): number {
    return this.dryAt(t) ? 0.4 : 1;
  }

  /** Whether berries may grow back on a tile now: not in winter, and seldom in drought. */
  berriesGrow(t: number): boolean {
    if (this.winter()) return false;
    return !this.dryAt(t) || this.w.rand.next() < 0.3;
  }

  // ---------------------------------------------------------------- status effects

  /** Whether someone is cold: out of doors with no home in winter. */
  cold(p: Person): boolean {
    // (Bandits have the tents of their camp.)
    return this.winter() && p.home === undefined && !p.indoors && p.band === undefined;
  }

  /** Whether someone heals this step (not while cold or sick). */
  heals(p: Person): boolean {
    return !p.sick && !this.cold(p);
  }

  /** Each step for each person: cold and sickness. Returns false if they died of it. */
  person(p: Person): boolean {
    const w = this.w;
    if (p.sick) {
      p.health -= SICK_LOSS;
      if (p.sick <= 1) this.recover(p);
      else p.sick--;
      if ((w.state.tick + p.id) % TICKS_PER_MONTH === 0) {
        const age = w.ageOf(p);
        if (w.rand.next() < (age < 5 || age >= ELDER_AGE ? SICK_DEATH_FRAIL : SICK_DEATH)) p.health = 0;
      }
      if (p.health <= 0) {
        w.kill(p, 'sickness');
        return false;
      }
    }
    if (this.cold(p) && this.skyAt(w.tileOf(p)) === Sky.Snow) {
      p.health -= COLD_LOSS;
      if (p.health <= 0) {
        w.kill(p, 'cold');
        return false;
      }
    }
    return true;
  }

  /** Someone falls sick (unless they have had it lately). Returns whether they did. */
  sicken(p: Person, force = false): boolean {
    if (p.sick) return false;
    if (!force && p.immune !== undefined && p.immune > this.w.state.tick) return false;
    p.sick = Math.round(between(SICK_STEPS, this.w.rand.next()));
    this.sick++;
    return true;
  }

  /** Someone gets over a sickness, and is safe from it for a while. */
  recover(p: Person) {
    if (!p.sick) return;
    delete p.sick;
    p.immune = this.w.state.tick + IMMUNE;
    this.sick = Math.max(0, this.sick - 1);
  }

  /** Someone sick has died or gone. */
  onGone(p: Person) {
    if (p.sick) this.sick = Math.max(0, this.sick - 1);
  }

  /** Sickness passes from the sick to people close by. */
  private spread() {
    const w = this.w;
    const people = w.state.people;
    const grid = new Map<number, Person[]>();
    const key = (x: number, y: number) => Math.floor(y / 4) * 4096 + Math.floor(x / 4);
    const sick: Person[] = [];
    for (const p of people) {
      if (p.sick) sick.push(p);
      const k = key(p.x, p.y);
      const list = grid.get(k);
      if (list) list.push(p);
      else grid.set(k, [p]);
    }
    this.sick = sick.length;
    for (const p of sick) {
      const cx = Math.floor(p.x / 4);
      const cy = Math.floor(p.y / 4);
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (const q of grid.get(gy * 4096 + gx) ?? []) {
            if (q.sick || q === p || (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > SPREAD_RANGE * SPREAD_RANGE) continue;
            // Children and the old catch it more easily.
            const age = w.ageOf(q);
            const chance = SPREAD_CHANCE * (age < ADULT_AGE || age >= ELDER_AGE ? 1.3 : 1);
            if (w.rand.next() < chance) this.sicken(q);
          }
        }
      }
    }
  }

  /** Status effects shown in the inspect panel. */
  statusOf(p: Person): string[] {
    const out: string[] = [];
    if (p.sick) out.push('Sick');
    if (this.cold(p)) out.push('Cold');
    if (p.health < 50 && !p.sick && p.food > 30) out.push('Wounded');
    if (p.food < 15) out.push('Starving');
    return out;
  }

  // ---------------------------------------------------------------- the player's effects

  /** Sets weather over some tiles (SPEC 4: effects): rain, snow or fog for two months, or clears it (ending a drought there too). */
  setWeather(kind: 'rain' | 'snow' | 'fog' | 'clear', tiles: number[]) {
    if (!tiles.length) return;
    const size = this.w.size;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const t of tiles) {
      const x = t % size;
      const y = Math.floor(t / size);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const cx = (x0 + x1 + 1) / 2;
    const cy = (y0 + y1 + 1) / 2;
    const r = Math.max(4, Math.hypot(x1 - x0 + 1, y1 - y0 + 1) / 2);
    if (kind === 'clear') {
      const near = (o: { x: number; y: number; r: number }) => (o.x - cx) ** 2 + (o.y - cy) ** 2 < (o.r + r) ** 2;
      this.st.fronts = this.st.fronts.filter((f) => !near(f));
      this.st.droughts = this.st.droughts.filter((d) => !near(d));
    } else {
      this.addFront(kind, cx, cy, r, 2 * TICKS_PER_MONTH, false);
    }
    this.refresh();
  }

  /** What the app draws. */
  fronts() {
    const winter = this.winter();
    return this.st.fronts.map((f) => ({ kind: f.kind === 'rain' && winter ? ('snow' as WeatherKind) : f.kind, x: f.x, y: f.y, r: f.r }));
  }
}

function between([a, b]: number[], r: number) {
  return a + (b - a) * r;
}

/** Which sky shows when fronts overlap. */
function rank(s: number) {
  return s === Sky.Storm ? 4 : s === Sky.Snow ? 3 : s === Sky.Rain ? 2 : s === Sky.Fog ? 1 : 0;
}
