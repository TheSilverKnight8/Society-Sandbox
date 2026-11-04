import { hash2 } from '../lib/rng';
import { Deposit, isWater } from '../map/terrain';
import { CHUNK, STEP, isoX, isoY, type TileSource } from './iso';
import { FACE_L, FACE_R, GROUND, NAVY } from './style';
import { biomeDetail, biomeSparse, deposit as drawDepositMark, fence } from './symbols';

// Draws the terrain in chunks of CHUNK x CHUNK tiles and keeps each drawn chunk as a
// picture (an offscreen canvas). A frame then only copies pictures to the screen.
//
// Each chunk is kept at a few detail levels (pixels per tile width: 4 to 128); the
// view picks the level nearest above the current zoom and scales it down slightly.
// Pictures are dropped least recently used first when they pass a memory budget.
//
// The look: each biome's ground has its natural color, cliff sides are that color shaded,
// everything has navy outlines with round ends, and a few drawings sit on the tiles in the
// same flat, outlined style as the trees, people and buildings. The map's outer edge is a
// navy slab. Zoomed far out, one larger drawing stands for a patch of tiles.

export const LEVELS = [4, 8, 16, 32, 64, 128] as const;

/** Most pixels kept in chunk pictures at once (about 4 bytes each). */
const PIXEL_BUDGET = 40_000_000;
/** How far the map's outer edge shows below sea level, in elevation steps. */
const SKIRT = 2;

/** At each detail level: one drawing every `grid` tiles, `scale` times the size; room kept around a chunk for drawings that stick out. */
function levelStyle(level: number) {
  if (level <= 4) return { grid: 8, scale: 6.5, top: 3.4, side: 2, lineV: 1.3 };
  if (level <= 8) return { grid: 4, scale: 3.4, top: 1.9, side: 1.1, lineV: 1.5 };
  if (level <= 16) return { grid: 2, scale: 1.7, top: 1, side: 0.6, lineV: 1.9 };
  return { grid: 1, scale: 1, top: 0.7, side: 0.35, lineV: level >= 128 ? 5.6 : level >= 64 ? 3.8 : 2.6 };
}
const MAX_STYLE = levelStyle(4);

// ---------------------------------------------------------------- chunks

interface Entry {
  canvas: HTMLCanvasElement;
  level: number;
  /** Iso position of the picture's top-left corner. */
  x0: number;
  y0: number;
  pixels: number;
  used: number;
  dirty: boolean;
}

export interface ChunkBounds {
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class TerrainChunks {
  src: TileSource;
  readonly n: number;
  private entries = new Map<number, Entry>();
  private pixels = 0;
  private clock = 0;
  /** Pictures used since this clock value are on screen now and must not be dropped. */
  private frameStart = 0;
  /** Highest elevation in each chunk, for its bounds. */
  private maxH: Uint8Array;
  private bounds: ChunkBounds[] = [];

  constructor(src: TileSource) {
    this.src = src;
    this.n = Math.ceil(src.size / CHUNK);
    this.maxH = new Uint8Array(this.n * this.n);
    for (let cy = 0; cy < this.n; cy++) for (let cx = 0; cx < this.n; cx++) this.measure(cx, cy);
    this.rebuildBounds();
  }

  /** Call at the start of each frame, so pictures on screen are kept even past the memory budget. */
  beginFrame() {
    this.frameStart = this.clock + 1;
  }

  /** Chunk bounds in iso units, in the order they must be drawn (back to front). */
  ordered(): ChunkBounds[] {
    return this.bounds;
  }

  private measure(cx: number, cy: number) {
    const { size, elevation } = this.src;
    let m = 0;
    for (let y = cy * CHUNK; y < Math.min(size, (cy + 1) * CHUNK); y++) {
      for (let x = cx * CHUNK; x < Math.min(size, (cx + 1) * CHUNK); x++) m = Math.max(m, elevation[y * size + x]);
    }
    this.maxH[cy * this.n + cx] = m;
  }

  private rebuildBounds() {
    this.bounds = [];
    for (let s = 0; s <= 2 * (this.n - 1); s++) {
      for (let x = Math.max(0, s - this.n + 1); x <= Math.min(s, this.n - 1); x++) this.bounds.push(this.chunkBounds(x, s - x));
    }
  }

  private chunkBounds(cx: number, cy: number, top = MAX_STYLE.top, side = MAX_STYLE.side): ChunkBounds {
    const size = this.src.size;
    const tx0 = cx * CHUNK;
    const ty0 = cy * CHUNK;
    const tx1 = Math.min(size, tx0 + CHUNK);
    const ty1 = Math.min(size, ty0 + CHUNK);
    const h = this.maxH[cy * this.n + cx];
    return {
      cx,
      cy,
      x0: isoX(tx0, ty1 - 1) - 0.5 - side,
      x1: isoX(tx1 - 1, ty0) + 0.5 + side,
      y0: isoY(tx0, ty0, h) - top,
      y1: isoY(tx1 - 1, ty1 - 1, 0) + 0.5 + SKIRT * STEP + 0.02,
    };
  }

  private key(cx: number, cy: number, level: number) {
    return (cy * this.n + cx) * 8 + LEVELS.indexOf(level as (typeof LEVELS)[number]);
  }

  /** A ready picture of the chunk at this level, or another level's as a stand-in, or none. */
  get(cx: number, cy: number, level: number): Entry | undefined {
    const e = this.entries.get(this.key(cx, cy, level));
    if (e) e.used = ++this.clock;
    return e;
  }

  fallback(cx: number, cy: number, level: number): Entry | undefined {
    let best: Entry | undefined;
    for (const l of LEVELS) {
      const e = this.entries.get(this.key(cx, cy, l));
      if (!e) continue;
      if (!best || Math.abs(Math.log2(l / level)) < Math.abs(Math.log2(best.level / level))) best = e;
    }
    if (best) best.used = ++this.clock;
    return best;
  }

  /** Draws the chunk at this level and keeps the picture. */
  render(cb: ChunkBounds, level: number): Entry {
    const st = levelStyle(level);
    const b = this.chunkBounds(cb.cx, cb.cy, st.top, st.side);
    const key = this.key(b.cx, b.cy, level);
    const old = this.entries.get(key);
    const w = Math.max(1, Math.ceil((b.x1 - b.x0) * level));
    const h = Math.max(1, Math.ceil((b.y1 - b.y0) * level));
    let canvas: HTMLCanvasElement;
    if (old && old.canvas.width === w && old.canvas.height === h) {
      canvas = old.canvas;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(level, 0, 0, level, -b.x0 * level, -b.y0 * level);
    drawChunkTiles(ctx, this.src, b.cx, b.cy, level);

    if (old) this.pixels -= old.pixels;
    const entry: Entry = { canvas, level, x0: b.x0, y0: b.y0, pixels: w * h, used: ++this.clock, dirty: false };
    this.entries.set(key, entry);
    this.pixels += entry.pixels;
    this.evict();
    return entry;
  }

  private evict() {
    if (this.pixels <= PIXEL_BUDGET) return;
    const list = [...this.entries.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of list) {
      if (this.pixels <= PIXEL_BUDGET * 0.8 || e.used >= this.frameStart) break;
      this.entries.delete(k);
      this.pixels -= e.pixels;
    }
  }

  /**
   * Marks the chunks that show a changed tile as out of date. A tile's side faces are
   * drawn by the tiles behind it, so their chunks change too. Old pictures stay on screen
   * until the new ones are drawn.
   */
  invalidate(tiles: Iterable<number>) {
    const size = this.src.size;
    const chunks = new Set<number>();
    for (const i of tiles) {
      const x = i % size;
      const y = (i - x) / size;
      for (const [xx, yy] of [
        [x, y],
        [x - 1, y],
        [x, y - 1],
      ]) {
        if (xx < 0 || yy < 0) continue;
        chunks.add(Math.floor(yy / CHUNK) * this.n + Math.floor(xx / CHUNK));
      }
    }
    for (const c of chunks) {
      const cx = c % this.n;
      const cy = (c - cx) / this.n;
      const before = this.maxH[c];
      this.measure(cx, cy);
      for (let l = 0; l < LEVELS.length; l++) {
        const e = this.entries.get(c * 8 + l);
        if (!e) continue;
        if (this.maxH[c] !== before) {
          // The chunk's picture changes size; drop it rather than draw it out of place.
          this.entries.delete(c * 8 + l);
          this.pixels -= e.pixels;
        } else e.dirty = true;
      }
    }
    if (chunks.size) this.rebuildBounds();
  }

  /** Drops every picture (for example after the whole map is regenerated). */
  clear() {
    this.entries.clear();
    this.pixels = 0;
    for (let cy = 0; cy < this.n; cy++) for (let cx = 0; cx < this.n; cx++) this.measure(cx, cy);
    this.rebuildBounds();
  }
}

// ---------------------------------------------------------------- drawing

function drawChunkTiles(ctx: CanvasRenderingContext2D, src: TileSource, cx: number, cy: number, level: number) {
  const { size, terrain, elevation, deposit } = src;
  const tx0 = cx * CHUNK;
  const ty0 = cy * CHUNK;
  const tx1 = Math.min(size, tx0 + CHUNK);
  const ty1 = Math.min(size, ty0 + CHUNK);
  const st = levelStyle(level);
  // Shapes overlap by about half a pixel so no seams show between tiles.
  const e = 0.55 / level;
  const lw = st.lineV / level;
  const outlines = level >= 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;

  for (let s = tx0 + ty0; s <= tx1 - 1 + ty1 - 1; s++) {
    const xs = Math.max(tx0, s - (ty1 - 1));
    const xe = Math.min(tx1 - 1, s - ty0);
    for (let x = xs; x <= xe; x++) {
      const y = s - x;
      const i = y * size + x;
      const t = terrain[i];
      const h = elevation[i];
      const water = isWater(t);
      const X = isoX(x, y);
      const Y = isoY(x, y, h);

      // Side faces down to the lower neighbor in front (left: tile y+1, right: tile x+1).
      // The map's outer edge is a solid navy slab, like Stickman Arena's stages.
      const hl = y + 1 < size ? elevation[i + size] : -SKIRT;
      const hr = x + 1 < size ? elevation[i + 1] : -SKIRT;
      const dl = hl < h ? (h - hl) * STEP : 0;
      const dr = hr < h ? (h - hr) * STEP : 0;
      if (dl > 0) {
        ctx.fillStyle = y + 1 >= size ? NAVY : FACE_L[t];
        ctx.beginPath();
        ctx.moveTo(X - 0.5 - e, Y + 0.25);
        ctx.lineTo(X + e, Y + 0.5);
        ctx.lineTo(X + e, Y + 0.5 + dl + e);
        ctx.lineTo(X - 0.5 - e, Y + 0.25 + dl + e);
        ctx.fill();
      }
      if (dr > 0) {
        ctx.fillStyle = x + 1 >= size ? NAVY : FACE_R[t];
        ctx.beginPath();
        ctx.moveTo(X - e, Y + 0.5);
        ctx.lineTo(X + 0.5 + e, Y + 0.25);
        ctx.lineTo(X + 0.5 + e, Y + 0.25 + dr + e);
        ctx.lineTo(X - e, Y + 0.5 + dr + e);
        ctx.fill();
      }

      // Top face: the biome's natural color.
      ctx.fillStyle = GROUND[t];
      ctx.beginPath();
      ctx.moveTo(X, Y - e);
      ctx.lineTo(X + 0.5 + 2 * e, Y + 0.25);
      ctx.lineTo(X, Y + 0.5 + e);
      ctx.lineTo(X - 0.5 - 2 * e, Y + 0.25);
      ctx.fill();

      // A settlement's land: a light red tint (or its color on a map view), with a dashed border where it ends.
      const own = src.territory ? src.territory[i] : 0;
      if (own) {
        ctx.fillStyle = src.landColors?.get(own) ?? 'rgba(252, 63, 63, 0.09)';
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X + 0.5, Y + 0.25);
        ctx.lineTo(X, Y + 0.5);
        ctx.lineTo(X - 0.5, Y + 0.25);
        ctx.fill();
        const ter = src.territory!;
        const other = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= size || yy >= size || ter[yy * size + xx] !== own;
        ctx.beginPath();
        if (other(x - 1, y)) {
          ctx.moveTo(X - 0.5, Y + 0.25);
          ctx.lineTo(X, Y);
        }
        if (other(x, y - 1)) {
          ctx.moveTo(X, Y);
          ctx.lineTo(X + 0.5, Y + 0.25);
        }
        if (other(x + 1, y)) {
          ctx.moveTo(X + 0.5, Y + 0.25);
          ctx.lineTo(X, Y + 0.5);
        }
        if (other(x, y + 1)) {
          ctx.moveTo(X, Y + 0.5);
          ctx.lineTo(X - 0.5, Y + 0.25);
        }
        ctx.strokeStyle = NAVY;
        ctx.lineWidth = lw * 1.1;
        if (level >= 16) ctx.setLineDash([0.12, 0.08]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = lw;
      }

      // Outlines along every step down in the land, front and back, so terraces read as line art.
      if (outlines && !water) {
        const hb1 = x > 0 ? elevation[i - 1] : h;
        const hb2 = y > 0 ? elevation[i - size] : h;
        ctx.strokeStyle = NAVY;
        ctx.lineWidth = lw * 0.8;
        ctx.beginPath();
        if (hb1 < h) {
          ctx.moveTo(X - 0.5, Y + 0.25);
          ctx.lineTo(X, Y);
        }
        if (hb2 < h) {
          ctx.moveTo(X, Y);
          ctx.lineTo(X + 0.5, Y + 0.25);
        }
        if (dl > 0) {
          ctx.moveTo(X - 0.5, Y + 0.25);
          ctx.lineTo(X, Y + 0.5);
          ctx.moveTo(X - 0.5, Y + 0.25 + dl);
          ctx.lineTo(X, Y + 0.5 + dl);
        }
        if (dr > 0) {
          ctx.moveTo(X, Y + 0.5);
          ctx.lineTo(X + 0.5, Y + 0.25);
          ctx.moveTo(X, Y + 0.5 + dr);
          ctx.lineTo(X + 0.5, Y + 0.25 + dr);
        }
        if (dl > 0 || dr > 0) {
          ctx.moveTo(X, Y + 0.5);
          ctx.lineTo(X, Y + 0.5 + Math.max(dl, dr));
        }
        ctx.stroke();
        ctx.lineWidth = lw;
      }

      // What the tile is: a line drawing on it.
      const cxp = X;
      const cyp = Y + 0.27;
      const wall = src.walls ? src.walls[i] : 0;
      if (wall === 2 || wall === 4) {
        // A town's fence or gate (drawn at every zoom; it is part of the town's shape).
        const W = src.walls!;
        const built = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < size && yy < size && (W[yy * size + xx] === 2 || W[yy * size + xx] === 4);
        fence(ctx, X, Y, { nw: built(x - 1, y), ne: built(x, y - 1), se: built(x + 1, y), sw: built(x, y + 1) }, wall === 4, lw);
      } else if (src.covered?.[i]) {
        // A building stands here.
      } else if (st.grid === 1) {
        biomeDetail(ctx, t, x, y, h, cxp, cyp, lw, src.trees ? src.trees[i] : undefined);
        const d = deposit[i];
        if (d !== Deposit.None) {
          const ox = (hash2(x, y, 51) - 0.5) * 0.1;
          drawDepositMark(ctx, d, cxp + ox, cyp + 0.02, 1, lw, src.empty?.[i] === 1);
        }
      } else {
        // Zoomed out: one larger drawing on one tile of each grid x grid patch, at a fixed random spot in the patch.
        const g = st.grid;
        const gx = Math.floor(x / g);
        const gy = Math.floor(y / g);
        if (x - gx * g === Math.floor(hash2(gx, gy, 61) * g) && y - gy * g === Math.floor(hash2(gx, gy, 62) * g)) {
          biomeSparse(ctx, t, x, y, h, cxp, cyp, st.scale, lw, src.trees ? src.trees[i] : undefined);
        }
      }
    }
  }
}
