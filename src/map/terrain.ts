// Terrain types and resource deposits that a map's tiles can hold.
//
// The map is fixed once a setup is made from it (SPEC 3): terrain and elevation never
// change during a run. Deposits are the tile resources the map starts with; later stages
// let the simulation use them up.

export const Terrain = {
  DeepWater: 0,
  ShallowWater: 1,
  Sand: 2,
  Grassland: 3,
  Forest: 4,
  Hills: 5,
  Mountain: 6,
  Snow: 7,
  Desert: 8,
  Swamp: 9,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export interface TerrainDef {
  id: Terrain;
  name: string;
  /** Flat color of the tile's top face. */
  top: string;
  /** Lowest and highest elevation a tile of this type can have. Painting clamps into this range. */
  minElev: number;
  maxElev: number;
  water?: boolean;
}

/** Elevation runs 0 (sea level) to MAX_ELEV. Water tiles keep their own level, so rivers and lakes sit in the land. */
export const MAX_ELEV = 15;

export const TERRAINS: TerrainDef[] = [
  { id: Terrain.DeepWater, name: 'Deep water', top: '#3b7bb0', minElev: 0, maxElev: 0, water: true },
  { id: Terrain.ShallowWater, name: 'Shallow water', top: '#5fa6cf', minElev: 0, maxElev: 11, water: true },
  { id: Terrain.Sand, name: 'Sand', top: '#ead69c', minElev: 1, maxElev: 4 },
  { id: Terrain.Grassland, name: 'Grassland', top: '#93c15c', minElev: 1, maxElev: 11 },
  { id: Terrain.Forest, name: 'Forest', top: '#76a84d', minElev: 1, maxElev: 11 },
  { id: Terrain.Hills, name: 'Hills', top: '#a7b26a', minElev: 3, maxElev: 11 },
  { id: Terrain.Mountain, name: 'Mountain', top: '#9b9284', minElev: 6, maxElev: 14 },
  { id: Terrain.Snow, name: 'Snow', top: '#eef1f2', minElev: 9, maxElev: 15 },
  { id: Terrain.Desert, name: 'Desert', top: '#e2bf78', minElev: 1, maxElev: 9 },
  { id: Terrain.Swamp, name: 'Swamp', top: '#7d9460', minElev: 1, maxElev: 4 },
];

export const terrainDef = (t: number): TerrainDef => TERRAINS[t] ?? TERRAINS[0];
export const isWater = (t: number) => t === Terrain.DeepWater || t === Terrain.ShallowWater;

export const Deposit = {
  None: 0,
  Stone: 1,
  Iron: 2,
  Gold: 3,
  Clay: 4,
  Fish: 5,
  Berries: 6,
} as const;
export type Deposit = (typeof Deposit)[keyof typeof Deposit];

export interface DepositDef {
  id: Deposit;
  name: string;
  color: string;
  /** Where it can be placed: on water tiles, on land tiles, or both. */
  on: 'land' | 'water';
}

export const DEPOSITS: DepositDef[] = [
  { id: Deposit.None, name: 'None', color: 'transparent', on: 'land' },
  { id: Deposit.Stone, name: 'Stone', color: '#b9b4ab', on: 'land' },
  { id: Deposit.Iron, name: 'Iron ore', color: '#a5583c', on: 'land' },
  { id: Deposit.Gold, name: 'Gold ore', color: '#f0c43c', on: 'land' },
  { id: Deposit.Clay, name: 'Clay', color: '#c77b4f', on: 'land' },
  { id: Deposit.Fish, name: 'Fish', color: '#2f6a96', on: 'water' },
  { id: Deposit.Berries, name: 'Berries', color: '#c2304f', on: 'land' },
];

export const depositDef = (d: number): DepositDef => DEPOSITS[d] ?? DEPOSITS[0];

/** Whether a deposit can sit on a tile of this terrain. */
export function depositFits(d: number, t: number) {
  if (d === Deposit.None) return true;
  const def = depositDef(d);
  return def.on === 'water' ? isWater(t) : !isWater(t);
}
