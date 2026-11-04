import { hash2 } from '../lib/rng';
import { Deposit, Terrain, isWater } from '../map/terrain';
import { BUILDINGS, BuildingKind, STAGES, STAGE_NEEDS, anchorFor, footprint, kindAllowsTerrain, needsShore, settlementName, type BuildingDef } from './buildings';
import { Economy } from './economy';
import { ADULT_AGE, TICKS_PER_MONTH, TICKS_PER_YEAR, TileField, Wall, type Building, type BuildingView, type Person, type Settlement, type SettlementDetails, type SettlementOrder, type SettlementView } from './types';
import type { World } from './world';

// Settlements, buildings and building work (Stage 3a; SPEC 7 and 8).
//
// An unsettled pair living somewhere with no settlement near founds a camp: a campfire with
// a little land around it. Unsettled people who come near a settlement join it. Each
// month a settlement looks at itself: it grows its land with its people and buildings,
// moves up a stage when it is big enough (camp, village, town, city), and plans what to
// build: homes for the homeless, a storehouse once it is a village, and anything it has
// been ordered to build. Its adults build: they cut trees and break stone, carry the
// wood and stone to the site, and then put the building up. A finished home takes in a
// family, who sleep there (their shelter need is met). Jobs, workplaces and the store are
// in economy.ts (Stage 3b).

/** Wood from one tree, and stone broken in one go. */
const WOOD_PER_TREE = 3;
const STONE_PER_TRIP = 2;
const STONE_PER_DEPOSIT = 20;
const CHOP_STEPS = 40;
const QUARRY_STEPS = 50;
/** A builder works this long before thinking again about their needs. */
const BUILD_SPELL = 100;
const MAX_BUILDERS = 4;
/** Chance each month that a forest tile short of trees grows one back. */
const TREE_REGROW = 0.04;
/** How near (tiles) a settlement's middle must be for an unsettled person to join it, and how far apart new ones are founded. */
const JOIN_RANGE = 12;
const FOUND_GAP = 20;
const FOUND_CHANCE = 0.2;
/** How far builders go for wood and stone. */
const WOOD_RANGE = 60;
/** A pair only founds a camp with trees this near (tiles), so it can build. */
const FOUND_WOOD_RANGE = 30;
/** Trees are counted in cells of this many tiles a side, so searches skip treeless land at once. */
const TREE_CELL = 16;
const STONE_RANGE = 40;
/** How far from home someone will walk to sleep in it. */
const HOME_RANGE = 40;

/** Terrain a building can stand on. */
function buildableTerrain(t: number) {
  return t === Terrain.Grassland || t === Terrain.Sand || t === Terrain.Desert || t === Terrain.Hills || t === Terrain.Forest;
}

/** How many trees the map shows on a forest tile at most (the same rule the drawing uses). */
export function maxTrees(x: number, y: number) {
  const r = hash2(x, y, 3);
  return r < 0.25 ? 2 : r < 0.82 ? 1 : 0;
}

export class Towns {
  private w: World;
  readonly settlements: Settlement[];
  readonly buildings: Building[];
  private sById = new Map<number, Settlement>();
  private bById = new Map<number, Building>();
  /** Buildings by tile. */
  private bByTile = new Map<number, Building>();
  readonly territory: Uint16Array;
  readonly trees: Uint8Array;
  /** Fences and gates on each tile (towns and cities). */
  readonly walls: Uint8Array;
  private treeTiles: number[] = [];
  private treeCursor = 0;
  /** Forest tiles with trees possible, by cell, and how many trees stand in each cell. */
  private treeCells: number[][] = [];
  private treeCount: Int32Array;
  private stoneTiles: number[] = [];
  /**
   * Worked out afresh (at most once a step) from what people are doing: people heading for
   * each tree or stone tile, builders at each site, and wood and stone on the way to each
   * site. Counting from people, rather than keeping tallies, means nothing is left counted
   * when someone dies or gives up on the way.
   */
  private resClaims = new Map<number, number>();
  private siteWorkers = new Map<number, number>();
  private incoming = new Map<number, { wood: number; stone: number; tools?: number }>();
  private bookTick = -1;
  /** Last monthly count of people and homes per settlement. */
  private counts = new Map<number, { people: number; housed: number; homes: number; homeBuildings: number }>();
  /** How many people live in each home. */
  private occupants = new Map<number, number>();
  buildingsChanged = true;
  settlementsChanged = true;
  readonly economy: Economy;

  constructor(w: World) {
    this.w = w;
    const st = w.state;
    const n = w.size * w.size;
    st.settlements ??= [];
    st.buildings ??= [];
    st.nextSettlementId ??= 1;
    st.nextBuildingId ??= 1;
    this.settlements = st.settlements;
    this.buildings = st.buildings;
    for (const s of this.settlements) this.sById.set(s.id, s);
    for (const b of this.buildings) this.index(b);
    this.territory = st.territory && st.territory.length === n ? st.territory : new Uint16Array(n);
    this.walls = st.walls && st.walls.length === n ? st.walls : new Uint8Array(n);
    st.walls = this.walls;
    st.territory = this.territory;
    const cells = Math.ceil(w.size / TREE_CELL);
    this.treeCells = Array.from({ length: cells * cells }, () => []);
    this.treeCount = new Int32Array(cells * cells);
    const freshTrees = !st.trees || st.trees.length !== n;
    this.trees = freshTrees ? new Uint8Array(n) : st.trees!;
    st.trees = this.trees;
    for (let i = 0; i < n; i++) {
      const x = i % w.size;
      const y = (i - x) / w.size;
      if (w.terrain[i] === Terrain.Forest) {
        const m = maxTrees(x, y);
        if (m > 0) {
          this.treeTiles.push(i);
          if (freshTrees) this.trees[i] = m;
          const c = Math.floor(y / TREE_CELL) * cells + Math.floor(x / TREE_CELL);
          this.treeCells[c].push(i);
          this.treeCount[c] += this.trees[i];
        }
      }
      if (w.deposit[i] === Deposit.Stone) this.stoneTiles.push(i);
    }
    this.recount();
    this.economy = new Economy(w, this);
  }

  byId(id: number) {
    return this.sById.get(id);
  }

  /** People living in a settlement, as of the last monthly count. */
  peopleOf(s: Settlement) {
    return this.counts.get(s.id)?.people ?? 0;
  }

  byBuildingId(id: number) {
    return this.bById.get(id);
  }

  /** The tile at the middle of a building's footprint. */
  middleTile(b: Building) {
    const { w, d } = footprint(b.kind, b.rot);
    return b.tile + Math.floor(d / 2) * this.w.size + Math.floor(w / 2);
  }

  /** Where to stand to work a tile that cannot be walked on (fish in deep water): a walkable tile beside it. */
  approach(t: number) {
    const a = this.w.approach(t);
    return a >= 0 ? a : t;
  }

  private treeCell(t: number) {
    const [x, y] = this.tileXY(t);
    return Math.floor(y / TREE_CELL) * Math.ceil(this.w.size / TREE_CELL) + Math.floor(x / TREE_CELL);
  }

  private setTrees(t: number, v: number) {
    this.treeCount[this.treeCell(t)] += v - this.trees[t];
    this.trees[t] = v;
    this.w.tileChange(t, TileField.Trees, v);
  }

  /** The tiles a building stands on. */
  tilesOf(b: { kind: BuildingKind; tile: number; rot?: number }): number[] {
    const { w, d } = footprint(b.kind, b.rot);
    const size = this.w.size;
    const x0 = b.tile % size;
    const y0 = (b.tile - x0) / size;
    const out: number[] = [];
    for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) out.push(y * size + x);
    return out;
  }

  private index(b: Building) {
    this.bById.set(b.id, b);
    for (const t of this.tilesOf(b)) this.bByTile.set(t, b);
  }

  /** Fresh stone deposits start with this much stone. */
  static stoneStock() {
    return STONE_PER_DEPOSIT;
  }

  private def(b: Building): BuildingDef {
    return BUILDINGS[b.kind];
  }

  private tileXY(t: number): [number, number] {
    const x = t % this.w.size;
    return [x, (t - x) / this.w.size];
  }

  dist2(a: number, b: number) {
    const [ax, ay] = this.tileXY(a);
    const [bx, by] = this.tileXY(b);
    return (ax - bx) ** 2 + (ay - by) ** 2;
  }

  /** Whether a building could go on this tile (for a settlement, or placed by the player). */
  buildable(t: number) {
    const w = this.w;
    if (t < 0 || t >= w.terrain.length) return false;
    const ter = w.terrain[t];
    if (isWater(ter) || !buildableTerrain(ter) || this.bByTile.has(t)) return false;
    // Forest can be built on: its trees are cleared when building starts (their wood goes into the building).
    if (this.walls[t] !== Wall.None) return false;
    return true;
  }

  /**
   * Whether a building of this footprint fits with its corner at `anchor`: every tile
   * buildable and the ground no more than one level uneven. With `owner`, every tile must be
   * that settlement's (or nobody's, if `allowFree`). With `lanes`, no other building may touch
   * it, so a path stays open around every building.
   */
  areaFree(anchor: number, w: number, d: number, owner?: number, allowFree = false, lanes = false, kind?: BuildingKind): boolean {
    const size = this.w.size;
    const x0 = anchor % size;
    const y0 = (anchor - x0) / size;
    if (x0 < 0 || y0 < 0 || x0 + w > size || y0 + d > size) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = y0; y < y0 + d; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const t = y * size + x;
        if (!this.buildable(t)) return false;
        if (kind !== undefined && !kindAllowsTerrain(kind, this.w.terrain[t], true)) return false;
        if (owner !== undefined && this.territory[t] !== owner && !(allowFree && this.territory[t] === 0)) return false;
        const e = this.w.elevation[t];
        lo = Math.min(lo, e);
        hi = Math.max(hi, e);
      }
    }
    if (hi - lo > 1) return false;
    if (kind !== undefined && needsShore(kind) && !this.economy.shoreSpot(anchor, w, d)) return false;
    if (lanes) {
      for (let y = y0 - 1; y <= y0 + d; y++) {
        for (let x = x0 - 1; x <= x0 + w; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + d) continue;
          if (this.bByTile.has(y * size + x)) return false;
        }
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- every step

  step() {
    const st = this.w.state;
    this.regrowTrees();
    if (st.tick % TICKS_PER_MONTH === 0) this.recount();
    for (const s of this.settlements) {
      if (!s.abandoned && (st.tick + s.id * 7) % TICKS_PER_MONTH === 0) this.manage(s);
    }
  }

  private regrowTrees() {
    const tiles = this.treeTiles;
    if (!tiles.length) return;
    const per = Math.ceil(tiles.length / TICKS_PER_MONTH);
    for (let k = 0; k < per; k++) {
      const i = tiles[this.treeCursor];
      this.treeCursor = (this.treeCursor + 1) % tiles.length;
      const [x, y] = this.tileXY(i);
      if (this.trees[i] < maxTrees(x, y) && !this.bByTile.has(i) && this.walls[i] === Wall.None && this.w.rand.next() < TREE_REGROW) this.setTrees(i, this.trees[i] + 1);
    }
  }

  /** Counts each settlement's people and homes, and who lives in each home. */
  private recount() {
    this.counts.clear();
    this.occupants.clear();
    for (const s of this.settlements) this.counts.set(s.id, { people: 0, housed: 0, homes: 0, homeBuildings: 0 });
    for (const b of this.buildings) {
      if (b.progress < 1 || b.settlement === undefined) continue;
      const c = this.counts.get(b.settlement);
      if (c && this.def(b).homes) {
        c.homes += this.def(b).homes;
        c.homeBuildings++;
      }
    }
    for (const p of this.w.state.people) {
      if (p.home !== undefined && !this.bById.has(p.home)) delete p.home;
      if (p.settlement === undefined) continue;
      const c = this.counts.get(p.settlement);
      if (!c) {
        delete p.settlement;
        delete p.home;
        continue;
      }
      c.people++;
      if (p.home !== undefined) {
        c.housed++;
        this.occupants.set(p.home, (this.occupants.get(p.home) ?? 0) + 1);
      }
    }
    this.settlementsChanged = true;
  }

  // ---------------------------------------------------------------- settlements

  /** Founds a settlement at a tile: a campfire and a little land. */
  found(tile: number, founders: Person[]): Settlement | null {
    const w = this.w;
    if (!this.buildable(tile)) {
      // Look for a free tile close by.
      let best = -1;
      const [x, y] = this.tileXY(tile);
      for (let r = 1; r <= 3 && best < 0; r++) {
        for (let dy = -r; dy <= r && best < 0; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w.size || yy >= w.size) continue;
            const t = yy * w.size + xx;
            if (this.buildable(t) && this.territory[t] === 0) {
              best = t;
              break;
            }
          }
        }
      }
      if (best < 0) return null;
      tile = best;
    }
    const st = w.state;
    const s: Settlement = { id: st.nextSettlementId!++, name: settlementName(w.rand.next), stage: 'camp', center: tile, founded: st.tick, focus: 'balanced', queue: [] };
    this.settlements.push(s);
    this.sById.set(s.id, s);
    this.counts.set(s.id, { people: 0, housed: 0, homes: 0, homeBuildings: 0 });
    this.addBuilding(BuildingKind.Campfire, tile, s.id, true);
    this.claim(s, 3);
    for (const p of founders) this.join(p, s);
    this.settlementsChanged = true;
    return s;
  }

  private join(p: Person, s: Settlement) {
    p.settlement = s.id;
    delete p.home;
    const c = this.counts.get(s.id);
    if (c) c.people++;
    // Their children who have no settlement come with them.
    for (const q of this.w.state.people) {
      if (q.settlement === undefined && (q.mother === p.id || q.father === p.id) && this.w.ageOf(q) < ADULT_AGE) {
        q.settlement = s.id;
        if (c) c.people++;
      }
    }
  }

  /** Claims the land within `radius` of a settlement's middle that nobody else holds. */
  private claim(s: Settlement, radius: number, around = s.center) {
    const w = this.w;
    const [cx, cy] = this.tileXY(around);
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > radius * radius + 0.5) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
        const t = y * w.size + x;
        if (this.territory[t] !== 0 || isWater(w.terrain[t])) continue;
        this.territory[t] = s.id;
        w.tileChange(t, TileField.Territory, s.id);
        // Buildings nobody owns on newly claimed land become the settlement's.
        const b = this.bByTile.get(t);
        if (b && b.settlement === undefined) {
          b.settlement = s.id;
          this.buildingsChanged = true;
        }
      }
    }
  }

  /** Once a month: land, stage, and what to build next. */
  private manage(s: Settlement) {
    const c = this.counts.get(s.id) ?? { people: 0, housed: 0, homes: 0, homeBuildings: 0 };
    const mine = this.buildings.filter((b) => b.settlement === s.id);
    // Land grows with people and buildings.
    // (Buildings are several tiles across, so land grows faster than people alone would need.)
    const radius = Math.min(22, 4 + Math.floor(Math.sqrt(c.people) * 1.3) + Math.floor(mine.length / 2));
    this.claim(s, radius);
    // Stage up when big enough.
    const next = STAGES[STAGES.indexOf(s.stage) + 1];
    if (next && c.people >= STAGE_NEEDS[next].people && c.homeBuildings >= STAGE_NEEDS[next].homes) {
      s.stage = next;
      this.economy.onStage(s);
      this.settlementsChanged = true;
    }
    // A settlement whose people are all gone stands empty.
    if (c.people === 0 && this.w.state.tick - s.founded > TICKS_PER_YEAR * 2) return;
    this.housePeople(s);
    this.economy.assignJobs(s);
    // Towns and cities fence their built-up middle, looked at again every year (Caleb: fencing and gates for towns and above).
    if ((s.stage === 'town' || s.stage === 'city') && (!s.fencePlan || Math.floor(this.w.state.tick / TICKS_PER_MONTH) % 12 === 0)) this.planFence(s);
    // How many buildings it puts up at once grows with its people (a builder crew per site).
    let sites = mine.filter((b) => b.progress < 1).length;
    const maxSites = Math.min(8, (s.stage === 'camp' ? 1 : 2) + Math.floor(c.people / 20) + (s.focus === 'housing' ? 1 : 0));
    // Ordered buildings first (one more site is allowed for them).
    while (s.queue.length && sites < maxSites + 1) {
      const q = s.queue.shift()!;
      const { w, d } = footprint(q.kind, q.rot);
      if (this.areaFree(q.tile, w, d, undefined, false, false, q.kind)) {
        this.addBuilding(q.kind, q.tile, s.id, false, q.rot);
        sites++;
      }
    }
    // Up to three new sites a month, alternating homes and other buildings so neither waits on the other.
    const stoneNear = this.stoneNear(s.center);
    for (let k = 0; k < 3 && sites < maxSites; k++) {
      const started = k % 2 === 0 ? this.startHome(s, c, stoneNear) || this.startOther(s, c, stoneNear) : this.startOther(s, c, stoneNear) || this.startHome(s, c, stoneNear);
      if (!started) break;
      sites++;
    }
  }

  /** Starts a home if more people lack beds than the homes being built will hold. */
  private startHome(s: Settlement, c: { people: number; housed: number }, stoneNear: boolean): boolean {
    const mine = this.buildings.filter((b) => b.settlement === s.id && b.progress < 1);
    const homeless = c.people - c.housed;
    const planned = mine.reduce((n, b) => n + this.def(b).homes, 0);
    if (homeless <= planned) return false;
    const town = s.stage === 'town' || s.stage === 'city';
    const kind = town && stoneNear && this.economy.stockOf(s).tools >= 2 ? BuildingKind.Townhouse : s.stage !== 'camp' && stoneNear ? BuildingKind.House : BuildingKind.Hut;
    const spot = this.freeSpot(s, kind);
    if (!spot) return false;
    this.addBuilding(kind, spot.tile, s.id, false, spot.rot);
    return true;
  }

  /** Starts a storehouse, or the workplace it most needs. */
  private startOther(s: Settlement, c: { people: number }, stoneNear: boolean): boolean {
    const mine = this.buildings.filter((b) => b.settlement === s.id);
    const hasStore = mine.some((b) => b.kind === BuildingKind.Storehouse);
    if (s.stage !== 'camp' && !hasStore && stoneNear && s.focus !== 'housing') {
      const spot = this.freeSpot(s, BuildingKind.Storehouse);
      if (spot) {
        this.addBuilding(BuildingKind.Storehouse, spot.tile, s.id, false, spot.rot);
        return true;
      }
    }
    // Workplaces (villages and bigger): food first when it is short, then materials.
    for (const work of this.economy.nextWorkplaces(s, c.people, mine)) {
      const spot = this.freeSpot(s, work.kind, work.test);
      if (spot) {
        this.addBuilding(work.kind, spot.tile, s.id, false, spot.rot);
        return true;
      }
    }
    return false;
  }

  private stoneNear(center: number) {
    const r2 = STONE_RANGE * STONE_RANGE;
    return this.stoneTiles.some((t) => this.w.stock[t] > 0 && this.dist2(t, center) <= r2);
  }

  /** A place on the settlement's land for a building, close to its middle, with a lane around it; or null. */
  private freeSpot(s: Settlement, kind: BuildingKind, test?: (anchor: number, w: number, d: number) => boolean): { tile: number; rot: 0 | 1 } | null {
    const w = this.w;
    const [cx, cy] = this.tileXY(s.center);
    for (let r = 2; r <= 22; r++) {
      const options: { tile: number; rot: 0 | 1 }[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
          const center = y * w.size + x;
          for (const rot of [0, 1] as const) {
            const { w: fw, d: fd } = footprint(kind, rot);
            const anchor = anchorFor(kind, rot, center, w.size);
            if (this.areaFree(anchor, fw, fd, s.id, false, true, kind) && (!test || test(anchor, fw, fd))) options.push({ tile: anchor, rot });
          }
        }
      }
      if (options.length) return options[w.rand.int(options.length)];
    }
    return null;
  }

  addBuilding(kind: BuildingKind, tile: number, settlement: number | undefined, finished: boolean, rot: 0 | 1 = 0): Building {
    const st = this.w.state;
    const b: Building = { id: st.nextBuildingId!++, kind, tile, rot, settlement, progress: finished ? 1 : 0, wood: 0, stone: 0 };
    this.buildings.push(b);
    this.index(b);
    // Clearing the ground: trees on the footprint are felled, and their wood goes into the building.
    for (const t of this.tilesOf(b)) {
      if (this.trees[t] > 0) {
        b.wood = Math.min(this.def(b).wood, b.wood + this.trees[t] * WOOD_PER_TREE);
        this.setTrees(t, 0);
      }
    }
    this.buildingsChanged = true;
    if (finished) this.finished(b);
    return b;
  }

  private finished(b: Building) {
    b.progress = 1;
    b.wood = 0;
    b.stone = 0;
    delete b.tools;
    this.buildingsChanged = true;
    const s = b.settlement !== undefined ? this.sById.get(b.settlement) : undefined;
    if (s && this.def(b).homes) {
      const c = this.counts.get(s.id);
      if (c) {
        c.homes += this.def(b).homes;
        c.homeBuildings++;
      }
      this.housePeople(s);
    }
  }

  /** Gives homes with room to the settlement's homeless, a family at a time. */
  private housePeople(s: Settlement) {
    const homes = this.buildings.filter((b) => b.settlement === s.id && b.progress >= 1 && this.def(b).homes > 0);
    if (!homes.length) return;
    const room = (b: Building) => this.def(b).homes - (this.occupants.get(b.id) ?? 0);
    const members = this.w.state.people.filter((p) => p.settlement === s.id);
    // Homeless children by parent, worked out once.
    const kids = new Map<number, Person[]>();
    for (const q of members) {
      if (q.home !== undefined || this.w.ageOf(q) >= ADULT_AGE) continue;
      for (const id of [q.mother, q.father]) {
        if (id === undefined) continue;
        const list = kids.get(id);
        if (list) list.push(q);
        else kids.set(id, [q]);
      }
    }
    for (const p of members) {
      if (p.home !== undefined || this.w.ageOf(p) < ADULT_AGE) continue;
      const partner = p.pair !== undefined ? this.w.byId.get(p.pair) : undefined;
      const family = [p];
      if (partner && partner.settlement === s.id && partner.home === undefined) family.push(partner);
      for (const q of kids.get(p.id) ?? []) if (q.home === undefined && !family.includes(q)) family.push(q);
      const home = homes.find((b) => room(b) >= family.length) ?? homes.find((b) => room(b) >= 1);
      if (!home) return;
      for (const q of family) {
        if (room(home) <= 0) break;
        q.home = home.id;
        this.occupants.set(home.id, (this.occupants.get(home.id) ?? 0) + 1);
        const c = this.counts.get(s.id);
        if (c) c.housed++;
      }
    }
  }

  /** Once a month for each person: unsettled people join a settlement near them, or a pair founds one. */
  monthly(p: Person) {
    if (p.settlement !== undefined) this.economy.monthly(p);
    if (p.settlement !== undefined || p.settleAt !== undefined) return;
    const w = this.w;
    const age = w.ageOf(p);
    if (age < ADULT_AGE) return;
    const here = w.tileOf(p);
    let near: Settlement | null = null;
    let nearD = JOIN_RANGE * JOIN_RANGE;
    let anyClose = false;
    for (const s of this.settlements) {
      if (s.abandoned) continue;
      const d = this.dist2(s.center, here);
      if (d < nearD) {
        nearD = d;
        near = s;
      }
      if (d < FOUND_GAP * FOUND_GAP) anyClose = true;
    }
    if (near) return this.join(p, near);
    if (!w.toggles.founding || anyClose || p.pair === undefined || p.sex !== 0) return;
    const partner = w.byId.get(p.pair);
    if (!partner || partner.settlement !== undefined || !w.near(p, partner, 6) || w.rand.next() > FOUND_CHANCE) return;
    if (this.territory[here] !== 0) return;
    // Only where there is wood to build with.
    if (this.nearestTree(here, FOUND_WOOD_RANGE) < 0) return;
    this.found(here, [p, partner]);
  }

  // ---------------------------------------------------------------- people's work

  /** Gives a settled adult building work, if their settlement has any. Returns true if they took it. */
  work(p: Person): boolean {
    const w = this.w;
    if (p.settlement === undefined || w.ageOf(p) < ADULT_AGE) return false;
    // Already carrying materials: take them to their site.
    if (p.load && p.site !== undefined) {
      const b = this.bById.get(p.site);
      if (b && b.progress < 1) {
        w.goTo(p, b.tile, 'site');
        return true;
      }
      delete p.load;
      delete p.site;
    }
    // Carrying wood for the fence: put it up.
    if (p.load && p.load.kind === 'wood' && p.site === undefined && this.fenceWork(p)) return true;
    if (w.rand.next() > 0.75) return false;
    const sites = this.buildings.filter((b) => b.settlement === p.settlement && b.progress < 1);
    if (!sites.length || w.rand.next() < 0.25) {
      if (this.fenceWork(p)) return true;
      if (!sites.length) return false;
    }
    this.book();
    if (!sites.length) return false;
    // The oldest site this person can help: fetch something it still needs, or build once it has it all.
    for (const site of sites) {
      if (this.helpSite(p, site)) return true;
    }
    return false;
  }

  private helpSite(p: Person, site: Building): boolean {
    const w = this.w;
    if ((this.siteWorkers.get(site.id) ?? 0) >= MAX_BUILDERS) return false;
    const def = this.def(site);
    const inc = this.incoming.get(site.id) ?? { wood: 0, stone: 0 };
    // Take wood, stone and tools from the store when it has some.
    const home = p.settlement !== undefined ? this.sById.get(p.settlement) : undefined;
    const store = home ? this.economy.stockOf(home) : undefined;
    if (home && store) {
      const needTools = (def.tools ?? 0) - (site.tools ?? 0) - (inc.tools ?? 0);
      const kind =
        site.wood + inc.wood < def.wood && store.wood > 0 ? 'wood' : site.stone + inc.stone < def.stone && store.stone > 0 ? 'stone' : needTools > 0 && store.tools > 0 ? 'tools' : null;
      if (kind) {
        if (kind === 'tools') inc.tools = (inc.tools ?? 0) + 1;
        else inc[kind] += 4;
        this.incoming.set(site.id, inc);
        p.site = site.id;
        p.jobStep = kind === 'wood' ? 'fetch-wood' : kind === 'stone' ? 'fetch-stone' : 'fetch-tools';
        w.goTo(p, this.economy.storeTile(home, w.tileOf(p)), 'fetch');
        return true;
      }
    }
    if (site.wood + inc.wood < def.wood) {
      const t = this.nearestTree(site.tile);
      if (t < 0) return false;
      this.claimRes(t, 1);
      inc.wood += WOOD_PER_TREE;
      this.incoming.set(site.id, inc);
      p.site = site.id;
      p.target = t;
      w.goTo(p, t, 'wood');
      return true;
    }
    if (site.stone + inc.stone < def.stone) {
      const t = this.nearestStone(site.tile);
      if (t < 0) return false;
      this.claimRes(t, 1);
      inc.stone += STONE_PER_TRIP;
      this.incoming.set(site.id, inc);
      p.site = site.id;
      p.target = t;
      w.goTo(p, t, 'stone');
      return true;
    }
    if (site.wood >= def.wood && site.stone >= def.stone && (site.tools ?? 0) >= (def.tools ?? 0)) {
      p.site = site.id;
      this.siteWorkers.set(site.id, (this.siteWorkers.get(site.id) ?? 0) + 1);
      w.goTo(p, site.tile, 'site');
      return true;
    }
    return false;
  }

  private claimRes(t: number, d: number) {
    const c = (this.resClaims.get(t) ?? 0) + d;
    if (c <= 0) this.resClaims.delete(t);
    else this.resClaims.set(t, c);
  }

  /** Recounts claims, builders and materials on the way from what everyone is doing. */
  private book() {
    const tick = this.w.state.tick;
    if (this.bookTick === tick) return;
    this.bookTick = tick;
    this.resClaims.clear();
    this.siteWorkers.clear();
    this.incoming.clear();
    for (const p of this.w.state.people) {
      const getting = p.purpose === 'wood' || p.purpose === 'stone' || (p.purpose === 'job' && p.jobStep === 'gather') || p.task === 'chop' || p.task === 'quarry';
      if (getting && p.target !== undefined) this.claimRes(p.target, 1);
      if (p.site === undefined) continue;
      const inc = this.incoming.get(p.site) ?? { wood: 0, stone: 0 };
      if (p.load) {
        if (p.load.kind === 'wood') inc.wood += p.load.n;
        else if (p.load.kind === 'stone') inc.stone += p.load.n;
        else if (p.load.kind === 'tools') inc.tools = (inc.tools ?? 0) + p.load.n;
      } else if (p.purpose === 'fetch') {
        if (p.jobStep === 'fetch-stone') inc.stone += 4;
        else if (p.jobStep === 'fetch-tools') inc.tools = (inc.tools ?? 0) + 1;
        else inc.wood += 4;
      } else if (p.purpose === 'wood' || p.task === 'chop') inc.wood += WOOD_PER_TREE;
      else if (p.purpose === 'stone' || p.task === 'quarry') inc.stone += STONE_PER_TRIP;
      else if (p.task === 'build' || p.purpose === 'site') this.siteWorkers.set(p.site, (this.siteWorkers.get(p.site) ?? 0) + 1);
      this.incoming.set(p.site, inc);
    }
  }

  /** The nearest tree nobody is already heading for, within `range` tiles, or -1. */
  nearestTree(from: number, range = WOOD_RANGE): number {
    const size = this.w.size;
    const cells = Math.ceil(size / TREE_CELL);
    const [fx, fy] = this.tileXY(from);
    const cx = Math.floor(fx / TREE_CELL);
    const cy = Math.floor(fy / TREE_CELL);
    const rings = Math.ceil(range / TREE_CELL);
    let best = -1;
    let bestD = range * range + 1;
    for (let ring = 0; ring <= rings; ring++) {
      if (best >= 0 && (ring - 1) * TREE_CELL > Math.sqrt(bestD)) break;
      for (let gy = cy - ring; gy <= cy + ring; gy++) {
        for (let gx = cx - ring; gx <= cx + ring; gx++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
          if (gx < 0 || gy < 0 || gx >= cells || gy >= cells) continue;
          const c = gy * cells + gx;
          if (this.treeCount[c] <= 0) continue;
          for (const t of this.treeCells[c]) {
            if (this.trees[t] <= (this.resClaims.get(t) ?? 0)) continue;
            const d = ((t % size) - fx) ** 2 + (Math.floor(t / size) - fy) ** 2;
            if (d < bestD) {
              bestD = d;
              best = t;
            }
          }
        }
      }
    }
    return best;
  }

  private nearestStone(from: number): number {
    let best = -1;
    let bestD = STONE_RANGE * STONE_RANGE;
    for (const t of this.stoneTiles) {
      if (this.w.stock[t] <= (this.resClaims.get(t) ?? 0) * STONE_PER_TRIP) continue;
      const d = this.dist2(t, from);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** When someone arrives somewhere for a settlement reason. Returns true if it was one. */
  arrive(p: Person, purpose: string | undefined): boolean {
    const w = this.w;
    switch (purpose) {
      case 'home':
        p.task = 'sleep';
        p.indoors = true;
        return true;
      case 'wood':
        p.task = 'chop';
        p.wait = CHOP_STEPS;
        return true;
      case 'stone':
        p.task = 'quarry';
        p.wait = QUARRY_STEPS;
        return true;
      case 'site': {
        const b = p.site !== undefined ? this.bById.get(p.site) : undefined;
        if (!b || b.progress >= 1) {
          this.dropWork(p);
          return true;
        }
        if (p.load) {
          if (p.load.kind === 'wood') b.wood = Math.min(this.def(b).wood, b.wood + p.load.n);
          else if (p.load.kind === 'stone') b.stone = Math.min(this.def(b).stone, b.stone + p.load.n);
          else if (p.load.kind === 'tools') b.tools = Math.min(this.def(b).tools ?? 0, (b.tools ?? 0) + p.load.n);
          delete p.load;
          delete p.site;
          p.task = 'idle';
          p.wait = 5;
          this.buildingsChanged = true;
          return true;
        }
        p.task = 'build';
        p.wait = BUILD_SPELL;
        return true;
      }
      case 'fence': {
        const t = p.fenceTile;
        if (t === undefined || !p.load || (this.walls[t] !== Wall.PlannedFence && this.walls[t] !== Wall.PlannedGate)) {
          delete p.fenceTile;
          return true;
        }
        p.task = 'build';
        p.wait = this.walls[t] === Wall.PlannedGate ? 60 : 25;
        return true;
      }
      case 'settle': {
        const at = p.settleAt;
        delete p.settleAt;
        if (at === undefined) return false;
        // Join settlers who got here first, or found the new settlement.
        const close = this.settlements.find((s) => !s.abandoned && this.dist2(s.center, w.tileOf(p)) <= 64);
        if (close) this.join(p, close);
        else this.found(w.tileOf(p), [p]);
        p.task = 'idle';
        p.wait = 10;
        return true;
      }
    }
    return false;
  }

  /** Building tasks, step by step. Returns true if the person is doing one. */
  tick(p: Person): boolean {
    const w = this.w;
    if (p.task === 'chop' || p.task === 'quarry') {
      if (--p.wait > 0) return true;
      const t = p.target;
      delete p.target;
      // A builder takes one load to their site; a woodcutter or quarryman gathers a few before going to the store.
      const add = (kind: 'wood' | 'stone', n: number) => {
        if (p.load && p.load.kind === kind && p.site === undefined) p.load.n += n;
        else p.load = { kind, n };
      };
      if (t !== undefined && p.task === 'chop' && this.trees[t] > 0) {
        this.setTrees(t, this.trees[t] - 1);
        add('wood', WOOD_PER_TREE);
      } else if (t !== undefined && p.task === 'quarry' && w.stock[t] > 0) {
        const n = Math.min(STONE_PER_TRIP, w.stock[t]);
        w.stock[t] -= n;
        if (w.stock[t] === 0) w.tileChange(t, TileField.Empty, 1);
        add('stone', n);
      } else {
        // Someone else took the last of it.
        delete p.site;
      }
      p.task = 'idle';
      p.wait = 0;
      return true;
    }
    if (p.task === 'build' && p.fenceTile !== undefined) {
      if (--p.wait > 0) return true;
      const t = p.fenceTile;
      delete p.fenceTile;
      const gate = this.walls[t] === Wall.PlannedGate;
      const cost = gate ? 3 : 1;
      if ((this.walls[t] === Wall.PlannedFence || gate) && p.load && p.load.kind === 'wood' && p.load.n >= cost) {
        this.walls[t] = gate ? Wall.Gate : Wall.Fence;
        w.tileChange(t, TileField.Walls, this.walls[t]);
        p.load.n -= cost;
        if (p.load.n <= 0) delete p.load;
        const home = p.settlement !== undefined ? this.sById.get(p.settlement) : undefined;
        if (home) this.economy.pay(home, p, 1);
        // Trees standing where the fence goes are felled, and their wood goes into the store.
        if (this.trees[t] > 0) {
          if (home) this.economy.stockOf(home).wood += this.trees[t] * WOOD_PER_TREE;
          this.setTrees(t, 0);
        }
      }
      p.task = 'idle';
      p.wait = 2;
      return true;
    }
    if (p.task === 'build') {
      const b = p.site !== undefined ? this.bById.get(p.site) : undefined;
      if (!b || b.progress >= 1) {
        this.dropWork(p);
        return true;
      }
      const stepBefore = Math.floor(b.progress * 10);
      b.progress += 1 / this.def(b).work;
      const home = b.settlement !== undefined ? this.sById.get(b.settlement) : undefined;
      if (b.progress >= 1) {
        this.finished(b);
        if (home) this.economy.pay(home, p, 1);
        this.dropWork(p);
        return true;
      }
      // Only send buildings again when the drawing changes (it shows tenths of the work).
      if (Math.floor(b.progress * 10) !== stepBefore) this.buildingsChanged = true;
      if (--p.wait <= 0) {
        // Builders are paid a coin for each spell of work.
        if (home) this.economy.pay(home, p, 1);
        this.dropWork(p);
      }
      return true;
    }
    return false;
  }

  /** Stops building work: a builder leaves the site; someone fetching wood or stone gives up (anything carried is kept). */
  dropWork(p: Person) {
    if (p.task === 'chop' || p.task === 'quarry' || p.purpose === 'wood' || p.purpose === 'stone') delete p.target;
    if (!p.load) delete p.site;
    if (p.task === 'build' || p.task === 'chop' || p.task === 'quarry') {
      p.task = 'idle';
      p.wait = 5;
    }
  }

  // ---------------------------------------------------------------- fences (towns and cities)

  /**
   * Plans a fence around a town's built-up middle: the edge of the land within two tiles of
   * its homes, store, market and workshops (fields, mines, quarries and the like are left
   * outside, as they were outside town walls). Gates go where the fence crosses the lines
   * through the town's middle, so roads lead out in every direction. Old fence that is no
   * longer on the edge is taken down as the town grows.
   */
  private planFence(s: Settlement) {
    const w = this.w;
    const size = w.size;
    const outside = new Set<number>([BuildingKind.Farm, BuildingKind.Mine, BuildingKind.Quarry, BuildingKind.FishingHut, BuildingKind.Woodcutter]);
    const MARGIN = 2;
    const CLOSE = 3;
    const own = this.buildings.filter((b) => b.settlement === s.id);
    const core = own.filter((b) => !outside.has(b.kind));
    if (!core.length) return;
    // Work in a window around the core buildings, with room for the margin and the joining.
    let minX = size;
    let minY = size;
    let maxX = -1;
    let maxY = -1;
    for (const b of core) {
      const { w: fw, d: fd } = footprint(b.kind, b.rot);
      const [x0, y0] = this.tileXY(b.tile);
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x0 + fw - 1);
      maxY = Math.max(maxY, y0 + fd - 1);
    }
    const pad = MARGIN + CLOSE + 3;
    const ox = minX - pad;
    const oy = minY - pad;
    const W = maxX - minX + 1 + pad * 2;
    const H = maxY - minY + 1 + pad * 2;
    let a = new Uint8Array(W * H);
    const mark = (x0: number, y0: number, fw: number, fd: number, m: number) => {
      for (let y = y0 - m; y < y0 + fd + m; y++) for (let x = x0 - m; x < x0 + fw + m; x++) {
        const lx = x - ox;
        const ly = y - oy;
        if (lx >= 0 && ly >= 0 && lx < W && ly < H) a[ly * W + lx] = 1;
      }
    };
    for (const b of core) {
      const { w: fw, d: fd } = footprint(b.kind, b.rot);
      const [x0, y0] = this.tileXY(b.tile);
      mark(x0, y0, fw, fd, MARGIN);
    }
    // Join clusters that are close together (grow by CLOSE, then shrink back), so a town gets one fence.
    const pass = (src: Uint8Array, grow: boolean) => {
      const tmp = new Uint8Array(W * H);
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1;
        for (let k = -CLOSE; k <= CLOSE; k++) {
          const xx = x + k;
          const c = xx < 0 || xx >= W ? 0 : src[y * W + xx];
          v = grow ? v | c : v & c;
        }
        tmp[y * W + x] = v;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1;
        for (let k = -CLOSE; k <= CLOSE; k++) {
          const yy = y + k;
          const c = yy < 0 || yy >= H ? 0 : tmp[yy * W + x];
          v = grow ? v | c : v & c;
        }
        out[y * W + x] = v;
      }
      return out;
    };
    a = pass(pass(a, true), false);
    // Fill holes: anything the outside of the window cannot reach is inside.
    const seen = new Uint8Array(W * H);
    const stack: number[] = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i] || a[i]) continue;
      seen[i] = 1;
      const x = i % W;
      const y = (i - x) / W;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - W);
      if (y < H - 1) stack.push(i + W);
    }
    for (let i = 0; i < W * H; i++) if (!seen[i]) a[i] = 1;
    // A fence never runs through a building: any of the settlement's buildings the area touches is taken in whole.
    for (const b of own) {
      const { w: fw, d: fd } = footprint(b.kind, b.rot);
      const [x0, y0] = this.tileXY(b.tile);
      let touches = false;
      for (let y = y0; y < y0 + fd && !touches; y++) for (let x = x0; x < x0 + fw; x++) {
        const lx = x - ox;
        const ly = y - oy;
        if (lx >= 0 && ly >= 0 && lx < W && ly < H && a[ly * W + lx]) {
          touches = true;
          break;
        }
      }
      if (touches) mark(x0, y0, fw, fd, 1);
    }
    // Only the settlement's own land, and not water.
    const inside = (x: number, y: number) => {
      const lx = x - ox;
      const ly = y - oy;
      if (lx < 0 || ly < 0 || lx >= W || ly >= H || x < 0 || y < 0 || x >= size || y >= size) return false;
      const t = y * size + x;
      return a[ly * W + lx] === 1 && this.territory[t] === s.id && !isWater(w.terrain[t]);
    };
    // What lies outside: everything not inside that the outside of the window can reach. A pond or a
    // patch of other land enclosed by the town is not outside, so the fence does not ring it.
    const ext = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const i = stack.pop()!;
      const lx = i % W;
      const ly = (i - lx) / W;
      if (ext[i] || inside(lx + ox, ly + oy)) continue;
      ext[i] = 1;
      if (lx > 0) stack.push(i - 1);
      if (lx < W - 1) stack.push(i + 1);
      if (ly > 0) stack.push(i - W);
      if (ly < H - 1) stack.push(i + W);
    }
    const outsideAt = (x: number, y: number) => {
      const lx = x - ox;
      const ly = y - oy;
      return lx < 0 || ly < 0 || lx >= W || ly >= H || ext[ly * W + lx] === 1;
    };
    // The edge: inside tiles with any of their eight neighbours outside, so stretches join side to side.
    const ring: number[] = [];
    const ringSet = new Set<number>();
    for (let y = oy; y < oy + H; y++) {
      for (let x = ox; x < ox + W; x++) {
        if (!inside(x, y)) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && outsideAt(x + dx, y + dy)) {
            edge = true;
            break;
          }
        }
        const t = y * size + x;
        if (!edge || this.bByTile.has(t)) continue;
        ring.push(t);
        ringSet.add(t);
      }
    }
    const [cx, cy] = this.tileXY(s.center);
    const isGateSpot = (t: number) => {
      const [x, y] = this.tileXY(t);
      return x === cx || y === cy || Math.abs(x - cx) === Math.abs(y - cy);
    };
    // Every separate loop gets at least one gate, so no one is shut in.
    const gates = new Set<number>(ring.filter(isGateSpot));
    const done = new Set<number>();
    for (const t0 of ring) {
      if (done.has(t0)) continue;
      const part: number[] = [];
      const st = [t0];
      done.add(t0);
      while (st.length) {
        const t = st.pop()!;
        part.push(t);
        for (const n of [t - 1, t + 1, t - size, t + size]) {
          if (ringSet.has(n) && !done.has(n)) {
            done.add(n);
            st.push(n);
          }
        }
      }
      if (part.some((t) => gates.has(t))) continue;
      let best = part[0];
      for (const t of part) if (this.dist2(t, s.center) < this.dist2(best, s.center)) best = t;
      gates.add(best);
    }
    // Take down old fence that is no longer on the edge.
    for (const t of s.fencePlan ?? []) {
      if (ringSet.has(t) || this.walls[t] === Wall.None) continue;
      this.walls[t] = Wall.None;
      w.tileChange(t, TileField.Walls, 0);
    }
    for (const t of ring) {
      const v = this.walls[t];
      if (v === Wall.None) this.walls[t] = gates.has(t) ? Wall.PlannedGate : Wall.PlannedFence;
      else if (gates.has(t) && v === Wall.PlannedFence) this.walls[t] = Wall.PlannedGate;
      else if (gates.has(t) && v === Wall.Fence) {
        this.walls[t] = Wall.Gate;
        w.tileChange(t, TileField.Walls, Wall.Gate);
      }
    }
    s.fencePlan = ring;
    this.settlementsChanged = true;
  }

  /** Fence work for a settled adult: fetch wood from the store, then put up the nearest planned stretch. */
  private fenceWork(p: Person): boolean {
    const w = this.w;
    const s = p.settlement !== undefined ? this.sById.get(p.settlement) : undefined;
    if (!s || !s.fencePlan || (s.stage !== 'town' && s.stage !== 'city')) return false;
    const here = w.tileOf(p);
    const taken = new Set<number>();
    for (const q of w.state.people) if (q !== p && q.fenceTile !== undefined) taken.add(q.fenceTile);
    let best = -1;
    let bestD = Infinity;
    for (const t of s.fencePlan) {
      const v = this.walls[t];
      if ((v !== Wall.PlannedFence && v !== Wall.PlannedGate) || taken.has(t)) continue;
      const d = this.dist2(t, here);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best < 0) return false;
    if (p.load && p.load.kind === 'wood' && p.site === undefined) {
      p.fenceTile = best;
      w.goTo(p, best, 'fence');
      return true;
    }
    if (this.economy.stockOf(s).wood >= 2) {
      p.jobStep = 'fetch-fence';
      w.goTo(p, this.economy.storeTile(s, here), 'fetch');
      return true;
    }
    // The store has no wood: cut some.
    const tree = this.nearestTree(here, 40);
    if (tree < 0) return false;
    p.target = tree;
    w.goTo(p, tree, 'wood');
    return true;
  }

  fenceCounts(s: Settlement) {
    let built = 0;
    let planned = 0;
    for (const t of s.fencePlan ?? []) {
      const v = this.walls[t];
      if (v === Wall.Fence || v === Wall.Gate) built++;
      else if (v !== Wall.None) planned++;
    }
    return { built, planned };
  }

  /** Where a tired person goes to sleep: their home, if it is not too far. */
  bed(p: Person): number {
    if (p.home === undefined) return -1;
    const b = this.bById.get(p.home);
    if (!b || b.progress < 1) return -1;
    const door = this.economy.doorTile(b);
    return this.dist2(door, this.w.tileOf(p)) <= HOME_RANGE * HOME_RANGE ? door : -1;
  }

  /** Where settled people stay near when they have nothing to do: home, or the settlement's fire. */
  anchorTile(p: Person): number {
    if (p.home !== undefined) {
      const b = this.bById.get(p.home);
      if (b) return this.economy.doorTile(b);
    }
    if (p.settlement !== undefined) {
      const s = this.sById.get(p.settlement);
      if (s && !s.abandoned) return s.center;
    }
    return -1;
  }

  // ---------------------------------------------------------------- the player

  /** Places a finished building centered on a tile (SPEC 4). A campfire founds a camp with nobody in it yet. */
  place(kind: BuildingKind, center: number, rot: 0 | 1 = 0): boolean {
    if (kind === BuildingKind.Campfire) return this.buildable(center) && this.found(center, []) !== null;
    const { w, d } = footprint(kind, rot);
    const anchor = anchorFor(kind, rot, center, this.w.size);
    if (!this.areaFree(anchor, w, d, undefined, false, false, kind)) return false;
    let owner = this.territory[center] || undefined;
    if (owner === undefined) {
      let bestD = 15 * 15;
      for (const s of this.settlements) {
        if (s.abandoned) continue;
        const dd = this.dist2(s.center, center);
        if (dd < bestD) {
          bestD = dd;
          owner = s.id;
        }
      }
    }
    this.addBuilding(kind, anchor, owner, true, rot);
    const s = owner !== undefined ? this.sById.get(owner) : undefined;
    if (s) this.claim(s, Math.max(w, d), center);
    return true;
  }

  /** Removes buildings on the given tiles. Removing a settlement's campfire abandons it. */
  removeOn(tiles: number[]) {
    for (const t of tiles) {
      if (this.walls[t] !== Wall.None) {
        this.walls[t] = Wall.None;
        this.w.tileChange(t, TileField.Walls, 0);
      }
      const b = this.bByTile.get(t);
      if (!b) continue;
      if (b.kind === BuildingKind.Campfire && b.settlement !== undefined) {
        const s = this.sById.get(b.settlement);
        if (s) this.abandon(s);
        continue;
      }
      this.removeBuilding(b);
    }
  }

  private removeBuilding(b: Building) {
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
    this.bById.delete(b.id);
    for (const t of this.tilesOf(b)) if (this.bByTile.get(t) === b) this.bByTile.delete(t);
    for (const p of this.w.state.people) {
      if (p.home === b.id) {
        delete p.home;
        if (p.indoors) delete p.indoors;
      }
      if (p.site === b.id) {
        delete p.site;
        delete p.load;
      }
      if (p.job === b.id) this.economy.quit(p);
    }
    this.buildingsChanged = true;
  }

  order(id: number, o: SettlementOrder) {
    const s = this.sById.get(id);
    if (!s || s.abandoned) return;
    const w = this.w;
    switch (o.kind) {
      case 'build': {
        // The tile clicked is the building's middle; it must be on the settlement's land or nobody's.
        const { w: fw, d: fd } = footprint(o.building, o.rot);
        const anchor = anchorFor(o.building, o.rot, o.tile, w.size);
        if (!this.areaFree(anchor, fw, fd, s.id, true, false, o.building)) return;
        this.claim(s, Math.max(fw, fd), o.tile);
        s.queue.push({ kind: o.building, tile: anchor, rot: o.rot });
        // Start it now rather than at the next monthly look.
        this.manage(s);
        return;
      }
      case 'focus':
        s.focus = o.focus;
        this.settlementsChanged = true;
        return;
      case 'settlers': {
        // About a quarter of its people leave, a family at a time.
        const members = w.state.people.filter((p) => p.settlement === s.id);
        const want = Math.max(2, Math.ceil(members.length / 4));
        const leaving = new Set<Person>();
        for (const p of members) {
          if (leaving.size >= want) break;
          if (leaving.has(p) || w.ageOf(p) < ADULT_AGE) continue;
          leaving.add(p);
          const partner = p.pair !== undefined ? w.byId.get(p.pair) : undefined;
          if (partner && partner.settlement === s.id) leaving.add(partner);
          for (const q of members) if (w.ageOf(q) < ADULT_AGE && (q.mother === p.id || q.father === p.id)) leaving.add(q);
        }
        const store = this.economy.stockOf(s);
        for (const p of leaving) {
          // Food for the road, from the store.
          const food = Math.min(3 - p.carry, Math.floor(store.food));
          if (food > 0) {
            store.food -= food;
            p.carry += food;
          }
          w.stop(p);
          this.dropWork(p);
          delete p.settlement;
          delete p.home;
          delete p.indoors;
          this.economy.quit(p);
          p.settleAt = o.tile;
          delete p.order;
          w.goTo(p, o.tile, 'settle', true);
        }
        this.recount();
        return;
      }
      case 'abandon':
        this.abandon(s);
        return;
      case 'breakCulture':
        w.cultures.orderBreak(s.id);
        return;
    }
  }

  /** Its people leave and its land is given up; its buildings stand empty for anyone to take over. */
  private abandon(s: Settlement) {
    const w = this.w;
    s.abandoned = true;
    s.queue = [];
    for (const p of w.state.people) {
      if (p.settlement !== s.id) continue;
      delete p.settlement;
      delete p.home;
      if (p.indoors) {
        delete p.indoors;
      }
      this.economy.quit(p);
      this.dropWork(p);
    }
    for (let t = 0; t < this.territory.length; t++) {
      if (this.territory[t] === s.id) {
        this.territory[t] = 0;
        w.tileChange(t, TileField.Territory, 0);
        if (this.walls[t] !== Wall.None) {
          this.walls[t] = Wall.None;
          w.tileChange(t, TileField.Walls, 0);
        }
      }
    }
    delete s.fencePlan;
    for (const b of this.buildings.slice()) {
      if (b.settlement !== s.id) continue;
      if (b.kind === BuildingKind.Campfire || b.progress < 1) this.removeBuilding(b);
      else delete b.settlement;
    }
    this.counts.delete(s.id);
    this.settlementsChanged = true;
    this.buildingsChanged = true;
  }

  /** The person has died or been removed. */
  leave(p: Person) {
    this.economy.inherit(p);
    this.dropWork(p);
    if (p.home !== undefined) this.occupants.set(p.home, Math.max(0, (this.occupants.get(p.home) ?? 1) - 1));
  }

  // ---------------------------------------------------------------- reading

  settlementName(id: number | undefined) {
    return id !== undefined ? this.sById.get(id)?.name : undefined;
  }

  buildingAt(tile: number) {
    return this.bByTile.get(tile);
  }

  details(id: number): SettlementDetails | null {
    const s = this.sById.get(id);
    if (!s) return null;
    const c = this.counts.get(s.id) ?? { people: 0, housed: 0, homes: 0, homeBuildings: 0 };
    const kinds = new Map<number, { done: number; building: number }>();
    for (const b of this.buildings) {
      if (b.settlement !== s.id) continue;
      const k = kinds.get(b.kind) ?? { done: 0, building: 0 };
      if (b.progress >= 1) k.done++;
      else k.building++;
      kinds.set(b.kind, k);
    }
    return {
      id: s.id,
      name: s.name,
      stage: s.stage,
      foundedYear: Math.floor(s.founded / TICKS_PER_YEAR) + 1,
      people: c.people,
      housed: c.housed,
      homes: c.homes,
      buildings: [...kinds.entries()].map(([kind, v]) => ({ kind: kind as BuildingKind, ...v })),
      focus: s.focus,
      queue: s.queue.length,
      abandoned: !!s.abandoned,
      stock: { ...this.economy.stockOf(s) },
      coins: Math.floor(s.coins ?? 0),
      prices: this.economy.prices(s),
      ...(() => {
        const f = this.fenceCounts(s);
        return { fenceBuilt: f.built, fencePlanned: f.planned };
      })(),
      ...(() => {
        const j = this.economy.jobCounts(s);
        return { jobsFilled: j.filled, jobsOffered: j.offered, jobless: j.jobless, lightJobs: j.light };
      })(),
      ...(() => {
        const c = this.w.cultures.ofSettlement(s.id);
        return { culture: c.culture, otherCultures: c.others };
      })(),
    };
  }

  buildingViews(): BuildingView[] {
    return this.buildings.map((b) => {
      const { w, d } = footprint(b.kind, b.rot);
      const look = b.kind === BuildingKind.Farm ? this.economy.cropLook(b) : 0;
      return { id: b.id, kind: b.kind, tile: b.tile, w, d, rot: b.rot ?? 0, settlement: b.settlement ?? 0, progress: b.progress, look };
    });
  }

  settlementViews(): SettlementView[] {
    return this.settlements.map((s) => ({ id: s.id, name: s.name, stage: s.stage, center: s.center, people: this.counts.get(s.id)?.people ?? 0, abandoned: !!s.abandoned, culture: this.w.cultures?.dominant.get(s.id) }));
  }
}
