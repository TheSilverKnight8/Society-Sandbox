import { hash2 } from '../lib/rng';
import { Deposit, Terrain, isWater } from '../map/terrain';
import { BUILDINGS, BuildingKind, STAGES, STAGE_NEEDS, anchorFor, footprint, kindAllowsTerrain, needsShore, settlementName, type BuildingDef, type Good } from './buildings';
import { Economy } from './economy';
import { FENCE_TECH } from './tech';
import { ADULT_AGE, TICKS_PER_MONTH, TICKS_PER_YEAR, TileField, Wall, type Building, type BuildingView, type Person, type Settlement, type BuildingDetails, type SettlementDetails, type SettlementOrder, type SettlementView } from './types';
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

/** Workplaces that stand at their resource (Caleb after 4c: mines and the like stand away from the middle, often outside the land). */
const OUTLYING = new Set<number>([BuildingKind.Mine, BuildingKind.Quarry, BuildingKind.Woodcutter, BuildingKind.FishingHut]);
/** How far from a settlement's middle (tiles) it looks for a resource to put such a workplace beside. */
const OUTLYING_RANGE = 35;
/** Fields go at least this far from the middle when there is room (on the outskirts). */
const FIELD_MIN_RANGE = 6;
/** Land a settlement holds before growing more slowly: this many tiles, plus this many for each of its people (Caleb: a soft limit tied to population). */
const LAND_BASE = 80;
const LAND_PER_PERSON = 12;
/** Bridges: wood per tile, steps of work per tile, the widest water bridged (tiles), how far its goals may be. */
const BRIDGE_WOOD = 2;
const BRIDGE_STEPS = 40;
const MAX_BRIDGE = 4;
/** How far each settlement's map of where its people can walk reaches from its middle (tiles). */
const WALK_MAP = 64;
const BRIDGE_GOAL_RANGE = 90;
/** The four neighbours of a tile. */
const N4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Spreading (Caleb after 4a: grown villages spread when an expansion threshold is hit).
/** Most people a settlement holds at each stage; past this, a group leaves to found a new settlement. */
const MAX_PEOPLE: Record<Settlement['stage'], number> = { camp: 40, village: 120, town: 300, city: 600 };
/** A village or bigger with more than this share of its people homeless for this many years is crowded, and a group leaves. */
const CROWDED_SHARE = 0.3;
const CROWDED_YEARS = 2;
/** Chance each year that a young family strikes out from a village or bigger with at least this many people. */
const STRIKE_OUT_CHANCE = 0.08;
const STRIKE_OUT_MIN = 50;
/** A group striking out: this many young families at most (at least two), with this many young people not yet paired, and at least this many people in all. */
const STRIKE_OUT_FAMILIES = 3;
const STRIKE_OUT_SINGLES = 3;
const STRIKE_OUT_PEOPLE = 6;
/** Chance a year that a grown-up with nobody to pair with at home moves to a settlement within this many tiles that has someone. */
const MOVE_FOR_PAIR_CHANCE = 0.25;
const MOVE_FOR_PAIR_RANGE = 60;
/** How far settlers go (tiles): mostly near, now and then far. */
const SPREAD_NEAR: [number, number] = [25, 50];
const SPREAD_FAR: [number, number] = [60, 100];
const SPREAD_FAR_SHARE = 0.2;
/** At least this long between groups leaving one settlement, and nobody leaves a settlement this young. */
const SPREAD_GAP_YEARS = 1;
const SETTLING_YEARS = 2;

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
  /** Pavement on each tile: 1 planned, 2 paved. */
  /** Bridges over water: 1 planned, 2 built (Caleb: water is crossed by bridge or boat). */
  readonly bridges: Uint8Array;
  readonly roads: Uint8Array;
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
  /** Tiles each settlement holds, and how far its land reaches from its middle (tiles, either way). */
  private land = new Map<number, number>();
  private reach = new Map<number, number>();
  /** Unclaimed tiles beside each settlement's land that its people have stood on this month, and how often. */
  private frontier = new Map<number, Map<number, number>>();
  private regions = new Map<number, { at: number; tiles: Set<number> }>();
  private singlesCache?: { month: number; map: Map<number, Person[]> };
  private walkMaps = new Map<number, { at: number; version: number; center: number; ox: number; oy: number; d: Uint16Array }>();
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
    this.roads = st.roads && st.roads.length === n ? st.roads : new Uint8Array(n);
    this.bridges = st.bridges && st.bridges.length === n ? st.bridges : new Uint8Array(n);
    st.bridges = this.bridges;
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
    // Land held: water and mountains are natural borders (land claimed before that rule is let go).
    for (let i = 0; i < n; i++) {
      const own = this.territory[i];
      if (!own) continue;
      if (!this.claimable(i)) {
        this.territory[i] = 0;
        continue;
      }
      this.land.set(own, (this.land.get(own) ?? 0) + 1);
      const s = this.sById.get(own);
      if (s) {
        const d = Math.max(Math.abs((i % w.size) - (s.center % w.size)), Math.abs(Math.floor(i / w.size) - Math.floor(s.center / w.size)));
        if (d > (this.reach.get(own) ?? 0)) this.reach.set(own, d);
      }
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
  found(tile: number, founders: Person[], from?: number): Settlement | null {
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
    if (from !== undefined) s.from = from;
    this.settlements.push(s);
    this.sById.set(s.id, s);
    this.counts.set(s.id, { people: 0, housed: 0, homes: 0, homeBuildings: 0 });
    this.addBuilding(BuildingKind.Campfire, tile, s.id, true);
    this.claim(s, 4);
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

  /** Whether land can be held by a settlement at all: water and mountains are natural borders (Caleb). */
  claimable(t: number) {
    const ter = this.w.terrain[t];
    return !isWater(ter) && ter !== Terrain.Mountain && ter !== Terrain.Snow;
  }

  private claimTile(s: Settlement, t: number) {
    const w = this.w;
    this.territory[t] = s.id;
    this.land.set(s.id, (this.land.get(s.id) ?? 0) + 1);
    const d = Math.max(Math.abs((t % w.size) - (s.center % w.size)), Math.abs(Math.floor(t / w.size) - Math.floor(s.center / w.size)));
    if (d > (this.reach.get(s.id) ?? 0)) this.reach.set(s.id, d);
    w.tileChange(t, TileField.Territory, s.id);
    // Buildings nobody owns on newly claimed land become the settlement's.
    const b = this.bByTile.get(t);
    if (b && b.settlement === undefined) {
      b.settlement = s.id;
      this.buildingsChanged = true;
    }
  }

  /**
   * Claims land within `radius` of a tile that nobody else holds, spreading out from it over
   * land only, so it does not jump rivers, lakes or mountains (Caleb: natural borders).
   */
  private claim(s: Settlement, radius: number, around = s.center) {
    const w = this.w;
    const [cx, cy] = this.tileXY(around);
    const r2 = radius * radius + 0.5;
    const seen = new Set<number>([around]);
    const queue = [around];
    for (let k = 0; k < queue.length; k++) {
      const t = queue[k];
      const own = this.territory[t];
      if ((own !== 0 && own !== s.id) || !this.claimable(t)) continue;
      if (own === 0) this.claimTile(s, t);
      const x = t % w.size;
      const y = (t - x) / w.size;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size || (nx - cx) ** 2 + (ny - cy) ** 2 > r2) continue;
        const n = ny * w.size + nx;
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }

  /**
   * Someone of a settlement stands on unclaimed land beside its own: the settlement may take it
   * in at the month's turn (Caleb: land grows where its people go). Called every few steps.
   */
  explore(p: Person) {
    if (p.settlement === undefined) return;
    const w = this.w;
    const t = w.tileOf(p);
    if (this.territory[t] !== 0 || !this.claimable(t)) return;
    const x = t % w.size;
    const y = (t - x) / w.size;
    let beside = false;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w.size && ny < w.size && this.territory[ny * w.size + nx] === p.settlement) {
        beside = true;
        break;
      }
    }
    if (!beside) return;
    let f = this.frontier.get(p.settlement);
    if (!f) this.frontier.set(p.settlement, (f = new Map()));
    f.set(t, (f.get(t) ?? 0) + 1);
  }

  /**
   * Once a month: land its people have walked onto is taken in, freely while the settlement holds
   * less than its people need and less and less often beyond that (Caleb: a soft limit tied to
   * population). Unclaimed land mostly surrounded by its own is always taken in (no holes).
   */
  private growLand(s: Settlement, people: number) {
    const w = this.w;
    const f = this.frontier.get(s.id);
    this.frontier.delete(s.id);
    if (!f) return;
    const limit = LAND_BASE + LAND_PER_PERSON * people;
    for (const [t, visits] of f) {
      if (this.territory[t] !== 0 || !this.claimable(t)) continue;
      const x = t % w.size;
      const y = (t - x) / w.size;
      let own = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.territory[(y + dy) * w.size + x + dx] === s.id) own++;
      if (own === 0) continue;
      const size = this.land.get(s.id) ?? 0;
      const chance = own >= 5 ? 1 : size < limit ? 1 : Math.pow(limit / size, 4) * Math.min(1, visits / 3);
      if (w.rand.next() < chance) this.claimTile(s, t);
    }
  }

  /**
   * Whether a settlement's people can walk to a tile from its middle (looked up in a map of the
   * tiles within WALK_MAP of its middle that can be walked to, made again each month and when a
   * bridge is built). Tiles beyond the map count as reachable (a search decides). Things that
   * cannot be stood on (fish) count when a tile beside them can be walked to.
   */
  canWalk(settlement: number, t: number): boolean {
    return this.walkDist(settlement, t) !== -1;
  }

  /**
   * How many steps a tile is from a settlement's middle on foot: -1 if it cannot be walked to,
   * undefined if it is beyond the settlement's walk map (unknown). A tile that cannot be stood on
   * (fish) counts by the tiles beside it.
   */
  walkDist(settlement: number, t: number): number | undefined {
    const s = this.sById.get(settlement);
    if (!s) return undefined;
    const w = this.w;
    let f = this.walkMaps.get(settlement);
    if (!f || w.state.tick - f.at >= TICKS_PER_MONTH || f.version !== w.finder.landVersion || f.center !== s.center) f = this.makeWalkMap(s);
    const size = w.size;
    const x = (t % size) - f.ox;
    const y = Math.floor(t / size) - f.oy;
    const W = 2 * WALK_MAP + 1;
    if (x < 0 || y < 0 || x >= W || y >= W) return undefined;
    const here = f.d[y * W + x];
    if (here) return here - 1;
    if (w.finder.walkable(t)) return -1;
    let best = 0;
    for (const n of [x > 0 ? f.d[y * W + x - 1] : 0, x < W - 1 ? f.d[y * W + x + 1] : 0, y > 0 ? f.d[(y - 1) * W + x] : 0, y < W - 1 ? f.d[(y + 1) * W + x] : 0]) if (n && (!best || n < best)) best = n;
    return best ? best : -1;
  }

  private makeWalkMap(s: Settlement) {
    const w = this.w;
    const size = w.size;
    w.finder.land(s.center); // brings the pieces of land up to date first
    const W = 2 * WALK_MAP + 1;
    const ox = (s.center % size) - WALK_MAP;
    const oy = Math.floor(s.center / size) - WALK_MAP;
    const d = new Uint16Array(W * W);
    const queue = new Int32Array(W * W);
    let head = 0;
    let tail = 0;
    const start = WALK_MAP * W + WALK_MAP;
    d[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % W;
      const cy = (c - cx) / W;
      for (const [dx, dy] of N4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const n = ny * W + nx;
        if (d[n]) continue;
        const gx = ox + nx;
        const gy = oy + ny;
        if (gx < 0 || gy < 0 || gx >= size || gy >= size || !w.finder.walkable(gy * size + gx)) continue;
        d[n] = d[c] + 1;
        queue[tail++] = n;
      }
    }
    const f = { at: w.state.tick, version: w.finder.landVersion, center: s.center, ox, oy, d };
    this.walkMaps.set(s.id, f);
    return f;
  }

  /** Land a settlement can reach from its middle without crossing water or mountains, nor others' land (cached for a month). */
  private regionOf(s: Settlement, range: number): Set<number> {
    const hit = this.regions.get(s.id);
    const tick = this.w.state.tick;
    if (hit && tick - hit.at < TICKS_PER_MONTH) return hit.tiles;
    const w = this.w;
    const [cx, cy] = this.tileXY(s.center);
    const tiles = new Set<number>([s.center]);
    const queue = [s.center];
    for (let k = 0; k < queue.length; k++) {
      const t = queue[k];
      const x = t % w.size;
      const y = (t - x) / w.size;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size || Math.max(Math.abs(nx - cx), Math.abs(ny - cy)) > range) continue;
        const n = ny * w.size + nx;
        if (tiles.has(n) || !this.claimable(n) || (this.territory[n] !== 0 && this.territory[n] !== s.id)) continue;
        tiles.add(n);
        queue.push(n);
      }
    }
    this.regions.set(s.id, { at: tick, tiles });
    return tiles;
  }

  /** Once a month: land, stage, and what to build next. */
  private manage(s: Settlement) {
    const c = this.counts.get(s.id) ?? { people: 0, housed: 0, homes: 0, homeBuildings: 0 };
    const mine = this.buildings.filter((b) => b.settlement === s.id);
    // Land grows where its people go, up to a soft limit set by how many they are (Caleb).
    this.growLand(s, c.people);
    // Stage up when big enough.
    const next = STAGES[STAGES.indexOf(s.stage) + 1];
    // (Homes: that many home buildings, or beds enough for the people the stage needs, since a town's
    // townhouses hold ten each and a big town has fewer, larger homes.)
    if (next && c.people >= STAGE_NEEDS[next].people && (c.homeBuildings >= STAGE_NEEDS[next].homes || c.homes >= STAGE_NEEDS[next].people)) {
      s.stage = next;
      this.economy.onStage(s);
      this.settlementsChanged = true;
    }
    // A settlement whose people are all gone stands empty.
    if (c.people === 0 && this.w.state.tick - s.founded > TICKS_PER_YEAR * 2) return;
    this.housePeople(s);
    this.spread(s, c);
    this.economy.assignJobs(s);
    // Towns and cities fence their built-up middle, looked at again every year (Caleb: fencing and gates for towns and above).
    // Villages and bigger pave paths to their buildings, looked at again every year (Caleb after 4c).
    if (s.stage !== 'camp' && (!s.roadPlan || Math.floor(this.w.state.tick / TICKS_PER_MONTH) % 12 === 6)) {
      this.planRoads(s);
      this.planBridges(s);
    }
    // (Fences need Fortification, Stage 4c.)
    if ((s.stage === 'town' || s.stage === 'city') && this.w.tech.has(s, FENCE_TECH) && (!s.fencePlan || Math.floor(this.w.state.tick / TICKS_PER_MONTH) % 12 === 0)) this.planFence(s);
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
  private startHome(s: Settlement, c: { people: number; housed: number; homes: number }, stoneNear: boolean): boolean {
    const mine = this.buildings.filter((b) => b.settlement === s.id && b.progress < 1);
    // People beyond its beds (children born into a home, and pairs moving in, can crowd homes past their beds).
    const homeless = c.people - Math.min(c.housed, c.homes);
    const planned = mine.reduce((n, b) => n + this.def(b).homes, 0);
    if (homeless <= planned) return false;
    const town = s.stage === 'town' || s.stage === 'city';
    // Stone homes where stone is near, or the store has enough (bought or carried in).
    const stone = this.economy.stockOf(s).stone;
    const kind =
      town && (stoneNear || stone >= BUILDINGS[BuildingKind.Townhouse].stone) && this.economy.stockOf(s).tools >= 2 && this.w.tech.canBuild(s, BuildingKind.Townhouse)
        ? BuildingKind.Townhouse
        : s.stage !== 'camp' && (stoneNear || stone >= BUILDINGS[BuildingKind.House].stone)
          ? BuildingKind.House
          : BuildingKind.Hut;
    const spot = this.freeSpot(s, kind);
    if (!spot) return false;
    this.addBuilding(kind, spot.tile, s.id, false, spot.rot);
    return true;
  }

  /** Starts a storehouse, or the workplace it most needs. */
  private startOther(s: Settlement, c: { people: number }, stoneNear: boolean): boolean {
    const mine = this.buildings.filter((b) => b.settlement === s.id);
    const hasStore = mine.some((b) => b.kind === BuildingKind.Storehouse);
    if (s.stage !== 'camp' && !hasStore && (stoneNear || this.economy.stockOf(s).stone >= BUILDINGS[BuildingKind.Storehouse].stone) && s.focus !== 'housing') {
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
        const b = this.addBuilding(work.kind, spot.tile, s.id, false, spot.rot);
        // A workplace out at its resource takes in the land around it.
        if (spot.outlying) this.claim(s, 3, this.middleTile(b));
        return true;
      }
    }
    return false;
  }

  stoneNear(center: number) {
    const r2 = STONE_RANGE * STONE_RANGE;
    return this.stoneTiles.some((t) => this.w.stock[t] > 0 && this.dist2(t, center) <= r2);
  }

  /**
   * A place for a building, with a lane around it; or null. Mines, quarries, woodcutter's lodges
   * and fishing huts stand beside the nearest resource they can work, on the settlement's land or
   * unclaimed land beside it (Caleb); fields go toward the outskirts; everything else as close to
   * the middle as it fits.
   */
  private freeSpot(s: Settlement, kind: BuildingKind, test?: (anchor: number, w: number, d: number) => boolean): { tile: number; rot: 0 | 1; outlying?: boolean } | null {
    const w = this.w;
    if (OUTLYING.has(kind)) {
      // Only at resources it can reach without crossing water or mountains (Caleb: natural borders).
      const region = this.regionOf(s, OUTLYING_RANGE + 6);
      for (const res of this.economy.resourceSpots(kind, s.center, OUTLYING_RANGE)) {
        const [rx, ry] = this.tileXY(res);
        for (let r = 1; r <= 6; r++) {
          const options: { tile: number; rot: 0 | 1; outlying: boolean }[] = [];
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = rx + dx;
              const y = ry + dy;
              if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
              const center = y * w.size + x;
              if (!region.has(center)) continue;
              for (const rot of [0, 1] as const) {
                const { w: fw, d: fd } = footprint(kind, rot);
                const anchor = anchorFor(kind, rot, center, w.size);
                if (this.areaFree(anchor, fw, fd, s.id, true, true, kind) && (!test || test(anchor, fw, fd))) options.push({ tile: anchor, rot, outlying: true });
              }
            }
          }
          if (options.length) return options[w.rand.int(options.length)];
        }
      }
    }
    const [cx, cy] = this.tileXY(s.center);
    const field = kind === BuildingKind.Farm;
    // As far out as its land reaches (Caleb: land grows where its people go).
    const far = Math.max(6, Math.min(80, (this.reach.get(s.id) ?? 6) + 1));
    const rings = field ? [...Array.from({ length: Math.max(0, far - FIELD_MIN_RANGE + 1) }, (_, k) => FIELD_MIN_RANGE + k), ...Array.from({ length: FIELD_MIN_RANGE - 2 }, (_, k) => 2 + k)] : Array.from({ length: far - 1 }, (_, k) => 2 + k);
    for (const r of rings) {
      const options: { tile: number; rot: 0 | 1 }[] = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
          const center = y * w.size + x;
          if (this.territory[center] !== s.id) continue;
          for (const rot of [0, 1] as const) {
            const { w: fw, d: fd } = footprint(kind, rot);
            const anchor = anchorFor(kind, rot, center, w.size);
            // (A dock needs no lane around it: one side is the water.)
            if (this.areaFree(anchor, fw, fd, s.id, false, kind !== BuildingKind.Dock, kind) && (!test || test(anchor, fw, fd))) options.push({ tile: anchor, rot });
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
    if (b.kind === BuildingKind.Dock && this.w.finder) this.markDocks();
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
    if (p.settlement !== undefined) {
      this.economy.monthly(p);
      this.moveForPair(p);
    }
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
    // Carrying wood for the fence: put it up; carrying stone for paving: lay it.
    if (p.load && p.load.kind === 'wood' && p.site === undefined && this.fenceWork(p)) return true;
    if (p.load && p.load.kind === 'stone' && p.site === undefined && this.paveWork(p)) return true;
    if (p.load && p.load.kind === 'wood' && p.site === undefined && this.bridgeWork(p)) return true;
    if (w.rand.next() > 0.75) return false;
    const sites = this.buildings.filter((b) => b.settlement === p.settlement && b.progress < 1);
    if (!sites.length || w.rand.next() < 0.25) {
      if (this.bridgeWork(p)) return true;
      if (this.fenceWork(p)) return true;
      if (this.paveWork(p)) return true;
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
      const t = this.nearestTree(site.tile, WOOD_RANGE, site.settlement);
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
      const t = this.nearestStone(site.tile, site.settlement);
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

  /** The nearest source of a resource to a tile (trees for wood; stone, ore and clay deposits), or -1 (an order to collect it). */
  sourceOf(good: Good, from: number, range: number, owner?: number): number {
    const w = this.w;
    if (good === 'wood') return this.nearestTree(from, range, owner);
    const want = good === 'stone' ? Deposit.Stone : good === 'iron' ? Deposit.Iron : good === 'gold' ? Deposit.Gold : good === 'clay' ? Deposit.Clay : -1;
    if (want < 0) return -1;
    const [fx, fy] = this.tileXY(from);
    const fromLand = w.finder.land(from);
    let best = -1;
    let bestD = range * range + 1;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const x = fx + dx;
        const y = fy + dy;
        if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
        const t = y * w.size + x;
        const d = dx * dx + dy * dy;
        if (d < bestD && w.deposit[t] === want && w.stock[t] > 0 && w.finder.reachable(fromLand, t) && (owner === undefined || this.canWalk(owner, t))) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  }

  /** Someone collecting by order takes what they can from a source: a tree's wood, or some stone, ore or clay. Returns how much. */
  takeFrom(good: Good, t: number): number {
    const w = this.w;
    if (good === 'wood') {
      if (this.trees[t] <= 0) return 0;
      this.setTrees(t, this.trees[t] - 1);
      return WOOD_PER_TREE;
    }
    if (w.stock[t] <= 0) return 0;
    const n = Math.min(w.stock[t], 2);
    w.stock[t] -= n;
    if (w.stock[t] === 0) w.tileEmptied(t);
    return n;
  }

  /** The nearest tree nobody is already heading for, within `range` tiles, or -1. */
  nearestTree(from: number, range = WOOD_RANGE, settlement?: number): number {
    const size = this.w.size;
    const cells = Math.ceil(size / TREE_CELL);
    const [fx, fy] = this.tileXY(from);
    const cx = Math.floor(fx / TREE_CELL);
    const cy = Math.floor(fy / TREE_CELL);
    const rings = Math.ceil(range / TREE_CELL);
    // Trees across water cannot be reached (from a building, its own tile's land).
    const fromLand = this.w.finder.land(from);
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
            if (this.trees[t] <= (this.resClaims.get(t) ?? 0) || !this.w.finder.reachable(fromLand, t) || (settlement !== undefined && !this.canWalk(settlement, t))) continue;
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

  private nearestStone(from: number, settlement?: number): number {
    let best = -1;
    let bestD = STONE_RANGE * STONE_RANGE;
    const fromLand = this.w.finder.land(from);
    for (const t of this.stoneTiles) {
      if (this.w.stock[t] <= (this.resClaims.get(t) ?? 0) * STONE_PER_TRIP || !this.w.finder.reachable(fromLand, t) || (settlement !== undefined && !this.canWalk(settlement, t))) continue;
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
      case 'pave': {
        const t = p.paveTile;
        if (t === undefined || !p.load || p.load.kind !== 'stone' || this.roads[t] !== 1) {
          delete p.paveTile;
          return true;
        }
        p.task = 'build';
        p.wait = 15;
        return true;
      }
      case 'bridge': {
        const t = p.bridgeTile;
        if (t === undefined || !p.load || p.load.kind !== 'wood' || this.bridges[t] !== 1) {
          delete p.bridgeTile;
          return true;
        }
        p.task = 'build';
        p.wait = BRIDGE_STEPS;
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
        const from = p.settleFrom;
        const free = p.settleFree;
        delete p.settleAt;
        delete p.settleFrom;
        delete p.settleFree;
        if (at === undefined) return false;
        // Join settlers who got here first, or found the new settlement.
        const close = this.settlements.find((s) => !s.abandoned && this.dist2(s.center, w.tileOf(p)) <= 64);
        if (close) this.join(p, close);
        else {
          const s = this.found(w.tileOf(p), [p], from);
          // A settlement founded by a nation's settlers belongs to the nation (Caleb), unless they left in a revolt.
          const parent = from !== undefined ? this.byId(from) : undefined;
          if (s && parent?.nation !== undefined && !free) s.nation = parent.nation;
        }
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
    if (p.task === 'build' && p.paveTile !== undefined) {
      if (--p.wait > 0) return true;
      const t = p.paveTile;
      delete p.paveTile;
      if (this.roads[t] === 1 && p.load && p.load.kind === 'stone' && p.load.n >= 1) {
        this.roads[t] = 2;
        w.tileChange(t, TileField.Roads, 2);
        p.load.n -= 1;
        if (p.load.n <= 0) delete p.load;
        const home = p.settlement !== undefined ? this.sById.get(p.settlement) : undefined;
        if (home) this.economy.pay(home, p, 1);
        if (this.trees[t] > 0) {
          if (home) this.economy.stockOf(home).wood += this.trees[t] * WOOD_PER_TREE;
          this.setTrees(t, 0);
        }
      }
      p.task = 'idle';
      p.wait = 2;
      return true;
    }
    if (p.task === 'build' && p.bridgeTile !== undefined) {
      if (--p.wait > 0) return true;
      const t = p.bridgeTile;
      delete p.bridgeTile;
      if (this.bridges[t] === 1 && p.load && p.load.kind === 'wood' && p.load.n >= BRIDGE_WOOD) {
        this.bridges[t] = 2;
        w.finder.landDirty = true;
        w.tileChange(t, TileField.Bridges, 2);
        p.load.n -= BRIDGE_WOOD;
        if (p.load.n <= 0) delete p.load;
        const home = p.settlement !== undefined ? this.sById.get(p.settlement) : undefined;
        if (home) this.economy.pay(home, p, 1);
      }
      p.task = 'idle';
      p.wait = 2;
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
      // Masonry makes builders a fifth quicker (Stage 4c).
      b.progress += (this.w.tech.has(b.settlement !== undefined ? this.sById.get(b.settlement) : undefined, 'masonry') ? 1.2 : 1) / this.def(b).work;
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
    // Gates where the lines through the middle cross the fence, and wherever a path does.
    const isGateSpot = (t: number) => {
      const [x, y] = this.tileXY(t);
      return x === cx || y === cy || Math.abs(x - cx) === Math.abs(y - cy) || this.roads[t] > 0;
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
    const taken = this.taken().fence;
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
      this.taken().fence.add(best);
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

  // ---------------------------------------------------------------- pavement (villages and bigger)

  /**
   * Plans paths from a settlement's middle to the door of each of its buildings (within 26
   * tiles), on its own land, around buildings and off water. Builders pave them with a stone a
   * tile; people walk faster on pavement (Caleb after 4c: villages put down pavement).
   */
  private planRoads(s: Settlement) {
    const w = this.w;
    const plan = new Set<number>(s.roadPlan ?? []);
    for (const b of this.buildings) {
      if (b.settlement !== s.id || b.kind === BuildingKind.Campfire || b.progress < 1) continue;
      const door = b.kind === BuildingKind.Farm ? b.tile : this.economy.doorTile(b);
      if (this.dist2(door, s.center) > 26 * 26) continue;
      const tiles = w.finder.find(s.center, door, 3000);
      if (!tiles) continue;
      for (const t of [s.center, ...tiles]) {
        if (this.territory[t] !== s.id || this.bByTile.has(t) || isWater(w.terrain[t]) || this.walls[t] === Wall.Fence) continue;
        plan.add(t);
        if (this.roads[t] === 0) this.roads[t] = 1;
      }
    }
    s.roadPlan = [...plan].filter((t) => this.roads[t] > 0);
    this.settlementsChanged = true;
  }

  /** Paving for a settled adult: fetch stone from the store, then pave the nearest planned tile. */
  private paveWork(p: Person): boolean {
    const w = this.w;
    const s = p.settlement !== undefined ? this.sById.get(p.settlement) : undefined;
    if (!s || !s.roadPlan || s.stage === 'camp') return false;
    const here = w.tileOf(p);
    const taken = this.taken().pave;
    let best = -1;
    let bestD = Infinity;
    for (const t of s.roadPlan) {
      if (this.roads[t] !== 1 || taken.has(t) || this.bByTile.has(t)) continue;
      const d = this.dist2(t, here);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best < 0) return false;
    if (p.load && p.load.kind === 'stone' && p.site === undefined) {
      p.paveTile = best;
      this.taken().pave.add(best);
      w.goTo(p, best, 'pave');
      return true;
    }
    // Paving waits for stone in the store (it is not worth breaking stone just for it).
    if (this.economy.stockOf(s).stone >= 4) {
      p.jobStep = 'fetch-pave';
      w.goTo(p, this.economy.storeTile(s, here), 'fetch');
      return true;
    }
    return false;
  }

  /**
   * Once a year (villages and bigger): where a settlement or a resource nearby is cut off by a
   * river or narrow water, plan a bridge across it (Caleb: water is crossed by bridge or boat).
   * A bridge spans at most a few tiles of shallow water; wider water needs boats.
   */
  private planBridges(s: Settlement) {
    const w = this.w;
    const goals: number[] = [];
    // Its neighbours, nearest first.
    const others = this.settlements
      .filter((o) => o !== s && !o.abandoned && this.dist2(o.center, s.center) <= BRIDGE_GOAL_RANGE * BRIDGE_GOAL_RANGE)
      .sort((a, b) => this.dist2(a.center, s.center) - this.dist2(b.center, s.center))
      .slice(0, 3);
    for (const o of others) goals.push(o.center);
    // The nearest trees, stone and ore.
    const tree = this.nearestTree(s.center, 40);
    if (tree >= 0) goals.push(tree);
    for (const list of [this.stoneTiles, this.economy.oreList()]) {
      let best = -1;
      let bestD = 40 * 40;
      for (const t of list) {
        const d = this.dist2(t, s.center);
        if (w.stock[t] > 0 && d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best >= 0) goals.push(best);
    }
    const plan = new Set<number>((s.bridgePlan ?? []).filter((t) => this.bridges[t] > 0));
    const home = w.finder.land(s.center);
    for (const g0 of goals) {
      const g = w.finder.walkable(g0) ? g0 : this.approach(g0);
      if (g < 0) continue;
      // Only where it is cut off: on another piece of land (once bridged, it is the same piece).
      if (w.finder.land(g) === home) continue;
      const route = w.finder.find(s.center, g, 10000, 'plan');
      if (!route) continue;
      // Each stretch of open water on the way becomes a bridge, if it is narrow enough.
      let run: number[] = [];
      const flush = () => {
        if (run.length && run.length <= MAX_BRIDGE) {
          for (const t of run) {
            if (this.bridges[t] === 0) this.bridges[t] = 1;
            plan.add(t);
          }
        }
        run = [];
      };
      for (const t of route) {
        if (w.finder.water(t)) run.push(t);
        else flush();
      }
      flush();
    }
    s.bridgePlan = [...plan].filter((t) => this.bridges[t] > 0);
  }

  /** Fence, pavement and bridge tiles someone is already going to build (worked out once a step). */
  private taken() {
    const tick = this.w.state.tick;
    if (this.takenCache?.tick !== tick) {
      const fence = new Set<number>();
      const pave = new Set<number>();
      const bridge = new Set<number>();
      for (const q of this.w.state.people) {
        if (q.fenceTile !== undefined) fence.add(q.fenceTile);
        if (q.paveTile !== undefined) pave.add(q.paveTile);
        if (q.bridgeTile !== undefined) bridge.add(q.bridgeTile);
      }
      this.takenCache = { tick, fence, pave, bridge };
    }
    return this.takenCache;
  }

  private takenCache?: { tick: number; fence: Set<number>; pave: Set<number>; bridge: Set<number> };

  /** Bridge building for a settled adult: fetch wood from the store, then build the next tile of a planned bridge out from its bank. */
  private bridgeWork(p: Person): boolean {
    const w = this.w;
    const s = p.settlement !== undefined ? this.sById.get(p.settlement) : undefined;
    if (!s || !s.bridgePlan?.length || s.stage === 'camp') return false;
    if (!s.bridgePlan.some((t) => this.bridges[t] === 1)) return false;
    const here = w.tileOf(p);
    const taken = this.taken().bridge;
    let best = -1;
    let bestStand = -1;
    let bestD = Infinity;
    for (const t of s.bridgePlan) {
      if (this.bridges[t] !== 1 || taken.has(t)) continue;
      // It is built from the bank or from bridge already built.
      const stand = this.standBeside(t);
      if (stand < 0) continue;
      const d = this.dist2(stand, here);
      if (d < bestD) {
        bestD = d;
        best = t;
        bestStand = stand;
      }
    }
    if (best < 0) return false;
    if (p.load && p.load.kind === 'wood' && p.load.n >= BRIDGE_WOOD && p.site === undefined) {
      p.bridgeTile = best;
      this.taken().bridge.add(best);
      w.goTo(p, bestStand, 'bridge');
      return true;
    }
    if (this.economy.stockOf(s).wood >= BRIDGE_WOOD * 2) {
      p.jobStep = 'fetch-bridge';
      w.goTo(p, this.economy.storeTile(s, here), 'fetch');
      return true;
    }
    return false;
  }

  /** A walkable tile beside a tile of water (bank or built bridge), or -1. */
  private standBeside(t: number): number {
    const w = this.w;
    const x = t % w.size;
    const y = (t - x) / w.size;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const n = ny * w.size + nx;
      if (w.finder.walkable(n)) return n;
    }
    return -1;
  }

  /** Marks where people can board boats: the tiles of every finished dock. */
  markDocks() {
    const f = this.w.finder;
    const n = this.w.size * this.w.size;
    if (!f.launch || f.launch.length !== n) f.launch = new Uint8Array(n);
    f.launch.fill(0);
    f.launchCount = 0;
    f.landDirty = true;
    for (const b of this.buildings) {
      if (b.kind !== BuildingKind.Dock || b.progress < 1) continue;
      for (const t of this.tilesOf(b)) {
        f.launch[t] = 1;
        f.launchCount++;
      }
    }
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

  /** Someone moves to live in a building (the ruler's family into the castle): its settlement becomes theirs. */
  moveInto(p: Person, b: Building) {
    if (b.settlement === undefined) return;
    if (p.settlement !== b.settlement) {
      this.w.stop(p);
      this.dropWork(p);
      this.economy.quit(p);
      p.settlement = b.settlement;
    }
    p.home = b.id;
    delete p.indoors;
    this.recount();
    this.settlementsChanged = true;
  }

  /** Where a settlement is taken from: its castle, if it has a finished one (Caleb), else its middle. */
  seatOf(s: Settlement): number {
    const castle = this.buildings.find((b) => b.kind === BuildingKind.Castle && b.settlement === s.id && b.progress >= 1);
    return castle ? this.economy.doorTile(castle) : s.center;
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

  /** A building is gone (burned down by an enemy army, Stage 5). */
  destroy(b: Building) {
    this.removeBuilding(b);
  }

  private removeBuilding(b: Building) {
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
    this.bById.delete(b.id);
    if (b.kind === BuildingKind.Dock) this.markDocks();
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
        // Its people can only build what their technology allows (Stage 4c).
        if (!w.tech.canBuild(s, o.building)) return;
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
      case 'settlers':
        // About a quarter of its people leave, a family at a time.
        this.sendSettlers(s, this.families(s, 'quarter'), o.tile);
        return;
      case 'abandon':
        this.abandon(s);
        return;
      case 'breakCulture':
        w.cultures.orderBreak(s.id);
        return;
    }
  }

  // ---------------------------------------------------------------- spreading

  /**
   * Once a month: a settlement past its stage's most people, or a village or bigger crowded
   * (many homeless) for two years, sends about a quarter of its people (whole families) to
   * found a new settlement (none leave in its first two years);
   * now and then a young family strikes out on its own (Caleb: grown villages spread when an
   * expansion threshold is hit). Revolts and nations wanting land come with nations (4b).
   */
  private spread(s: Settlement, c: { people: number; housed: number; homes: number }) {
    const w = this.w;
    const tick = w.state.tick;
    const homeless = c.people - Math.min(c.housed, c.homes);
    // Camps are not crowded: their people are still building their first homes.
    if (s.stage !== 'camp' && homeless > c.people * CROWDED_SHARE) s.crowdedSince ??= tick;
    else delete s.crowdedSince;
    if (!w.toggles.founding || tick - s.founded < SETTLING_YEARS * TICKS_PER_YEAR) return;
    if (s.spreadAt !== undefined && tick - s.spreadAt < SPREAD_GAP_YEARS * TICKS_PER_YEAR) return;
    const over = c.people > MAX_PEOPLE[s.stage];
    const crowded = s.crowdedSince !== undefined && tick - s.crowdedSince >= CROWDED_YEARS * TICKS_PER_YEAR;
    if (over || crowded) {
      if (this.sendOut(s, 'quarter')) delete s.crowdedSince;
      return;
    }
    if (s.stage !== 'camp' && c.people >= STRIKE_OUT_MIN && w.rand.next() < 1 - Math.pow(1 - STRIKE_OUT_CHANCE, 1 / 12)) this.sendOut(s, 'young');
  }

  /**
   * Sends a group out to found a new settlement: about a quarter of the people, or one young
   * family (from `pool` if given). `free`: their settlement belongs to no nation (a revolt).
   */
  sendOut(s: Settlement, which: 'quarter' | 'young', pool?: Set<Person>, free = false): boolean {
    const spot = this.spreadSpot(s);
    if (spot < 0) return false;
    const leaving = this.families(s, which, pool);
    if (!this.sendSettlers(s, leaving, spot)) return false;
    if (free) for (const p of leaving) p.settleFree = true;
    return true;
  }

  /** People who would leave together: about a quarter of the settlement, or one young pair; each with their children. */
  private families(s: Settlement, which: 'quarter' | 'young', pool?: Set<Person>): Set<Person> {
    const w = this.w;
    const all = w.state.people.filter((p) => p.settlement === s.id);
    const members = pool ? all.filter((p) => pool.has(p)) : all;
    const leaving = new Set<Person>();
    const addFamily = (p: Person) => {
      leaving.add(p);
      const partner = p.pair !== undefined ? w.byId.get(p.pair) : undefined;
      if (partner && partner.settlement === s.id) leaving.add(partner);
      for (const q of members) if (w.ageOf(q) < ADULT_AGE && (q.mother === p.id || q.father === p.id)) leaving.add(q);
    };
    if (which === 'young') {
      // A few young families together, with some young people not yet paired, so the new
      // settlement has people to pair and grow (Caleb: one family alone never develops).
      const young = members.filter((p) => {
        const partner = p.pair !== undefined ? w.byId.get(p.pair) : undefined;
        const age = w.ageOf(p);
        return p.sex === 0 && age >= 16 && age <= 35 && partner && partner.settlement === s.id && w.ageOf(partner) <= 35;
      });
      if (young.length < 2) return leaving;
      for (let k = 0; k < STRIKE_OUT_FAMILIES && young.length; k++) addFamily(young.splice(w.rand.int(young.length), 1)[0]);
      const singles = members.filter((p) => p.pair === undefined && !leaving.has(p) && w.ageOf(p) >= 16 && w.ageOf(p) <= 28);
      for (let k = 0; k < STRIKE_OUT_SINGLES && singles.length; k++) leaving.add(singles.splice(w.rand.int(singles.length), 1)[0]);
      if (leaving.size < STRIKE_OUT_PEOPLE) leaving.clear();
      return leaving;
    }
    const want = Math.max(8, Math.ceil(members.length / 4));
    for (const p of members) {
      if (leaving.size >= want) break;
      if (leaving.has(p) || w.ageOf(p) < ADULT_AGE) continue;
      addFamily(p);
    }
    return leaving;
  }

  /** A place for settlers from `s` to found a new settlement: free land with trees near, away from other settlements. -1 if none found. */
  private spreadSpot(s: Settlement): number {
    const w = this.w;
    const size = w.size;
    const [cx, cy] = this.tileXY(s.center);
    const [r0, r1] = w.rand.next() < SPREAD_FAR_SHARE ? SPREAD_FAR : SPREAD_NEAR;
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = w.rand.next() * Math.PI * 2;
      const r = r0 + w.rand.next() * (r1 - r0);
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
      const t = y * size + x;
      if (!this.buildable(t) || this.territory[t] !== 0) continue;
      if (this.settlements.some((o) => !o.abandoned && this.dist2(o.center, t) < FOUND_GAP * FOUND_GAP)) continue;
      if (this.nearestTree(t, FOUND_WOOD_RANGE) < 0) continue;
      // Open grassland with stone near is best; nearer is a little better.
      const score = (w.terrain[t] === Terrain.Grassland ? 1 : 0) + (this.stoneNear(t) ? 1 : 0) - r / 100 + w.rand.next() * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  /** Sends people from a settlement to found a new one at `tile` (they take food for the road from the store). */
  private sendSettlers(s: Settlement, leaving: Set<Person>, tile: number): boolean {
    const w = this.w;
    if (!leaving.size) return false;
    const store = this.economy.stockOf(s);
    for (const p of leaving) {
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
      p.settleAt = tile;
      p.settleFrom = s.id;
      delete p.order;
      w.goTo(p, tile, 'settle', true);
    }
    s.spreadAt = w.state.tick;
    this.recount();
    this.settlementsChanged = true;
    return true;
  }

  /**
   * A grown-up with nobody at home they could pair with may move to a settlement nearby that has
   * someone (so small settlements are not left to one family, and people come and go between them).
   */
  private moveForPair(p: Person) {
    const w = this.w;
    if (!w.toggles.founding || p.pair !== undefined || p.soldier || p.job !== undefined && this.economy.jobOf(p) === 'official') return;
    const age = w.ageOf(p);
    if (age < 17 || age > 35 || w.nations.rulers.has(p.id) || w.rand.next() > 1 - Math.pow(1 - MOVE_FOR_PAIR_CHANCE, 1 / 12)) return;
    const singles = this.singlesBySettlement();
    const fits = (q: Person) => q.sex !== p.sex && Math.abs(w.ageOf(q) - age) <= 12 && !w.isRelated(p, q);
    if ((singles.get(p.settlement!) ?? []).some(fits)) return;
    const home = this.sById.get(p.settlement!);
    if (!home) return;
    let best: Settlement | null = null;
    let bestScore = -Infinity;
    for (const s of this.settlements) {
      if (s === home || s.abandoned || this.dist2(s.center, home.center) > MOVE_FOR_PAIR_RANGE * MOVE_FOR_PAIR_RANGE) continue;
      const n = (singles.get(s.id) ?? []).filter(fits).length;
      if (!n) continue;
      // Rather their own culture's and nation's, and nearer.
      const score = n + (s.nation !== undefined && s.nation === home.nation ? 3 : 0) - Math.sqrt(this.dist2(s.center, home.center)) / 20;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return;
    w.stop(p);
    this.dropWork(p);
    this.economy.quit(p);
    delete p.settlement;
    delete p.home;
    delete p.indoors;
    p.settleAt = best.center;
    w.goTo(p, best.center, 'settle', true);
    this.recount();
    this.settlementsChanged = true;
  }

  /** Grown-ups not paired, by settlement (worked out once a month). */
  private singlesBySettlement(): Map<number, Person[]> {
    const month = Math.floor(this.w.state.tick / TICKS_PER_MONTH);
    if (this.singlesCache?.month === month) return this.singlesCache.map;
    const map = new Map<number, Person[]>();
    for (const q of this.w.state.people) {
      if (q.settlement === undefined || q.pair !== undefined || this.w.ageOf(q) < 16) continue;
      const l = map.get(q.settlement);
      if (l) l.push(q);
      else map.set(q.settlement, [q]);
    }
    this.singlesCache = { month, map };
    return map;
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
    this.land.delete(s.id);
    this.reach.delete(s.id);
    this.frontier.delete(s.id);
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

  /** A building's info panel (Caleb after Stage 5). */
  buildingDetails(id: number): BuildingDetails | null {
    const b = this.bById.get(id);
    if (!b) return null;
    const def = this.def(b);
    const s = b.settlement !== undefined ? this.sById.get(b.settlement) : undefined;
    let workers = 0;
    let lightWorkers = 0;
    let residents = 0;
    let builders = 0;
    const doing: string[] = [];
    let ruler: { id: number; name: string } | undefined;
    for (const p of this.w.state.people) {
      if (p.home === b.id) {
        residents++;
        if (this.w.nations.rulers.has(p.id)) ruler = { id: p.id, name: p.unique?.name ?? `No. ${p.id}` };
      }
      if (p.site === b.id) builders++;
      if (p.job !== b.id) continue;
      if (this.w.ageOf(p) < ADULT_AGE) lightWorkers++;
      else workers++;
      if (p.making) doing.push(`making ${p.making}`);
      else if (p.load) doing.push(`carrying ${p.load.n} ${p.load.kind}`);
    }
    return {
      id: b.id,
      kind: b.kind,
      settlement: b.settlement,
      settlementName: s?.name,
      progress: b.progress,
      materials: b.progress < 1 ? { wood: [b.wood, def.wood], stone: [b.stone, def.stone], tools: def.tools ? [b.tools ?? 0, def.tools] : undefined } : undefined,
      builders,
      workers,
      jobs: def.jobs,
      lightWorkers,
      lightJobs: def.lightJobs,
      residents,
      homes: def.homes,
      growth: b.kind === BuildingKind.Farm ? b.growth ?? 0 : undefined,
      output: b.output,
      doing,
      burning: b.fire !== undefined,
      ruler,
    };
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
        let paved = 0;
        let toPave = 0;
        for (const t of s.roadPlan ?? []) {
          if (this.roads[t] === 2) paved++;
          else if (this.roads[t] === 1) toPave++;
        }
        let bridges = 0;
        let toBridge = 0;
        for (const t of s.bridgePlan ?? []) {
          if (this.bridges[t] === 2) bridges++;
          else if (this.bridges[t] === 1) toBridge++;
        }
        return { paved, toPave, bridges, toBridge };
      })(),
      ...(() => {
        const j = this.economy.jobCounts(s);
        return { jobsFilled: j.filled, jobsOffered: j.offered, jobless: j.jobless, lightJobs: j.light };
      })(),
      ...(() => {
        const c = this.w.cultures.ofSettlement(s.id);
        return { culture: c.culture, otherCultures: c.others };
      })(),
      from: s.from !== undefined ? this.settlementName(s.from) : undefined,
      nation: s.nation,
      unrest: s.unrest ?? 0,
      garrison: this.w.state.people.filter((p) => p.soldier && p.army !== undefined && this.w.military.byId.get(p.army)?.home === s.id).length,
      underAttack: this.w.military.underAttack.has(s.id),
    };
  }

  buildingViews(): BuildingView[] {
    return this.buildings.map((b) => {
      const { w, d } = footprint(b.kind, b.rot);
      const look = b.kind === BuildingKind.Farm ? this.economy.cropLook(b) : 0;
      const banner = b.kind === BuildingKind.Hall || b.kind === BuildingKind.Barracks || b.kind === BuildingKind.Castle ? this.w.nations?.bannerOf(b.settlement) : undefined;
      return { id: b.id, kind: b.kind, tile: b.tile, w, d, rot: b.rot ?? 0, settlement: b.settlement ?? 0, progress: b.progress, look, banner, burning: b.fire !== undefined || undefined };
    });
  }

  settlementViews(): SettlementView[] {
    return this.settlements.map((s) => ({ id: s.id, name: s.name, stage: s.stage, center: s.center, people: this.counts.get(s.id)?.people ?? 0, abandoned: !!s.abandoned, culture: this.w.cultures?.dominant.get(s.id), nation: s.nation }));
  }
}
