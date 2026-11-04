// Buildings (SPEC 8: buildings are functional; they consume and produce resources and
// employ workers; units construct them; placed ones appear finished). Stage 3a has the
// buildings a camp and a village live in and store things in; 3b adds the workplaces that
// produce food and materials; workshops come in 3c.

/** Goods a settlement keeps in its store (SPEC 8: goods are carried by individuals). */
export type Good = 'food' | 'wood' | 'stone' | 'iron' | 'gold';
export const GOODS: Good[] = ['food', 'wood', 'stone', 'iron', 'gold'];
export const GOOD_NAME: Record<Good, string> = { food: 'Food', wood: 'Wood', stone: 'Stone', iron: 'Iron ore', gold: 'Gold ore' };

/** The jobs a tradesman can hold (SPEC 6: "generic tradesman (works at various buildings)"). */
export type JobKind = 'farmer' | 'woodcutter' | 'quarryman' | 'miner' | 'fisher';
export const JOB_NAME: Record<JobKind, string> = { farmer: 'Farmer', woodcutter: 'Woodcutter', quarryman: 'Quarryman', miner: 'Miner', fisher: 'Fisher' };
/** Children's light jobs (SPEC 6: "children ... can hold light jobs"). */
export const LIGHT_JOB_NAME: Partial<Record<JobKind, string>> = { farmer: 'Farm helper', fisher: "Fisher's helper" };

export const BuildingKind = {
  Campfire: 0,
  Hut: 1,
  House: 2,
  Storehouse: 3,
  Farm: 4,
  Woodcutter: 5,
  Quarry: 6,
  Mine: 7,
  FishingHut: 8,
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
  /** Workers it employs (adults), and light jobs for children. */
  jobs: number;
  lightJobs: number;
  job?: JobKind;
  /** Drawn flat on the ground (a field), under people. */
  flat?: boolean;
}

export const BUILDINGS: BuildingDef[] = [
  { kind: BuildingKind.Campfire, name: 'Campfire', wood: 0, stone: 0, work: 0, homes: 0, stage: 'camp', buildable: false, w: 1, d: 1, jobs: 0, lightJobs: 0 },
  { kind: BuildingKind.Hut, name: 'Hut', wood: 9, stone: 0, work: 160, homes: 4, stage: 'camp', buildable: true, w: 2, d: 2, jobs: 0, lightJobs: 0 },
  { kind: BuildingKind.House, name: 'House', wood: 12, stone: 6, work: 280, homes: 6, stage: 'village', buildable: true, w: 2, d: 3, jobs: 0, lightJobs: 0 },
  { kind: BuildingKind.Storehouse, name: 'Storehouse', wood: 15, stone: 9, work: 340, homes: 0, stage: 'village', buildable: true, w: 3, d: 3, jobs: 0, lightJobs: 0 },
  { kind: BuildingKind.Farm, name: 'Farm', wood: 4, stone: 0, work: 120, homes: 0, stage: 'village', buildable: true, w: 3, d: 3, jobs: 2, lightJobs: 1, job: 'farmer', flat: true },
  { kind: BuildingKind.Woodcutter, name: "Woodcutter's lodge", wood: 8, stone: 0, work: 160, homes: 0, stage: 'village', buildable: true, w: 2, d: 2, jobs: 2, lightJobs: 0, job: 'woodcutter' },
  { kind: BuildingKind.Quarry, name: 'Quarry', wood: 6, stone: 4, work: 200, homes: 0, stage: 'village', buildable: true, w: 2, d: 2, jobs: 2, lightJobs: 0, job: 'quarryman' },
  { kind: BuildingKind.Mine, name: 'Mine', wood: 10, stone: 4, work: 260, homes: 0, stage: 'village', buildable: true, w: 2, d: 2, jobs: 3, lightJobs: 0, job: 'miner' },
  { kind: BuildingKind.FishingHut, name: 'Fishing hut', wood: 8, stone: 0, work: 160, homes: 0, stage: 'village', buildable: true, w: 2, d: 2, jobs: 2, lightJobs: 1, job: 'fisher' },
];

/** Whether a building of this kind may stand on a tile of this terrain (fields need fertile ground). `cleared`: a forest tile with no trees left. */
export function kindAllowsTerrain(kind: BuildingKind, terrain: number, cleared: boolean) {
  // Terrain numbers: see map/terrain.ts (2 sand, 3 grassland, 4 forest, 5 hills, 8 desert).
  if (kind === BuildingKind.Farm) return terrain === 3 || terrain === 5 || (terrain === 4 && cleared);
  return terrain === 3 || terrain === 2 || terrain === 8 || terrain === 5 || (terrain === 4 && cleared);
}

/** Buildings that must stand at the water's edge (one of their tiles beside water). */
export function needsShore(kind: BuildingKind) {
  return kind === BuildingKind.FishingHut;
}

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
