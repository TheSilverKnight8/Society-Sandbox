import { Terrain } from '../map/terrain';

// Finding a way across the map (A* search on the tile grid, 8 directions).
//
// Each terrain has a walking cost: open ground is cheapest, swamps and mountains are slow,
// water cannot be walked (Caleb: only by bridge or boat). Climbing a level costs a little extra.
// Two other kinds of search: planning bridges (water may be crossed, at a high cost, to see where
// a bridge would save a long way round), and journeys by boat (people board at a dock, sail over
// water and land on any shore).
// The search's working arrays are made once and reused, so a search makes no garbage.

/** Cost of walking onto a tile of each terrain; Infinity = cannot be walked. */
export const WALK_COST: number[] = [];
WALK_COST[Terrain.DeepWater] = Infinity;
WALK_COST[Terrain.ShallowWater] = Infinity;
WALK_COST[Terrain.Sand] = 1.2;
WALK_COST[Terrain.Grassland] = 1;
WALK_COST[Terrain.Forest] = 1.5;
WALK_COST[Terrain.Hills] = 1.6;
WALK_COST[Terrain.Mountain] = 3;
WALK_COST[Terrain.Snow] = 4;
WALK_COST[Terrain.Desert] = 1.3;
WALK_COST[Terrain.Swamp] = 2.5;

const CLIMB_COST = 0.4;
/** Walking a bridge; sailing a tile of water; what a tile of water costs when planning bridges. */
const BRIDGE = 0.8;
const SAIL = 0.7;
const PLAN_WATER = 6;
/** The kinds of search: on foot (bridges included), planning bridges, or able to take a boat from a dock. */
export type SearchMode = 'walk' | 'plan' | 'boat';
/** Walking on pavement costs this share of the ground's usual cost. */
const PAVED = 0.6;
const SQRT2 = Math.SQRT2;
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
] as const;

export class PathFinder {
  readonly size: number;
  private terrain: Uint8Array;
  private elevation: Uint8Array;
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private run = 0;
  private heapKeys: Float32Array;
  private heapItems: Int32Array;
  private heapSize = 0;
  /** Tiles looked at by searches since the counter was last reset (for the per-step budget). */
  expanded = 0;
  /** Fences and gates (see Wall in types.ts): a built fence (2) cannot be walked through. */
  walls?: Uint8Array;
  /** Pavement (2: paved): walking on it costs less, so people walk faster and prefer it. */
  roads?: Uint8Array;
  /** Bridges (2: built) can be walked over water. */
  bridges?: Uint8Array;
  /** Tiles where people can board a boat (at a finished dock). */
  launch?: Uint8Array;

  constructor(size: number, terrain: Uint8Array, elevation: Uint8Array) {
    this.size = size;
    this.terrain = terrain;
    this.elevation = elevation;
    const n = size * size;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    // Big enough for any search within the default limit (a tile can be queued more than once).
    this.heapKeys = new Float32Array(n * 2 + 400_000);
    this.heapItems = new Int32Array(n * 2 + 400_000);
  }

  walkable(i: number) {
    return (WALK_COST[this.terrain[i]] !== Infinity || this.bridges?.[i] === 2) && this.walls?.[i] !== 2;
  }

  /** Whether a tile is open water (no bridge). */
  water(i: number) {
    const t = this.terrain[i];
    return (t === Terrain.DeepWater || t === Terrain.ShallowWater) && this.bridges?.[i] !== 2;
  }

  /** The cost of moving over a tile: walking, a bridge, or sailing on open water. */
  cost(i: number) {
    if (this.bridges?.[i] === 2) return BRIDGE;
    const c = WALK_COST[this.terrain[i]];
    if (c === Infinity) return SAIL;
    return this.roads?.[i] === 2 ? c * PAVED : c;
  }

  /**
   * Which piece of land each tile is on (land joined by bridges counts as one; water is -1), so a
   * search between pieces is not tried on foot, and a boat is tried only from land with a dock.
   * Worked out again after a bridge is built or a dock finished.
   */
  private landId: Int32Array | null = null;
  private dockLand = new Set<number>();
  landDirty = true;
  /** Counts how often the pieces of land were worked out (walk maps made before are out of date). */
  landVersion = 0;

  /** The piece of land a tile is on (-1: water). */
  land(i: number): number {
    if (this.landDirty || !this.landId) this.markLand();
    return this.landId![i];
  }

  /**
   * Whether a tile can be reached on foot from a piece of land: it is on that land, or (water,
   * such as fish) beside it. `from` -1 (someone afloat): anything counts.
   */
  reachable(from: number, t: number): boolean {
    if (from < 0) return true;
    const l = this.land(t);
    if (l >= 0) return l === from;
    const size = this.size;
    const x = t % size;
    const y = (t - x) / size;
    return (x > 0 && this.landId![t - 1] === from) || (x < size - 1 && this.landId![t + 1] === from) || (y > 0 && this.landId![t - size] === from) || (y < size - 1 && this.landId![t + size] === from);
  }

  /** Whether some dock stands on this piece of land. */
  dockOn(land: number): boolean {
    if (this.landDirty || !this.landId) this.markLand();
    return this.dockLand.has(land);
  }

  private markLand() {
    const size = this.size;
    const n = size * size;
    const id = this.landId && this.landId.length === n ? this.landId : new Int32Array(n);
    id.fill(-2);
    const queue = new Int32Array(n);
    let next = 0;
    for (let i = 0; i < n; i++) {
      if (id[i] !== -2) continue;
      if (WALK_COST[this.terrain[i]] === Infinity && this.bridges?.[i] !== 2) {
        id[i] = -1;
        continue;
      }
      let head = 0;
      let tail = 0;
      queue[tail++] = i;
      id[i] = next;
      while (head < tail) {
        const c = queue[head++];
        const x = c % size;
        const y = (c - x) / size;
        // The four straight neighbours: walkers cannot cut a corner past water, so land touching
        // only at a corner is not joined.
        for (const [dx, dy] of N4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const m = ny * size + nx;
          if (id[m] !== -2) continue;
          if (WALK_COST[this.terrain[m]] === Infinity && this.bridges?.[m] !== 2) continue;
          id[m] = next;
          queue[tail++] = m;
        }
      }
      next++;
    }
    this.landId = id;
    this.landVersion++;
    this.dockLand.clear();
    if (this.launch) for (let i = 0; i < n; i++) if (this.launch[i] && id[i] >= 0) this.dockLand.add(id[i]);
    this.landDirty = false;
  }

  /** Whether any dock is ready to board from. */
  get hasBoats() {
    return !!this.launchCount;
  }
  launchCount = 0;

  /**
   * The cheapest way from tile `start` to tile `goal` (tile indexes), as a list of tile
   * indexes after the start, or null if there is none within `limit` tiles looked at.
   */
  find(start: number, goal: number, limit = 20000, mode: SearchMode = 'walk'): number[] | null {
    if (start === goal) return [];
    if (!this.walkable(goal)) return null;
    const plan = mode === 'plan';
    const boat = mode === 'boat';
    const { walls, bridges, roads, terrain } = this;
    // Whether a step onto a tile is allowed, and what it costs (Infinity: not allowed).
    const stepCost = (from: number, to: number): number => {
      if (this.walls?.[to] === 2) return Infinity;
      if (this.bridges?.[to] === 2) return BRIDGE;
      const c0 = WALK_COST[this.terrain[to]];
      if (c0 !== Infinity) return this.roads?.[to] === 2 ? c0 * PAVED : c0;
      // Open water.
      if (plan) return this.terrain[to] === Terrain.ShallowWater ? PLAN_WATER : Infinity;
      if (boat && (this.water(from) || this.launch?.[from])) return SAIL;
      return Infinity;
    };
    const size = this.size;
    const run = ++this.run;
    const gx = goal % size;
    const gy = (goal - gx) / size;
    const h = (i: number) => {
      const x = i % size;
      const y = (i - x) / size;
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    this.heapSize = 0;
    this.g[start] = 0;
    this.stamp[start] = run;
    this.from[start] = -1;
    this.push(start, h(start));
    let looked = 0;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] === run) continue;
      this.closed[cur] = run;
      if (cur === goal) {
        this.expanded += looked;
        return this.trace(start, goal);
      }
      if (++looked > limit) break;
      const cx = cur % size;
      const cy = (cur - cx) / size;
      const ch = this.elevation[cur];
      for (const [dx, dy, len] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (this.closed[ni] === run) continue;
        let c: number;
        if (!plan && !boat) {
          // On foot (the common search), worked out inline.
          if (walls && walls[ni] === 2) continue;
          const onBridge = bridges !== undefined && bridges[ni] === 2;
          const c0 = onBridge ? BRIDGE : WALK_COST[terrain[ni]];
          if (c0 === Infinity) continue;
          c = !onBridge && roads !== undefined && roads[ni] === 2 ? c0 * PAVED : c0;
          // No cutting corners past tiles that cannot be walked.
          if (len !== 1 && (!this.walkable(cy * size + nx) || !this.walkable(ny * size + cx))) continue;
        } else {
          c = stepCost(cur, ni);
          if (c === Infinity) continue;
          // No cutting corners past tiles that cannot be crossed.
          if (len !== 1 && (stepCost(cur, cy * size + nx) === Infinity || stepCost(cur, ny * size + cx) === Infinity)) continue;
        }
        const climb = Math.max(0, this.elevation[ni] - ch) * CLIMB_COST;
        const ng = this.g[cur] + c * len + climb;
        if (this.stamp[ni] !== run || ng < this.g[ni]) {
          this.stamp[ni] = run;
          this.g[ni] = ng;
          this.from[ni] = cur;
          this.push(ni, ng + h(ni));
        }
      }
    }
    this.expanded += looked;
    return null;
  }

  private trace(start: number, goal: number): number[] {
    const out: number[] = [];
    let cur = goal;
    while (cur !== start && cur >= 0) {
      out.push(cur);
      cur = this.from[cur];
    }
    out.reverse();
    return out;
  }

  private push(item: number, key: number) {
    if (this.heapSize >= this.heapItems.length) return;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapKeys[p] <= key) break;
      this.heapKeys[i] = this.heapKeys[p];
      this.heapItems[i] = this.heapItems[p];
      i = p;
    }
    this.heapKeys[i] = key;
    this.heapItems[i] = item;
  }

  private pop(): number {
    const top = this.heapItems[0];
    const key = this.heapKeys[--this.heapSize];
    const item = this.heapItems[this.heapSize];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.heapSize) break;
      if (c + 1 < this.heapSize && this.heapKeys[c + 1] < this.heapKeys[c]) c++;
      if (this.heapKeys[c] >= key) break;
      this.heapKeys[i] = this.heapKeys[c];
      this.heapItems[i] = this.heapItems[c];
      i = c;
    }
    this.heapKeys[i] = key;
    this.heapItems[i] = item;
    return top;
  }
}
