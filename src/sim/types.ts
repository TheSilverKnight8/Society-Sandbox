// Shapes shared by the simulation (which runs in a Web Worker) and the app.

/** Simulation steps per second at normal speed (1x). */
export const TICKS_PER_SECOND = 10;
/** A month is 5 seconds at 1x and a year 12 months, so a year passes in a minute. */
export const TICKS_PER_MONTH = 50;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;

/** 0 = paused. Fast-forward is a modest speed-up (SPEC 2). */
export type Speed = 0 | 1 | 2 | 3;

import type { BuildingKind, Good, JobKind, SettlementStage } from './buildings';

/** What a person is doing right now. */
export type Task = 'idle' | 'walk' | 'gather' | 'eat' | 'sleep' | 'chop' | 'quarry' | 'build' | 'farm' | 'harvest' | 'mine' | 'fish' | 'dig' | 'craft' | 'trade' | 'study' | 'fight' | 'drill' | 'collect';

/** Why a person is walking. */
export type Purpose = 'stroll' | 'food' | 'order' | 'home' | 'wood' | 'stone' | 'site' | 'settle' | 'job' | 'deliver' | 'fetch' | 'store' | 'trade' | 'tradeHome' | 'fence' | 'tax' | 'taxHome' | 'pave' | 'muster' | 'chase' | 'bridge' | 'collect';

/** An imperative given to a unit by the player (SPEC 4). */
export interface Order {
  /** 'attack': go there and fight any enemy met on the way (Stage 5: WorldBox-style group orders). 'collect': gather a load of a resource and take it to their store (Caleb after Stage 5). */
  kind: 'move' | 'gather' | 'rest' | 'attack' | 'collect';
  /** Where to go (move, attack), or where to look for food (gather) or the resource (collect). */
  tile?: number;
  /** The resource to collect: wood, stone, iron ore, gold ore or clay. */
  good?: Good;
}

export type Weapon = 'spear' | 'sword' | 'bow' | 'crossbow';
export type Armor = 'mail' | 'plate';
/** Kinds of soldier the player can place (SPEC 6: types such as cavalry, artillery, infantry). */
export type SoldierKind = 'infantry' | 'archer' | 'cavalry' | 'artillery';

/** An army (SPEC 9): a nation's soldiers from one barracks, commanded by a unique leader. */
export interface Army {
  id: number;
  nation: number;
  /** The settlement it musters at (its barracks'), and the barracks. */
  home: number;
  barracks?: number;
  name: string;
  leader?: number;
  /** What the nation (or the player) has it doing. */
  order?: { kind: 'attack'; settlement: number } | { kind: 'defend'; settlement: number } | { kind: 'return' };
  /** When it last took a settlement (it goes home after a while). */
  tookAt?: number;
}

/** How a war stands (on the relation between two nations at war). */
export interface War {
  start: number;
  /** Who declared it (a nation's ID). */
  by: number;
  /** Soldiers each side had when it began, soldiers each has lost, and settlements each has taken. Keyed by nation ID. */
  strength: Record<number, number>;
  lost: Record<number, number>;
  taken: Record<number, number>;
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
  /** Goods they are carrying: materials for a construction site, or what they made at work for the store. */
  load?: { kind: Good; n: number };
  /** Their workplace (a building), if they have a job. */
  job?: number;
  /** What they are doing for their job, while walking to it. */
  jobStep?: 'tend' | 'harvest' | 'collect' | 'gather' | 'fetch-wood' | 'fetch-stone' | 'fetch-tools' | 'fetch-input' | 'craft' | 'fetch-fence' | 'trade-load' | 'study' | 'fetch-pave' | 'fetch-gear' | 'drill' | 'fetch-bridge';
  /** Their own coins (Caleb: coins; SPEC 6: wealth earned from jobs and trade). */
  coins?: number;
  /** Household goods they own (pottery). Wealth is coins plus what they own. */
  goods?: number;
  /** A trader's run: where they are taking goods, and what they paid at home for them. */
  tradeTo?: number;
  tradeOwed?: number;
  /** The fence tile a builder is putting up. */
  fenceTile?: number;
  /** The tile a builder is paving. */
  paveTile?: number;
  /** The construction site they are working for. */
  site?: number;
  /** Where they are going to found a settlement (sent as settlers), and the settlement they left. */
  settleAt?: number;
  settleFrom?: number;
  /** Asleep in their home (not drawn; shelter met). */
  indoors?: boolean;
  /** Their culture (SPEC 6: exactly one once a culture exists; they can start with none). */
  culture?: number;
  /** For someone with no settlement and no culture: since when (a culture forms among them after a while). */
  cultureless?: number;
  /** A unique individual's identity (SPEC 6: rulers, player-chosen people, and ones who emerge): name, since when, and why. */
  unique?: { name: string; since: number; why: UniqueWhy };
  /** Coins an official is carrying from a settlement to their nation's treasury (taxes; SPEC 8: goods are carried). */
  taxCoins?: number;
  /** For an official on a round: the settlement they are going to tax. */
  taxFrom?: number;
  /** Settlers leaving in a revolt: the settlement they found belongs to no nation. */
  settleFree?: boolean;
  /** A soldier (SPEC 6), their army, and their arms (SPEC 9: combat is resolved by stats and equipment). */
  soldier?: boolean;
  army?: number;
  weapon?: Weapon;
  armor?: Armor;
  horse?: boolean;
  engine?: boolean;
  /** Enemies they have struck down. */
  kills?: number;
  /** The enemy they are fighting, and steps until they can strike again. */
  foe?: number;
  cooldown?: number;
  /** Coins carried off from a taken settlement, for their nation's treasury. */
  loot?: number;
  /** A gate or fence of an enemy settlement they are breaking (it bars their way). */
  siegeTile?: number;
  /** An armorer or groom carrying the makings of these arms (or a horse) to their workplace. */
  making?: Good;
  /** A builder going to build this tile of bridge. */
  bridgeTile?: number;
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
  /** What is in its store. */
  stock?: Partial<Record<Good, number>>;
  /** Its treasury: the coins it pays wages from and takes for goods. */
  coins?: number;
  /** Fence tiles it plans to put up (towns and cities). */
  fencePlan?: number[];
  /** Tiles it plans to pave: paths from its middle to its buildings' doors (villages and bigger; Caleb after 4c). */
  roadPlan?: number[];
  /** Tiles of bridge it has planned over rivers and narrow water (Caleb: water is crossed by bridge or boat). */
  bridgePlan?: number[];
  /** Since when none of its people has had a culture (a culture forms after a while; SPEC 7). Unset: since it was founded. */
  cultureless?: number;
  /** Since when it has been far from every other settlement of its culture (it may break away; Caleb, Stage 4). */
  farSince?: number;
  /** The settlement whose settlers founded it, if any. */
  from?: number;
  /** Since when many of its people have been homeless (it sends people out after a while), and when it last sent people out. */
  crowdedSince?: number;
  spreadAt?: number;
  /** The nation it belongs to, if any. */
  nation?: number;
  /** Months its people have been unhappy with their nation's policies (unrest; revolts come after a while). */
  unrest?: number;
  /** When its taxes were last collected. */
  taxedAt?: number;
}

/** A culture's traits: one side of each pair (SPEC 11: culture traits; the list is the builder's). */
export interface CultureTraits {
  temper: 'martial' | 'peaceful';
  livelihood: 'mercantile' | 'agrarian';
  outlook: 'traditional' | 'progressive';
  order: 'hierarchical' | 'communal';
}

/** A culture (SPEC 7): it only emerges from people, and the player can edit it afterwards. */
export interface Culture {
  id: number;
  name: string;
  /** Its color on the culture map view (an index into CULTURE_COLORS). */
  color: number;
  founded: number;
  /** The settlement it formed in, and the culture it broke away from, if any. */
  origin?: number;
  parent?: number;
  traits: CultureTraits;
  /** When its last member died or left it. */
  extinct?: number;
  /** How much it supports each policy choice, 0 to 100, keyed 'policy:choice' (SPEC 7, a [Claude's call] item). */
  support?: Record<string, number>;
  /** Technologies it knows, what it is researching now, and research done toward each (SPEC 7: tracked on cultures). */
  techs?: string[];
  research?: string;
  progress?: Record<string, number>;
}

/** Why someone is unique (SPEC 6). */
export type UniqueWhy = 'ruler' | 'founder' | 'chosen' | 'influence' | 'revolt' | 'leader';

/** A nation's policies (SPEC 7: like WorldBox's culture traits; SPEC 11: the list is the builder's). */
export interface Policies {
  succession: 'hereditary' | 'elective';
  taxation: 'light' | 'heavy';
  trade: 'open' | 'closed';
  expansion: 'expansionist' | 'settled';
  conscription: 'levy' | 'volunteers';
}
export type PolicyKey = keyof Policies;

/** How two nations stand with each other (SPEC 7: basic relations). */
export type RelationKind = 'alliance' | 'trade' | 'peace' | 'rivalry' | 'war';

/** A nation (SPEC 7: the political layer). */
export interface Nation {
  id: number;
  name: string;
  /** Its color on the nation map view (an index into NATION_COLORS). */
  color: number;
  founded: number;
  /** Its capital settlement, and its ruler (a person). */
  capital: number;
  ruler?: number;
  policies: Policies;
  /** Its treasury: taxes collected by its officials. */
  coins: number;
  /** When it lost its last settlement. */
  destroyed?: number;
  /** Formed before its people had a culture: it takes up its first main culture's ways. */
  unshaped?: boolean;
  /** Technologies it has: all of its main culture's, and some of its other cultures' (SPEC 7). */
  techs?: string[];
}

export interface Relation {
  a: number;
  b: number;
  kind: RelationKind;
  since: number;
  war?: War;
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
  tools?: number;
  /** A farm's crop, 0 (just sown) to 1 (ripe). */
  growth?: number;
  /** Goods made here waiting to be carried to the store (a farm's harvest). */
  output?: number;
  /** Steps left while it burns (set alight by an enemy army; Caleb: destruction). */
  fire?: number;
}

/** Automatic behaviors the player can turn off (SPEC 10). More are added as their systems are built. */
export interface Toggles {
  /** Pairing, births and aging. Off freezes the population: nobody pairs, is born, ages, or dies of old age. */
  lifeCycle: boolean;
  /** People founding settlements by themselves (SPEC 10). */
  founding: boolean;
  /** Cultures forming and breaking away by themselves (SPEC 10: culture formation). */
  cultures: boolean;
  /** Leaders claiming rule and founding nations (SPEC 10: nations emerging from settlements). */
  nations: boolean;
  /** Nations changing how they stand with each other by themselves (SPEC 10: diplomatic relation changes). */
  diplomacy: boolean;
  /** Nations changing policies during major events (SPEC 10). */
  policyChanges: boolean;
  /** People becoming unique by themselves (SPEC 10: emergence of unique individuals). */
  uniques: boolean;
  /** Cultures researching, and nations taking technology from their cultures (SPEC 10: culture research and nation tech derivation). */
  research: boolean;
  /** Nations raising armies, and declaring war by themselves (SPEC 10). */
  war: boolean;
}

export const DEFAULT_TOGGLES: Toggles = { lifeCycle: true, founding: true, cultures: true, nations: true, diplomacy: true, policyChanges: true, uniques: true, research: true, war: true };

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
  /** Fences and gates on each tile (see Wall). */
  walls?: Uint8Array;
  /** Pavement on each tile: 1 planned, 2 paved. */
  roads?: Uint8Array;
  /** Bridges on each tile of water: 1 planned, 2 built. */
  bridges?: Uint8Array;
  cultures?: Culture[];
  nextCultureId?: number;
  nations?: Nation[];
  nextNationId?: number;
  relations?: Relation[];
  armies?: Army[];
  nextArmyId?: number;
}

/** What stands on a tile as a settlement's fence. Built fences cannot be walked through; gates can. */
export const Wall = { None: 0, PlannedFence: 1, Fence: 2, PlannedGate: 3, Gate: 4 } as const;

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
  stock: Record<Good, number>;
  coins: number;
  /** What each good costs there now. */
  prices: Record<Good, number>;
  /** Fence tiles built and planned (towns and cities). */
  fenceBuilt: number;
  fencePlanned: number;
  /** Tiles paved and still to pave. */
  paved: number;
  toPave: number;
  /** Bridges built and still to build (tiles). */
  bridges: number;
  toBridge: number;
  /** Soldiers mustering here, and whether enemies are on its land. */
  garrison: number;
  underAttack: boolean;
  /** Jobs filled and offered, adults with no job, and children in light jobs. */
  jobsFilled: number;
  jobsOffered: number;
  jobless: number;
  lightJobs: number;
  queue: number;
  abandoned: boolean;
  /** Its culture (the one most of its people hold), and how many other cultures live there. */
  culture?: number;
  otherCultures: number;
  /** The settlement whose settlers founded it. */
  from?: string;
  /** Its nation, and how unhappy its people are with that nation's policies (months of unrest). */
  nation?: number;
  unrest: number;
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
  /** How it looks now: a farm's crop (0 bare, 1 shoots, 2 green, 3 ripe), plus 4 with sheaves waiting. */
  look: number;
  /** A hall's banner: its nation's color. */
  banner?: string;
  burning?: boolean;
}

/** A building, for its info panel (Caleb after Stage 5: what it is and what it does). */
export interface BuildingDetails {
  id: number;
  kind: BuildingKind;
  settlement?: number;
  settlementName?: string;
  /** 0 to 1; 1 is finished. */
  progress: number;
  /** Materials delivered and needed, while it is being built. */
  materials?: { wood: [number, number]; stone: [number, number]; tools?: [number, number] };
  builders: number;
  /** Workers: adults and children holding jobs here, and how many it takes. */
  workers: number;
  jobs: number;
  lightWorkers: number;
  lightJobs: number;
  /** People living here, and how many it houses. */
  residents: number;
  homes: number;
  /** A field's crop (0 to 1) and sheaves waiting to be carried in. */
  growth?: number;
  output?: number;
  /** What its workers are doing now (for workshops: what they are making). */
  doing: string[];
  burning: boolean;
  /** Who lives in a castle (the ruler). */
  ruler?: { id: number; name: string };
}

/** A settlement, as listed for the app. */
export interface SettlementView {
  id: number;
  name: string;
  stage: SettlementStage;
  center: number;
  people: number;
  abandoned: boolean;
  /** The culture most of its people hold. */
  culture?: number;
  nation?: number;
}

/** A nation, as listed for the app. */
export interface NationView {
  id: number;
  name: string;
  color: number;
  foundedYear: number;
  capital: number;
  capitalName: string;
  ruler?: { id: number; name: string; title: string };
  settlements: number;
  people: number;
  coins: number;
  officials: number;
  policies: Policies;
  /** Its main culture first, then the others, with their people. */
  cultures: { id: number; members: number }[];
  /** How much its main culture supports each of its policies now (0 to 100). */
  support: Record<PolicyKey, number>;
  relations: { other: number; kind: RelationKind }[];
  soldiers: number;
  armies: { id: number; name: string; leader?: { id: number; name: string }; soldiers: number; order: string }[];
  wars: { other: number; years: number; lost: number; enemyLost: number; taken: number; enemyTaken: number; declaredBy: number }[];
  /** Its settlements in unrest. */
  unrest: number;
  destroyedYear?: number;
  techs: string[];
}

/** Changes the player can make to a nation (SPEC 4 and 7: changing nation rules; everything can be modified). */
export interface NationEdit {
  name?: string;
  color?: number;
  policies?: Partial<Policies>;
  /** A settlement of the nation to be its capital. */
  capital?: number;
  /** A person in the nation to be its ruler. */
  ruler?: number;
  relation?: { other: number; kind: RelationKind };
}

/** A culture, as listed for the app. */
export interface CultureView {
  id: number;
  name: string;
  color: number;
  foundedYear: number;
  members: number;
  settlements: number;
  traits: CultureTraits;
  origin?: string;
  parent?: number;
  extinctYear?: number;
  techs: string[];
  /** What it is researching: how far along, what it costs, and a good it is waiting for, if any. */
  research?: { tech: string; progress: number; cost: number; waiting?: string };
  /** Research it does a year now (from its people and its scholars). */
  researchRate: number;
  /** Technologies whose research is done, waiting for goods (with the goods each needs). */
  awaiting: { tech: string; needs: string }[];
}

/** Changes the player can make to a culture (SPEC 7: cultures can be edited after they emerge). */
export interface CultureEdit {
  name?: string;
  color?: number;
  traits?: Partial<CultureTraits>;
  /** What it researches next (SPEC 4: the player can steer research; Caleb). */
  research?: string;
  /** Sets the technologies it knows (SPEC 1: everything can be modified). */
  techs?: string[];
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
  load?: { kind: Good; n: number };
  /** Their job, if any: what it is, whether it is a child's light job, and where. */
  job?: { kind: JobKind; light: boolean; at: string };
  /** Whether a job is one of their needs here (adults in a village or bigger), and whether it is met. */
  jobNeed: 'met' | 'unmet' | 'none';
  coins: number;
  goods: number;
  /** Coins plus household goods at their usual price. */
  wealth: number;
  /** Where a trader is taking goods, if on a run. */
  tradingWith?: string;
  culture?: number;
  /** A unique individual's name, and why and since when they are unique. */
  name?: string;
  unique?: { why: UniqueWhy; sinceYear: number };
  /** Their office, if any (ruler of a nation), and their influence (SPEC 6). */
  office?: string;
  influence: number;
  nation?: number;
  /** A soldier's kind, arms, army and deeds. */
  soldier?: { kind: SoldierKind; weapon?: Weapon; armor?: Armor; horse: boolean; engine: boolean; army?: string; leads: boolean; kills: number };
  /** Enemies are near (SPEC 6: safety). */
  danger: boolean;
}

/** Changes the player can make to a person by hand (SPEC 1: everything can be modified). */
export interface PersonEdit {
  leaveJob?: boolean;
  coins?: number;
  health?: number;
  food?: number;
  rest?: number;
  sex?: 0 | 1;
  ageYears?: number;
  /** A culture's ID, or null for none. */
  culture?: number | null;
  /** Makes them unique with this name, or (null) no longer unique. */
  name?: string | null;
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
  /** Follows a building for its info panel (Caleb after Stage 5). */
  | { type: 'watchBuilding'; id: number | null }
  | { type: 'settlementOrder'; id: number; order: SettlementOrder }
  | { type: 'cultureEdit'; id: number; edit: CultureEdit }
  | { type: 'nationEdit'; id: number; edit: NationEdit }
  /** Places a nation (SPEC 7: some are placed in setup): the settlement becomes its capital. */
  | { type: 'placeNation'; settlement: number }
  | { type: 'nationOrder'; id: number; order: NationOrder }
  /** Places soldiers, armed (SPEC 4: placing units), of the nation whose land it is. */
  | { type: 'placeSoldiers'; tiles: number[]; kind: SoldierKind }
  | { type: 'unpair'; id: number }
  | { type: 'save'; req: number }
  /** Development only: adds n people on land near (x, y), for speed tests. */
  | { type: 'spawnTest'; n: number; x: number; y: number };

export type SettlementOrder =
  | { kind: 'build'; building: BuildingKind; tile: number; rot: 0 | 1 }
  | { kind: 'focus'; focus: Focus }
  | { kind: 'settlers'; tile: number }
  | { kind: 'abandon' }
  /** Its people of its culture break away and form a new culture (SPEC 7: the player can decide a break). */
  | { kind: 'breakCulture' };

/** Orders to a nation (SPEC 4: imperatives). */
export type NationOrder =
  /** Settlers from its settlement nearest the spot go to found a settlement there for the nation. */
  | { kind: 'expand'; tile: number };

/** What a tile change is about. */
export const TileField = { Empty: 0, Trees: 1, Territory: 2, Walls: 3, Roads: 4, Bridges: 5 } as const;

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
  /** Bit 0: walking. Bit 1: facing left. Bit 2: male. Bits 3-4: pose (see Pose). Bits 5-6: age (see AgeLook). Bit 7: indoors (not drawn). Bit 8: carrying something. Bit 9: a ruler (drawn with a crown). Bit 10: on open water (drawn in a boat). Bit 11: fighting. */
  flags: Uint16Array;
  /** Soldiers' arms, per person (see GEAR in render/people.ts): bits 0-2 weapon, 3-4 armor, 5 horse, 6 catapult, 7 leader, 8-12 nation color + 1. */
  gear: Uint16Array;
  /** Blows struck since the last snapshot, five numbers each: from x, from y, to x, to y, kind (0 a swing, 1 an arrow, 2 a bolt, 3 a catapult stone). */
  shots: Float32Array;
  /** People fallen in battle since the last snapshot, five numbers each: x, y, look, gear, sex. */
  falls: Float32Array;
  /** Tiles whose drawing changed since the last snapshot, as triples: tile, what (TileField), new value. */
  tileChanges: Int32Array;
  /** The buildings, when they changed since the last snapshot. */
  buildings?: BuildingView[];
  /** The settlements, when they changed. */
  settlements?: SettlementView[];
  /** The cultures, when they changed. */
  cultures?: CultureView[];
  /** The nations, when they changed. */
  nations?: NationView[];
  /** Average milliseconds per simulation step over the last second. */
  stepMs: number;
}

export type FromSim =
  | ({ type: 'snap' } & Snapshot)
  | { type: 'watched'; person: PersonDetails | null; died?: string }
  | { type: 'watchedSettlement'; settlement: SettlementDetails | null }
  | { type: 'watchedBuilding'; building: BuildingDetails | null }
  | { type: 'saved'; req: number; state: SimState; deposit: Uint8Array }
  | { type: 'error'; message: string };
