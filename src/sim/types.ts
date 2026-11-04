// Shapes shared by the simulation (which runs in a Web Worker) and the app.

/** Simulation steps per second at normal speed (1x). */
export const TICKS_PER_SECOND = 10;
/** A month is 5 seconds at 1x and a year 12 months, so a year passes in a minute. */
export const TICKS_PER_MONTH = 50;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;

/** 0 = paused. Fast-forward is a modest speed-up (SPEC 2). */
export type Speed = 0 | 1 | 2 | 3;

import type { BuildingKind, SettlementStage } from './buildings';

/** What a person is doing right now. */
export type Task = 'idle' | 'walk' | 'gather' | 'eat' | 'sleep' | 'chop' | 'quarry' | 'build';

/** Why a person is walking. */
export type Purpose = 'stroll' | 'food' | 'order' | 'home' | 'wood' | 'stone' | 'site' | 'settle';

/** An imperative given to a unit by the player (SPEC 4). */
export interface Order {
  kind: 'move' | 'gather' | 'rest';
  /** Where to go (move), or where to look for food (gather). */
  tile?: number;
}

/** One individual. Most are not unique and have no name (SPEC 6). */
export interface Person {
  id: number;
  /** 0 = female, 1 = male. */
  sex: 0 | 1;
  /** The tick they were born on; negative for people older than the world. */
  born: number;
  /** 0 to 100. At 0 they die. */
  health: number;
  /** Appearance, packed: skin tone, hair color and clothing color (see look.ts). */
  look: number;
  /** Position in tiles; a tile's middle is at +0.5. */
  x: number;
  y: number;
  task: Task;
  /** Why they are walking, when they are. */
  purpose?: Purpose;
  /** The food tile they are heading for or gathering from, if any. */
  target?: number;
  /** Ticks left in the current action (gathering, eating), or until they next decide what to do. */
  wait: number;
  /** Needs, 0 (unmet) to 100 (met). SPEC 6: food, shelter, rest, safety, and their job. */
  food: number;
  rest: number;
  /** Food they are carrying (SPEC 8: goods are carried by individuals). */
  carry: number;
  /** An order from the player, carried out before anything they would choose themselves. */
  order?: Order;
  /** Their pair (SPEC 6), if any. */
  pair?: number;
  /** Their parents, if born in the world. */
  mother?: number;
  father?: number;
  /** Steps until the birth, while pregnant. */
  pregnant?: number;
  /** The father of the child she is expecting. */
  childFather?: number;
  /** The step of their last birth, so births are spaced out. */
  lastBirth?: number;
  /** The settlement they live in, and the building that is their home. */
  settlement?: number;
  home?: number;
  /** Building materials they are carrying to a construction site. */
  load?: { kind: 'wood' | 'stone'; n: number };
  /** The construction site they are working for. */
  site?: number;
  /** Where they are going to found a settlement (sent as settlers). */
  settleAt?: number;
  /** Asleep in their home (not drawn; shelter met). */
  indoors?: boolean;
}

export type Focus = 'balanced' | 'food' | 'housing' | 'goods';

/** A settlement (SPEC 7). */
export interface Settlement {
  id: number;
  name: string;
  stage: SettlementStage;
  /** Its middle: the campfire's tile. */
  center: number;
  founded: number;
  /** What it puts first (a settlement imperative). */
  focus: Focus;
  /** Buildings it has been ordered to build, in order, not yet started. */
  queue: { kind: BuildingKind; tile: number; rot: 0 | 1 }[];
  abandoned?: boolean;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  /** The footprint's corner tile (smallest x and y). */
  tile: number;
  /** 1: turned a quarter, so its footprint's sides are swapped. */
  rot?: 0 | 1;
  /** The settlement it belongs to, if any. */
  settlement?: number;
  /** Building work done, 0 to 1; 1 is finished. */
  progress: number;
  /** Materials brought so far, while it is being built. */
  wood: number;
  stone: number;
}

/** Automatic behaviors the player can turn off (SPEC 10). More are added as their systems are built. */
export interface Toggles {
  /** Pairing, births and aging. Off freezes the population: nobody pairs, is born, ages, or dies of old age. */
  lifeCycle: boolean;
  /** People founding settlements by themselves (SPEC 10). */
  founding: boolean;
}

export const DEFAULT_TOGGLES: Toggles = { lifeCycle: true, founding: true };

/** Life stages, for drawing and the inspect panel. */
export const ADULT_AGE = 14;
export const ELDER_AGE = 55;

/** Everything about a running world that is saved, apart from the map's tiles. */
export interface SimState {
  tick: number;
  nextId: number;
  /** State of the simulation's random number generator, so a saved run carries on the same way. */
  rng: number;
  people: Person[];
  /** Food left on each tile with a food deposit (berries, fish); grows back over time. 0 elsewhere. */
  stock?: Uint8Array;
  toggles?: Toggles;
  /** Trees standing on each forest tile (cut for wood, grow back); 0 elsewhere. */
  trees?: Uint8Array;
  /** Which settlement owns each tile (its ID), 0 for none. */
  territory?: Uint16Array;
  settlements?: Settlement[];
  buildings?: Building[];
  nextSettlementId?: number;
  nextBuildingId?: number;
}

export function emptyState(seed: number): SimState {
  return { tick: 0, nextId: 1, rng: seed >>> 0, people: [], toggles: { ...DEFAULT_TOGGLES }, settlements: [], buildings: [], nextSettlementId: 1, nextBuildingId: 1 };
}

/** What the settlement panel shows. */
export interface SettlementDetails {
  id: number;
  name: string;
  stage: SettlementStage;
  foundedYear: number;
  people: number;
  housed: number;
  homes: number;
  buildings: { kind: BuildingKind; done: number; building: number }[];
  focus: Focus;
  queue: number;
  abandoned: boolean;
}

/** A building, as drawn. */
export interface BuildingView {
  id: number;
  kind: BuildingKind;
  /** The footprint's corner tile, and its size in tiles once turned. */
  tile: number;
  w: number;
  d: number;
  rot: 0 | 1;
  settlement: number;
  progress: number;
}

/** A settlement, as listed for the app. */
export interface SettlementView {
  id: number;
  name: string;
  stage: SettlementStage;
  center: number;
  people: number;
  abandoned: boolean;
}

/** What the inspect panel shows about one person. */
export interface PersonDetails {
  id: number;
  sex: 0 | 1;
  ageYears: number;
  health: number;
  look: number;
  task: Task;
  purpose?: Purpose;
  food: number;
  rest: number;
  carry: number;
  order?: Order['kind'];
  pair?: number;
  mother?: number;
  father?: number;
  /** Living children. */
  children: number[];
  pregnant: boolean;
  settlement?: string;
  hasHome: boolean;
  load?: { kind: 'wood' | 'stone'; n: number };
}

/** Changes the player can make to a person by hand (SPEC 1: everything can be modified). */
export interface PersonEdit {
  health?: number;
  food?: number;
  rest?: number;
  sex?: 0 | 1;
  ageYears?: number;
}

// ---------------------------------------------------------------- messages

export type ToSim =
  | { type: 'init'; size: number; terrain: Uint8Array; elevation: Uint8Array; deposit: Uint8Array; state: SimState }
  | { type: 'speed'; speed: Speed }
  | { type: 'place'; tiles: number[] }
  | { type: 'remove'; tiles: number[] }
  | { type: 'removePerson'; id: number }
  | { type: 'watch'; id: number | null }
  | { type: 'edit'; id: number; edit: PersonEdit }
  /** An order to some people; 'stop' cancels their orders. */
  | { type: 'order'; ids: number[]; order: Order | { kind: 'stop' } }
  | { type: 'toggles'; toggles: Toggles }
  /** Places finished buildings (SPEC 4: placed buildings appear finished). A campfire founds a camp. */
  | { type: 'placeBuilding'; kind: BuildingKind; tile: number; rot: 0 | 1 }
  | { type: 'removeBuildings'; tiles: number[] }
  | { type: 'watchSettlement'; id: number | null }
  | { type: 'settlementOrder'; id: number; order: { kind: 'build'; building: BuildingKind; tile: number; rot: 0 | 1 } | { kind: 'focus'; focus: Focus } | { kind: 'settlers'; tile: number } | { kind: 'abandon' } }
  | { type: 'unpair'; id: number }
  | { type: 'save'; req: number }
  /** Development only: adds n people on land near (x, y), for speed tests. */
  | { type: 'spawnTest'; n: number; x: number; y: number };

/** What a tile change is about. */
export const TileField = { Empty: 0, Trees: 1, Territory: 2 } as const;

/** Poses for drawing. */
export const Pose = { Stand: 0, Sleep: 1, Work: 2 } as const;
/** How old someone looks, for drawing: young child, older child, adult, elder. */
export const AgeLook = { Adult: 0, Young: 1, Child: 2, Elder: 3 } as const;

export interface Snapshot {
  tick: number;
  /** Person IDs, in a fixed order that the other arrays follow. */
  ids: Int32Array;
  /** x, y per person, in tiles. */
  pos: Float32Array;
  look: Uint16Array;
  /** Bit 0: walking. Bit 1: facing left. Bit 2: male. Bits 3-4: pose (see Pose). Bits 5-6: age (see AgeLook). Bit 7: indoors (not drawn). */
  flags: Uint8Array;
  /** Tiles whose drawing changed since the last snapshot, as triples: tile, what (TileField), new value. */
  tileChanges: Int32Array;
  /** The buildings, when they changed since the last snapshot. */
  buildings?: BuildingView[];
  /** The settlements, when they changed. */
  settlements?: SettlementView[];
  /** Average milliseconds per simulation step over the last second. */
  stepMs: number;
}

export type FromSim =
  | ({ type: 'snap' } & Snapshot)
  | { type: 'watched'; person: PersonDetails | null; died?: string }
  | { type: 'watchedSettlement'; settlement: SettlementDetails | null }
  | { type: 'saved'; req: number; state: SimState; deposit: Uint8Array }
  | { type: 'error'; message: string };
