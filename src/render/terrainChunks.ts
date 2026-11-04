import { hash2 } from '../lib/rng';
import { DEPOSITS, Deposit, MAX_ELEV, TERRAINS, Terrain } from '../map/terrain';
import { CHUNK, STEP, isoX, isoY, type TileSource } from './iso';

// Draws the terrain in chunks of CHUNK x CHUNK tiles and keeps each drawn chunk as a
// picture (an offscreen canvas). A frame then only copies pictures to the screen.
//
// Each chunk is kept at a few detail levels (pixels per tile width: 4 to 128); the
// view picks the level nearest above the current zoom and scales it down slightly.
// Pictures are dropped least recently used first when they pass a memory budget.

export const LEVELS = [4, 8, 16, 32, 64, 128] as const;

/** Most pixels kept in chunk pictures at once (about 4 bytes each). */
const PIXEL_BUDGET = 40_000_000;
/** Room above a chunk's highest tile for trees, in tile widths. */
const TOP_MARGIN = 0.7;
/** How far the map's outer edge shows below sea level, in elevation steps. */
const SKIRT = 2;

// ---------------------------------------------------------------- colors

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgb([r, g, b]: [number, number, number], k: number, lift = 0) {
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, c * k + (255 - c) * lift)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

const VARIANTS = 4;
/** Shading by slope: the tile behind is much higher (in shadow) ... much lower (lit). */
const SLOPES = 5;
/**
 * Colors per terrain and elevation: SLOPES x VARIANTS top colors (index slope * VARIANTS + variant),
 * then the left face and the right face. Higher ground is a little lighter, so relief
 * still reads when zoomed far out.
 */
const PALETTE: string[][][] = TERRAINS.map((t) => {
  const base = hexToRgb(t.top);
  const perElev: string[][] = [];
  for (let h = 0; h <= MAX_ELEV; h++) {
    const lift = t.water ? 0 : h * 0.018;
    const tops: string[] = [];
    for (let sl = 0; sl < SLOPES; sl++) {
      const k = t.water ? 1 : 1 + (sl - 2) * 0.045;
      for (let v = 0; v < VARIANTS; v++) tops.push(rgb(base, k + (v - 1.5) * 0.016, lift));
    }
    perElev.push([...tops, rgb(base, t.water ? 0.82 : 0.8, lift * 0.5), rgb(base, t.water ? 0.7 : 0.64, lift * 0.5)]);
  }
  return perElev;
});
const FACE_L = SLOPES * VARIANTS;
const FACE_R = FACE_L + 1;

const TREE = { leaf: '#3f7d38', leafLight: '#52914a', pine: '#2f6a3c', pineLight: '#3d7d48', trunk: '#6b4a2f' };

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

  private chunkBounds(cx: number, cy: number): ChunkBounds {
    const size = this.src.size;
    const tx0 = cx * CHUNK;
    const ty0 = cy * CHUNK;
    const tx1 = Math.min(size, tx0 + CHUNK);
    const ty1 = Math.min(size, ty0 + CHUNK);
    const h = this.maxH[cy * this.n + cx];
    return {
      cx,
      cy,
      x0: isoX(tx0, ty1 - 1) - 0.5,
      x1: isoX(tx1 - 1, ty0) + 0.5,
      y0: isoY(tx0, ty0, h) - TOP_MARGIN,
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
  render(b: ChunkBounds, level: number): Entry {
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
      if (this.pixels <= PIXEL_BUDGET * 0.8) break;
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
  // Shapes overlap by about half a pixel so no seams show between tiles.
  const e = 0.55 / level;
  const detail = level >= 16 ? 2 : level >= 8 ? 1 : 0;

  for (let s = tx0 + ty0; s <= tx1 - 1 + ty1 - 1; s++) {
    const xs = Math.max(tx0, s - (ty1 - 1));
    const xe = Math.min(tx1 - 1, s - ty0);
    for (let x = xs; x <= xe; x++) {
      const y = s - x;
      const i = y * size + x;
      const t = terrain[i];
      const h = elevation[i];
      const X = isoX(x, y);
      const Y = isoY(x, y, h);
      const pal = PALETTE[t][h];

      // Side faces down to the lower neighbor in front (left: tile y+1, right: tile x+1).
      const hl = y + 1 < size ? elevation[i + size] : -SKIRT;
      const hr = x + 1 < size ? elevation[i + 1] : -SKIRT;
      if (hl < h) {
        const d = (h - hl) * STEP;
        ctx.fillStyle = pal[FACE_L];
        ctx.beginPath();
        ctx.moveTo(X - 0.5 - e, Y + 0.25);
        ctx.lineTo(X + e, Y + 0.5);
        ctx.lineTo(X + e, Y + 0.5 + d + e);
        ctx.lineTo(X - 0.5 - e, Y + 0.25 + d + e);
        ctx.fill();
      }
      if (hr < h) {
        const d = (h - hr) * STEP;
        ctx.fillStyle = pal[FACE_R];
        ctx.beginPath();
        ctx.moveTo(X - e, Y + 0.5);
        ctx.lineTo(X + 0.5 + e, Y + 0.25);
        ctx.lineTo(X + 0.5 + e, Y + 0.25 + d + e);
        ctx.lineTo(X - e, Y + 0.5 + d + e);
        ctx.fill();
      }

      // Top face, lit from the back: darker where the ground behind is higher, lighter where it is lower.
      const hb = x > 0 && y > 0 ? elevation[i - size - 1] : h;
      const slope = Math.max(0, Math.min(SLOPES - 1, 2 + h - hb));
      ctx.fillStyle = pal[slope * VARIANTS + Math.floor(hash2(x, y) * VARIANTS)];
      ctx.beginPath();
      ctx.moveTo(X, Y - e);
      ctx.lineTo(X + 0.5 + 2 * e, Y + 0.25);
      ctx.lineTo(X, Y + 0.5 + e);
      ctx.lineTo(X - 0.5 - 2 * e, Y + 0.25);
      ctx.fill();

      if (detail > 0) {
        if (t === Terrain.Forest) drawTrees(ctx, x, y, X, Y, h, detail);
        else if (t === Terrain.Swamp) drawSwamp(ctx, x, y, X, Y, detail);
        const d = deposit[i];
        if (d !== Deposit.None) drawDeposit(ctx, d, x, y, X, Y, detail);
      }
    }
  }
}

function drawTrees(ctx: CanvasRenderingContext2D, x: number, y: number, X: number, Y: number, h: number, detail: number) {
  const count = 2 + (hash2(x, y, 7) < 0.4 ? 1 : 0);
  // Back to front inside the tile, so nearer trees cover farther ones.
  const spots: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    const u = 0.18 + hash2(x, y, 11 + k) * 0.64;
    const v = 0.18 + hash2(x, y, 23 + k) * 0.64;
    spots.push([u, v]);
  }
  spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const pine = h >= 5 || hash2(x, y, 31) < 0.25;
  for (const [u, v] of spots) {
    const px = X + (u - v) * 0.5;
    const py = Y + (u + v) * 0.25;
    if (detail === 1) {
      ctx.fillStyle = pine ? TREE.pine : TREE.leaf;
      ctx.beginPath();
      ctx.arc(px, py - 0.08, 0.1, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.fillStyle = TREE.trunk;
    ctx.fillRect(px - 0.018, py - 0.09, 0.036, 0.1);
    if (pine) {
      ctx.fillStyle = TREE.pine;
      ctx.beginPath();
      ctx.moveTo(px, py - 0.42);
      ctx.lineTo(px + 0.11, py - 0.06);
      ctx.lineTo(px - 0.11, py - 0.06);
      ctx.fill();
      ctx.fillStyle = TREE.pineLight;
      ctx.beginPath();
      ctx.moveTo(px, py - 0.42);
      ctx.lineTo(px, py - 0.06);
      ctx.lineTo(px - 0.11, py - 0.06);
      ctx.fill();
    } else {
      ctx.fillStyle = TREE.leaf;
      ctx.beginPath();
      ctx.arc(px, py - 0.2, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = TREE.leafLight;
      ctx.beginPath();
      ctx.arc(px - 0.035, py - 0.235, 0.065, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSwamp(ctx: CanvasRenderingContext2D, x: number, y: number, X: number, Y: number, detail: number) {
  const u = 0.3 + hash2(x, y, 41) * 0.4;
  const v = 0.3 + hash2(x, y, 43) * 0.4;
  const px = X + (u - v) * 0.5;
  const py = Y + (u + v) * 0.25;
  ctx.fillStyle = '#5f8578';
  ctx.beginPath();
  ctx.ellipse(px, py, 0.16, 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  if (detail < 2) return;
  ctx.strokeStyle = '#4f6b3a';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const rx = px + 0.12 + k * 0.035;
    ctx.moveTo(rx, py + 0.02);
    ctx.lineTo(rx + (k - 1) * 0.015, py - 0.1);
  }
  ctx.stroke();
}

function drawDeposit(ctx: CanvasRenderingContext2D, d: number, x: number, y: number, X: number, Y: number, detail: number) {
  const def = DEPOSITS[d];
  const px = X + (hash2(x, y, 51) - 0.5) * 0.12;
  const py = Y + 0.27 + (hash2(x, y, 53) - 0.5) * 0.06;
  if (detail === 1) {
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(px, py - 0.03, 0.07, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  switch (d) {
    case Deposit.Stone:
    case Deposit.Iron:
    case Deposit.Gold: {
      const body = d === Deposit.Stone ? '#b7b2a8' : '#8c8780';
      const shade = d === Deposit.Stone ? '#8e897f' : '#6a655e';
      rock(ctx, px - 0.07, py, 0.1, body, shade);
      rock(ctx, px + 0.07, py + 0.03, 0.075, body, shade);
      if (d !== Deposit.Stone) {
        ctx.fillStyle = def.color;
        for (const [ox, oy] of [
          [-0.09, -0.04],
          [-0.04, -0.01],
          [0.08, 0.0],
        ]) {
          ctx.beginPath();
          ctx.arc(px + ox, py + oy, 0.02, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case Deposit.Clay:
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.ellipse(px, py, 0.17, 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a8633d';
      ctx.beginPath();
      ctx.ellipse(px + 0.03, py + 0.012, 0.08, 0.032, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case Deposit.Fish:
      // Dark fish shapes under the surface.
      ctx.fillStyle = '#2f6a96';
      for (const [ox, oy, dir] of [
        [-0.08, -0.02, 1],
        [0.07, 0.035, -1],
      ]) {
        const fx = px + ox;
        const fy = py + oy;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 0.055, 0.022, 0, 0, Math.PI * 2);
        ctx.moveTo(fx - dir * 0.045, fy);
        ctx.lineTo(fx - dir * 0.09, fy - 0.025);
        ctx.lineTo(fx - dir * 0.09, fy + 0.025);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case Deposit.Berries:
      ctx.fillStyle = '#4c8a43';
      ctx.beginPath();
      ctx.ellipse(px, py - 0.04, 0.11, 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = def.color;
      for (const [ox, oy] of [
        [-0.05, -0.05],
        [0.02, -0.07],
        [0.05, -0.02],
        [-0.01, -0.02],
      ]) {
        ctx.beginPath();
        ctx.arc(px + ox, py + oy, 0.018, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
  }
}

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, body: string, shade: string) {
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.12, y - r * 0.14, r * 0.82, r * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
}
