// Isometric projection.
//
// "Iso units" are the drawing's own coordinates: a tile is 1 unit wide and 0.5 tall on
// screen. Tile (x, y) at elevation h has the top corner of its diamond at
//   X = (x - y) / 2,   Y = (x + y) / 4 - h * STEP
// and the camera turns iso units into screen pixels with one zoom factor
// (screen pixels per tile width).

/** How far one level of elevation lifts a tile, in tile widths. */
export const STEP = 0.11;

/** Tiles per side of a terrain chunk (the unit the renderer caches as one picture). */
export const CHUNK = 16;

export const isoX = (x: number, y: number) => (x - y) * 0.5;
export const isoY = (x: number, y: number, h: number) => (x + y) * 0.25 - h * STEP;

/** The tile data the renderer needs. A map in Map mode, and later a running world, both provide it. */
export interface TileSource {
  size: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  deposit: Uint8Array;
  /** 1 where a deposit has been used up for now (berries picked, fish caught); drawn without its goods. */
  empty?: Uint8Array;
  /** Trees standing on each forest tile, when trees can be cut (a running world). */
  trees?: Uint8Array;
  /** Which settlement owns each tile (0: none), drawn as a tint with a dashed border. */
  territory?: Uint16Array;
  /** 1 where a building stands: the tile's drawings (grass, hills, deposits) are left off. */
  covered?: Uint8Array;
  /** Fences and gates (see Wall in sim/types.ts): 2 a built fence, 4 a built gate. */
  walls?: Uint8Array;
  /** Pavement (2: paved): drawn as stone slabs, without the tile's other drawings. */
  roads?: Uint8Array;
  /** On a colored map view (cultures, later nations): each settlement's land tint, by settlement ID. Unset: the plain red tint. */
  landColors?: Map<number, string>;
}
