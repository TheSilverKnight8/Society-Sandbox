// The shape of a map made in Map mode.
//
// A map is a square grid of tiles. Each tile has three numbers, kept in three flat byte
// arrays (index = y * size + x): its terrain type, its elevation, and its deposit (a tile
// resource, or none). Byte arrays keep a 512 x 512 map small (768 KB) and fast to draw.

export interface GenSettings {
  seed: number;
  shape: 'continent' | 'continents' | 'islands';
  /** Share of the map that is land, 0.2 to 0.8. */
  land: number;
  /** 0 to 1 for each. */
  mountains: number;
  forests: number;
  deserts: number;
  /** Number of rivers to try to place. */
  rivers: number;
  /** How many deposits (stone, ore, clay, fish, berries), 0 to 1. */
  resources: number;
}

export interface MapData {
  id: string;
  name: string;
  /** Width and height in tiles. */
  size: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  deposit: Uint8Array;
  /** The settings last used to generate it, so Map mode can offer them again. Absent for a map started blank. */
  gen?: GenSettings;
  createdAt: string;
  updatedAt: string;
}

/** The small part of a map that Home lists. */
export interface MapMeta {
  id: string;
  name: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  /** A small picture of the map (PNG data URL). */
  thumbnail?: string;
}

/** Sizes offered when making a map. WorldBox's "Titanic" world is 512 x 512 tiles (SPEC 2 compares the scale to it). */
export const MAP_SIZES = [
  { size: 128, label: 'Small', note: '128 × 128' },
  { size: 256, label: 'Medium', note: '256 × 256' },
  { size: 384, label: 'Large', note: '384 × 384' },
  { size: 512, label: 'Titanic', note: '512 × 512' },
] as const;

export const DEFAULT_SIZE = 512;

export const DEFAULT_GEN: Omit<GenSettings, 'seed'> = {
  shape: 'continent',
  land: 0.5,
  mountains: 0.5,
  forests: 0.5,
  deserts: 0.25,
  rivers: 14,
  resources: 0.5,
};

export function metaOf(map: MapData, thumbnail?: string): MapMeta {
  return { id: map.id, name: map.name, size: map.size, createdAt: map.createdAt, updatedAt: map.updatedAt, thumbnail };
}
