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
}

export const BUILDINGS: BuildingDef[] = [
  { kind: BuildingKind.Campfire, name: 'Campfire', wood: 0, stone: 0, work: 0, homes: 0, stage: 'camp', buildable: false },
  { kind: BuildingKind.Hut, name: 'Hut', wood: 6, stone: 0, work: 120, homes: 4, stage: 'camp', buildable: true },
  { kind: BuildingKind.House, name: 'House', wood: 8, stone: 4, work: 220, homes: 6, stage: 'village', buildable: true },
  { kind: BuildingKind.Storehouse, name: 'Storehouse', wood: 10, stone: 6, work: 260, homes: 0, stage: 'village', buildable: true },
];

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
