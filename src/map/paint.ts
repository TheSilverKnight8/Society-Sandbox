import { Deposit, Terrain, depositFits, isWater, terrainDef } from './terrain';
import type { Tiles } from './generate';

// Painting tools for Map mode. A stroke is everything from pressing the mouse button to
// letting go. Each tile is changed at most once per stroke (raising by one level per
// stroke, for example), and the stroke remembers each tile's old values so it can be undone.

export type Tool =
  | { kind: 'terrain'; terrain: Terrain }
  | { kind: 'height'; mode: 'raise' | 'lower' | 'flatten' | 'smooth' }
  | { kind: 'deposit'; deposit: Deposit };

/** Old values of the tiles a stroke changed: tile index -> terrain | elevation << 8 | deposit << 16. */
export type Undo = Map<number, number>;

export class Stroke {
  readonly undo: Undo = new Map();
  private tiles: Tiles;
  private size: number;
  private tool: Tool;
  /** Flatten: the level of the first tile touched. */
  private level = -1;
  /** Smooth: elevations from before the stroke, so smoothing does not feed on itself. */
  private before: Uint8Array | null = null;

  constructor(tiles: Tiles, size: number, tool: Tool) {
    this.tiles = tiles;
    this.size = size;
    this.tool = tool;
    if (tool.kind === 'height' && tool.mode === 'smooth') this.before = tiles.elevation.slice();
  }

  /** Applies the tool in a circle of `radius` tiles around (cx, cy). Returns the tiles it changed. */
  apply(cx: number, cy: number, radius: number): number[] {
    const { size, tiles, tool } = this;
    if (this.level < 0) this.level = tiles.elevation[cy * size + cx];
    const changed: number[] = [];
    const r = radius - 0.5;
    for (const [x, y] of brushTiles(cx, cy, r, size)) {
      const i = y * size + x;
      if (this.undo.has(i)) continue;
      const old = tiles.terrain[i] | (tiles.elevation[i] << 8) | (tiles.deposit[i] << 16);
      this.paintTile(i, x, y, tool);
      const now = tiles.terrain[i] | (tiles.elevation[i] << 8) | (tiles.deposit[i] << 16);
      if (now !== old) {
        this.undo.set(i, old);
        changed.push(i);
      }
    }
    return changed;
  }

  private paintTile(i: number, x: number, y: number, tool: Tool) {
    const { terrain, elevation, deposit } = this.tiles;
    if (tool.kind === 'terrain') {
      const wasWater = isWater(terrain[i]);
      const def = terrainDef(tool.terrain);
      let e = elevation[i];
      // Land painted onto the sea rises out of it; everything else keeps its height within the new type's range.
      if (wasWater && !def.water && e === 0) e = 1;
      terrain[i] = tool.terrain;
      elevation[i] = clamp(e, def.minElev, def.maxElev);
      if (!depositFits(deposit[i], tool.terrain)) deposit[i] = Deposit.None;
      return;
    }
    if (tool.kind === 'deposit') {
      if (depositFits(tool.deposit, terrain[i])) deposit[i] = tool.deposit;
      return;
    }
    const def = terrainDef(terrain[i]);
    let e = elevation[i];
    if (tool.mode === 'raise') e += 1;
    else if (tool.mode === 'lower') e -= 1;
    else if (tool.mode === 'flatten') e = this.level;
    else if (tool.mode === 'smooth' && this.before) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= this.size || yy >= this.size) continue;
          sum += this.before[yy * this.size + xx];
          count++;
        }
      }
      e = Math.round(sum / count);
    }
    elevation[i] = clamp(e, def.minElev, def.maxElev);
  }
}

/** Tiles inside a circle of radius r around (cx, cy), within the map. */
export function brushTiles(cx: number, cy: number, r: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r * r + 0.01) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** Puts tiles back to their values in `undo`, and returns what they were just before (for redo). */
export function restore(tiles: Tiles, undo: Undo): Undo {
  const redo: Undo = new Map();
  for (const [i, v] of undo) {
    redo.set(i, tiles.terrain[i] | (tiles.elevation[i] << 8) | (tiles.deposit[i] << 16));
    tiles.terrain[i] = v & 255;
    tiles.elevation[i] = (v >> 8) & 255;
    tiles.deposit[i] = (v >> 16) & 255;
  }
  return redo;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
