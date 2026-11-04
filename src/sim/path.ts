import { Terrain } from '../map/terrain';

// Finding a way across the map (A* search on the tile grid, 8 directions).
//
// Each terrain has a walking cost: open ground is cheapest, swamps, shallow water and
// mountains are slow, deep water cannot be crossed. Climbing a level costs a little extra.
// The search's working arrays are made once and reused, so a search makes no garbage.

/** Cost of walking onto a tile of each terrain; Infinity = cannot be walked. */
export const WALK_COST: number[] = [];
WALK_COST[Terrain.DeepWater] = Infinity;
WALK_COST[Terrain.ShallowWater] = 3;
WALK_COST[Terrain.Sand] = 1.2;
WALK_COST[Terrain.Grassland] = 1;
WALK_COST[Terrain.Forest] = 1.5;
WALK_COST[Terrain.Hills] = 1.6;
WALK_COST[Terrain.Mountain] = 3;
WALK_COST[Terrain.Snow] = 4;
WALK_COST[Terrain.Desert] = 1.3;
WALK_COST[Terrain.Swamp] = 2.5;

const CLIMB_COST = 0.4;
const SQRT2 = Math.SQRT2;
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
    return WALK_COST[this.terrain[i]] !== Infinity && this.walls?.[i] !== 2;
  }

  cost(i: number) {
    return WALK_COST[this.terrain[i]];
  }

  /**
   * The cheapest way from tile `start` to tile `goal` (tile indexes), as a list of tile
   * indexes after the start, or null if there is none within `limit` tiles looked at.
   */
  find(start: number, goal: number, limit = 20000): number[] | null {
    if (start === goal) return [];
    if (!this.walkable(goal)) return null;
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
        const c = WALK_COST[this.terrain[ni]];
        if (c === Infinity || this.walls?.[ni] === 2) continue;
        // No cutting corners past tiles that cannot be walked.
        if (len !== 1 && (!this.walkable(cy * size + nx) || !this.walkable(ny * size + cx))) continue;
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
