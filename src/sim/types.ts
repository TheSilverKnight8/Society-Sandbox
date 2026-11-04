// Shapes shared by the simulation (which runs in a Web Worker) and the app.

/** Simulation steps per second at normal speed (1x). */
export const TICKS_PER_SECOND = 10;
/** A month is 5 seconds at 1x and a year 12 months, so a year passes in a minute. */
export const TICKS_PER_MONTH = 50;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;

/** 0 = paused. Fast-forward is a modest speed-up (SPEC 2). */
export type Speed = 0 | 1 | 2 | 3;

/** What a person is doing right now. */
export type Task = 'idle' | 'walk' | 'gather' | 'eat' | 'sleep';

/** Why a person is walking. */
export type Purpose = 'stroll' | 'food' | 'order';

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
}

/** Everything about a running world that is saved, apart from the map's tiles. */
export interface SimState {
  tick: number;
  nextId: number;
  /** State of the simulation's random number generator, so a saved run carries on the same way. */
  rng: number;
  people: Person[];
  /** Food left on each tile with a food deposit (berries, fish); grows back over time. 0 elsewhere. */
  stock?: Uint8Array;
}

export function emptyState(seed: number): SimState {
  return { tick: 0, nextId: 1, rng: seed >>> 0, people: [] };
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
  | { type: 'save'; req: number }
  /** Development only: adds n people on land near (x, y), for speed tests. */
  | { type: 'spawnTest'; n: number; x: number; y: number };

/** Poses for drawing. */
export const Pose = { Stand: 0, Sleep: 1, Work: 2 } as const;

export interface Snapshot {
  tick: number;
  /** Person IDs, in a fixed order that the other arrays follow. */
  ids: Int32Array;
  /** x, y per person, in tiles. */
  pos: Float32Array;
  look: Uint16Array;
  /** Bit 0: walking. Bit 1: facing left. Bit 2: male. Bits 3-4: pose (see Pose). */
  flags: Uint8Array;
  /** Food tiles that ran out (stored as tile + 1) or came back (stored as -(tile + 1)) since the last snapshot. */
  stockChanges: Int32Array;
  /** Average milliseconds per simulation step over the last second. */
  stepMs: number;
}

export type FromSim =
  | ({ type: 'snap' } & Snapshot)
  | { type: 'watched'; person: PersonDetails | null; died?: string }
  | { type: 'saved'; req: number; state: SimState; deposit: Uint8Array }
  | { type: 'error'; message: string };
