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
  /** Lowest and highest elevation a tile of this type can have. Painting clamps into this range. */
  minElev: number;
  maxElev: number;
  water?: boolean;
}

/** Elevation runs 0 (sea level) to MAX_ELEV. Water tiles keep their own level, so rivers and lakes sit in the land. */
export const MAX_ELEV = 15;

export const TERRAINS: TerrainDef[] = [
  { id: Terrain.DeepWater, name: 'Deep water', minElev: 0, maxElev: 0, water: true },
  { id: Terrain.ShallowWater, name: 'Shallow water', minElev: 0, maxElev: 11, water: true },
  { id: Terrain.Sand, name: 'Sand', minElev: 1, maxElev: 4 },
  { id: Terrain.Grassland, name: 'Grassland', minElev: 1, maxElev: 11 },
  { id: Terrain.Forest, name: 'Forest', minElev: 1, maxElev: 11 },
  { id: Terrain.Hills, name: 'Hills', minElev: 3, maxElev: 11 },
  { id: Terrain.Mountain, name: 'Mountain', minElev: 6, maxElev: 14 },
  { id: Terrain.Snow, name: 'Snow', minElev: 9, maxElev: 15 },
  { id: Terrain.Desert, name: 'Desert', minElev: 1, maxElev: 9 },
  { id: Terrain.Swamp, name: 'Swamp', minElev: 1, maxElev: 4 },
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
  /** Where it can be placed: on water tiles, on land tiles, or both. */
  on: 'land' | 'water';
}

export const DEPOSITS: DepositDef[] = [
  { id: Deposit.None, name: 'None', on: 'land' },
  { id: Deposit.Stone, name: 'Stone', on: 'land' },
  { id: Deposit.Iron, name: 'Iron ore', on: 'land' },
  { id: Deposit.Gold, name: 'Gold ore', on: 'land' },
  { id: Deposit.Clay, name: 'Clay', on: 'land' },
  { id: Deposit.Fish, name: 'Fish', on: 'water' },
  { id: Deposit.Berries, name: 'Berries', on: 'land' },
];

export const depositDef = (d: number): DepositDef => DEPOSITS[d] ?? DEPOSITS[0];

/** Whether a deposit can sit on a tile of this terrain. */
export function depositFits(d: number, t: number) {
  if (d === Deposit.None) return true;
  const def = depositDef(d);
  return def.on === 'water' ? isWater(t) : !isWater(t);
}
