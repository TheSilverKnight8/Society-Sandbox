// Buildings (SPEC 8: buildings are functional; units construct them; placed ones appear
// finished). Stage 3a has the buildings a camp and a village need to live in and store
// things; production buildings come in 3b and workshops in 3c.

export const BuildingKind = {
  Campfire: 0,
  Hut: 1,
  House: 2,
  Storehouse: 3,
} as const;
export type BuildingKind = (typeof BuildingKind)[keyof typeof BuildingKind];

export type SettlementStage = 'camp' | 'village' | 'town' | 'city';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  /** Materials it takes to build. */
  wood: number;
  stone: number;
  /** Steps of building work once the materials are there (one builder; more builders are quicker). */
  work: number;
  /** People it houses (0 if not a home). */
  homes: number;
  /** The earliest stage a settlement builds it at by itself. */
  stage: SettlementStage;
  /** Whether a settlement can be ordered to build it, and the player can place it. */
  buildable: boolean;
  /** Footprint in tiles (along x, along y), before turning. WorldBox-like sizes (Caleb: "2x3 or similar"). */
  w: number;
  d: number;
}

export const BUILDINGS: BuildingDef[] = [
  { kind: BuildingKind.Campfire, name: 'Campfire', wood: 0, stone: 0, work: 0, homes: 0, stage: 'camp', buildable: false, w: 1, d: 1 },
  { kind: BuildingKind.Hut, name: 'Hut', wood: 9, stone: 0, work: 160, homes: 4, stage: 'camp', buildable: true, w: 2, d: 2 },
  { kind: BuildingKind.House, name: 'House', wood: 12, stone: 6, work: 280, homes: 6, stage: 'village', buildable: true, w: 2, d: 3 },
  { kind: BuildingKind.Storehouse, name: 'Storehouse', wood: 15, stone: 9, work: 340, homes: 0, stage: 'village', buildable: true, w: 3, d: 3 },
];

/** A building's footprint once turned (rot 1 swaps its sides). */
export function footprint(kind: BuildingKind, rot: number | undefined): { w: number; d: number } {
  const b = BUILDINGS[kind];
  return rot ? { w: b.d, d: b.w } : { w: b.w, d: b.d };
}

/** The footprint's corner tile (smallest x and y) for a building centered on a tile. */
export function anchorFor(kind: BuildingKind, rot: number | undefined, center: number, size: number): number {
  const { w, d } = footprint(kind, rot);
  const x = (center % size) - Math.floor((w - 1) / 2);
  const y = Math.floor(center / size) - Math.floor((d - 1) / 2);
  return y * size + x;
}

export const STAGES: SettlementStage[] = ['camp', 'village', 'town', 'city'];
export const STAGE_NAME: Record<SettlementStage, string> = { camp: 'Camp', village: 'Village', town: 'Town', city: 'City' };

/** What it takes to reach each stage (people living there, and homes built). */
export const STAGE_NEEDS: Record<SettlementStage, { people: number; homes: number }> = {
  camp: { people: 0, homes: 0 },
  village: { people: 10, homes: 3 },
  town: { people: 60, homes: 12 },
  city: { people: 200, homes: 40 },
};

const FIRST = ['Ash', 'Bram', 'Wex', 'Hal', 'Lin', 'Stan', 'Mor', 'Eld', 'Brad', 'Thorn', 'Wick', 'Cole', 'Har', 'Ox', 'Ris', 'Wil', 'Ald', 'Brook', 'Fen', 'Gar', 'Hather', 'Kel', 'Mar', 'Pen', 'Red', 'Sel', 'Tam', 'Ul', 'Wen', 'York'];
const LAST = ['ford', 'ton', 'by', 'ham', 'wick', 'stead', 'field', 'bury', 'worth', 'ley', 'brook', 'dale', 'mere', 'hold', 'thorpe', 'cot', 'gate', 'well'];

/** A settlement name in the manner of medieval English places. */
export function settlementName(rand: () => number) {
  return FIRST[Math.floor(rand() * FIRST.length)] + LAST[Math.floor(rand() * LAST.length)];
}
