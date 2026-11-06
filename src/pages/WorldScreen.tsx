import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Activity, Amphora, Beef, Target, Anchor, Anvil, Biohazard, Bug, Castle, Apple, Axe, Blocks, BookOpen, Building, CloudFog, CloudLightning, CloudRain, Coins, Crosshair, Crown, Fence, HeartPulse, History, PawPrint, Shield, Skull, Snowflake, Sun, Sword, Swords, ThermometerSun, Eraser, GraduationCap, ScrollText, Landmark, MapPinPlus, Fish, Flag, Flame, Footprints, Hammer, Hand, House, ListChecks, LogOut, Maximize, Minus, Moon, Pause, Pencil, Pickaxe, Play, Plus, RotateCcw, Save, Split, Store, Tent, User, Users, VenetianMask, Warehouse, Waves, Wheat, X } from 'lucide-react';
import { ButtonLink, Button, IconButton, Input, Segmented, Spinner, cx } from '../components/ui';
import { alertDialog, confirmDialog, notify, promptDialog } from '../components/dialogs';
import { useApp } from '../lib/store';
import { closeWorld, openWorld, readSetup, saveRunAs, saveWorld, setWorldUnsaved } from '../lib/worlds';
import { brushTiles } from '../map/paint';
import { SimClient } from '../sim/client';
import { CLOTHES, SKINS, unpackLook } from '../sim/look';
import { ADULT_AGE, DEFAULT_TOGGLES, ELDER_AGE, MONTHS_PER_YEAR, TICKS_PER_MONTH, TICKS_PER_YEAR, type PersonDetails, type PersonEdit, type Speed, type Toggles } from '../sim/types';
import { Deposit, Terrain } from '../map/terrain';
import { ARMS, BUILDINGS, BuildingKind, GOODS, GOOD_NAME, type Good, JOB_NAME, LIGHT_JOB_NAME, STAGE_NAME, anchorFor, footprint, kindAllowsTerrain, needsShore } from '../sim/buildings';
import { maxTrees } from '../sim/towns';
import { TileField, type BuildingView, type CultureEdit, type CultureView, type Focus, type NationEdit, type NationView, type RelationKind, type SettlementDetails, type SettlementView, type SoldierKind, type BuildingDetails, type CreatureDetails, type CreatureKind, type DisasterKind, type EffectKind, type RecordEntry, type RecordKind } from '../sim/types';
import { CREATURES } from '../sim/creatures';
import { drawWeatherGround, drawWeatherSky } from '../render/weather';
import { SHAKE_MS } from '../render/IsoView';
import { NATION_COLORS, POLICY_DEFS, RELATION_NAME } from '../sim/nations';
import { BUILDING_TECH, POLICY_TECH, TECHS, TECH_BY_ID } from '../sim/tech';
import { CULTURE_COLORS, TRAIT_AXES } from '../sim/cultures';
import { STEP } from '../render/iso';
import { IsoView } from '../render/IsoView';
import { drawPeople, pickCreature, pickPerson } from '../render/people';
import { BACKDROP } from '../render/style';
import type { WorldDoc } from '../world/types';

// The main screen (SPEC 4): the map, with a toolbar along the bottom in the manner of
// WorldBox's. Its Main tab holds the time controls (as WorldBox's Main tab holds pause
// and speed); the other tabs hold unit placement, disasters and effects, and imperatives
// in place of god powers.

type Tab = 'main' | 'units' | 'disasters' | 'imperatives';
type UnitTool = 'person' | 'remove' | 'nation' | 'soldier' | 'creature' | 'criminal' | BuildingKind;
/** A tool in the Disasters & effects tab (SPEC 4). */
type HazardTool = { type: 'disaster'; kind: DisasterKind } | { type: 'effect'; kind: EffectKind };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function WorldScreenPage() {
  const { id = '' } = useParams();
  const world = useApp((s) => s.world);

  useEffect(() => {
    void openWorld(id);
  }, [id]);
  useEffect(() => () => void closeWorld(), []);

  if (world.kind === 'ready' && world.doc.id === id) return <WorldScreen doc={world.doc} />;
  let body: ReactNode = <Spinner />;
  if (world.kind === 'missing') body = <p>This setup or saved run is no longer in the app.</p>;
  else if (world.kind === 'elsewhere') body = <p>This is open in another tab or window of the app. Close it there first, then reload this page.</p>;
  else if (world.kind === 'error') body = <p className="text-warn">It could not be opened: {world.message}</p>;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      {body}
      {world.kind !== 'loading' && world.kind !== 'none' && (
        <ButtonLink to="/" size="sm">
          Back to Home
        </ButtonLink>
      )}
    </div>
  );
}

/** Builds the "used up" flags for drawing from a world's saved stock (food, and stone once worlds kept it). */
function emptyFlags(doc: WorldDoc): Uint8Array {
  const n = doc.size * doc.size;
  const out = new Uint8Array(n);
  const stock = doc.state.stock;
  if (!stock || stock.length !== n) return out;
  const stoneKept = !!doc.state.trees;
  for (let i = 0; i < n; i++) {
    const d = doc.deposit[i];
    const kept = stoneKept && (d === Deposit.Stone || d === Deposit.Iron || d === Deposit.Gold);
    if ((d === Deposit.Berries || d === Deposit.Fish || kept) && stock[i] === 0) out[i] = 1;
  }
  return out;
}

/** Trees standing on each tile: as saved, or every forest tile full for a world that has not cut any. */
function treeCounts(doc: WorldDoc): Uint8Array {
  const n = doc.size * doc.size;
  if (doc.state.trees && doc.state.trees.length === n) return doc.state.trees.slice();
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (doc.terrain[i] === Terrain.Forest) out[i] = maxTrees(i % doc.size, Math.floor(i / doc.size));
  return out;
}

function bridgesOf(doc: WorldDoc): Uint8Array {
  const n = doc.size * doc.size;
  return doc.state.bridges && doc.state.bridges.length === n ? doc.state.bridges.slice() : new Uint8Array(n);
}

function roadsOf(doc: WorldDoc): Uint8Array {
  const n = doc.size * doc.size;
  return doc.state.roads && doc.state.roads.length === n ? doc.state.roads.slice() : new Uint8Array(n);
}

function wallsOf(doc: WorldDoc): Uint8Array {
  const n = doc.size * doc.size;
  return doc.state.walls && doc.state.walls.length === n ? doc.state.walls.slice() : new Uint8Array(n);
}

function territoryOf(doc: WorldDoc): Uint16Array {
  const n = doc.size * doc.size;
  return doc.state.territory && doc.state.territory.length === n ? doc.state.territory.slice() : new Uint16Array(n);
}

type SettlementOrderKind = 'build' | 'focus' | 'settlers' | 'abandon' | 'breakCulture' | 'expand' | 'research';
type MapView = 'nations' | 'cultures' | 'plain';
/** A settlement imperative being given: waiting for which settlement, then (build, settlers) where. */
type PendingSettlement = { kind: SettlementOrderKind; stage: 'which' | 'where'; building?: BuildingKind; focus?: Focus; tech?: string } | null;

const FOCUS_LABEL: Record<Focus, string> = { balanced: 'Balanced', food: 'Food', housing: 'Housing', goods: 'Goods' };
const BUILD_ORDER_KINDS = BUILDINGS.filter((b) => b.buildable).map((b) => b.kind);
const PLACE_KINDS = BUILDINGS.map((b) => b.kind);
const BUILDING_ICON: Record<number, typeof House> = {
  [BuildingKind.Campfire]: Flame,
  [BuildingKind.Hut]: Tent,
  [BuildingKind.House]: House,
  [BuildingKind.Storehouse]: Warehouse,
  [BuildingKind.Farm]: Wheat,
  [BuildingKind.Woodcutter]: Axe,
  [BuildingKind.Quarry]: Blocks,
  [BuildingKind.Mine]: Pickaxe,
  [BuildingKind.FishingHut]: Fish,
  [BuildingKind.Market]: Store,
  [BuildingKind.Smithy]: Anvil,
  [BuildingKind.Pottery]: Amphora,
  [BuildingKind.Mint]: Coins,
  [BuildingKind.Townhouse]: Building,
  [BuildingKind.Hall]: Landmark,
  [BuildingKind.Scriptorium]: ScrollText,
  [BuildingKind.University]: GraduationCap,
  [BuildingKind.Barracks]: Shield,
  [BuildingKind.Armory]: Swords,
  [BuildingKind.Stable]: Fence,
  [BuildingKind.Dock]: Anchor,
  [BuildingKind.Castle]: Castle,
  [BuildingKind.HuntingLodge]: Target,
  [BuildingKind.Pasture]: Beef,
  [BuildingKind.BanditCamp]: VenetianMask,
};

type OrderKind = 'move' | 'gather' | 'collect' | 'rest' | 'attack' | 'stop';
/** An imperative being given: waiting for who it is for, or for where (SPEC 4: either order works). */
type Pending = { kind: OrderKind; stage: 'who' | 'where' } | null;

const ORDER_LABEL: Record<OrderKind, string> = { move: 'Move', gather: 'Gather food', collect: 'Gather resources', rest: 'Rest', attack: 'Attack', stop: 'Stop' };
/** Resources people can be ordered to gather (Caleb after Stage 5). */
const COLLECT_GOODS: Good[] = ['wood', 'stone', 'iron', 'gold', 'clay'];
const SOLDIER_KINDS: { kind: SoldierKind; label: string; note: string }[] = [
  { kind: 'infantry', label: 'Infantry', note: 'a sword and mail' },
  { kind: 'archer', label: 'Archer', note: 'a bow' },
  { kind: 'cavalry', label: 'Cavalry', note: 'a sword, mail and a horse' },
  { kind: 'artillery', label: 'Artillery', note: 'a catapult and a spear' },
];
/** Animals the player can place (Stage 6). */
const CREATURE_TOOLS: { kind: CreatureKind; label: string; note: string }[] = [
  { kind: 'deer', label: 'Deer', note: 'Game that runs from people. Hunters hunt them for meat.' },
  { kind: 'boar', label: 'Boar', note: 'Game that fights back when struck.' },
  { kind: 'wolf', label: 'Wolf', note: 'Hunts game, and people out on their own when hungry, mostly in winter.' },
  { kind: 'bear', label: 'Bear', note: 'Attacks anyone who comes too close, and hunts when hungry.' },
  { kind: 'cattle', label: 'Aurochs', note: 'Wild cattle, which fight back when struck. Herders tame them as cattle, which give food and pull the plough.' },
  { kind: 'sheep', label: 'Wild sheep', note: 'Run from people. Herders tame them as sheep, which give food.' },
  { kind: 'dragon', label: 'Dragon', note: 'Click once: a dragon flies out of the nearest mountains, burns the settlements near them for some months, and flies home unless it is slain.' },
];
const DISASTER_TOOLS: { kind: DisasterKind; label: string; icon: ReactNode; note: string }[] = [
  { kind: 'fire', label: 'Fire', icon: <Flame className="size-5" />, note: 'Sets the building clicked (or the trees there) alight. Fire leaps to buildings near it, and spreads through forest; townspeople come to put it out, and rain helps.' },
  { kind: 'flood', label: 'Flood', icon: <Waves className="size-5" />, note: 'Water rises over the low land beside the nearest river, lake or coast for a month or more: crops and berries are lost, part of a flooded store spoils, and walking is slow.' },
  { kind: 'earthquake', label: 'Earthquake', icon: <Activity className="size-5" />, note: 'The ground shakes where you click: buildings near it may fall (stone stands better than timber), and people near are hurt.' },
  { kind: 'plague', label: 'Plague', icon: <Biohazard className="size-5" />, note: 'A sickness breaks out among the people clicked, or in the nearest settlement. It passes from person to person; the sick lose health, and some die.' },
  { kind: 'locusts', label: 'Locusts', icon: <Bug className="size-5" />, note: 'A swarm comes down and drifts for a few months, eating the crops and berries under it.' },
  { kind: 'drought', label: 'Drought', icon: <ThermometerSun className="size-5" />, note: 'No rain over a wide area for months: crops and berries grow slowly there, and fires spread.' },
  { kind: 'storm', label: 'Storm', icon: <CloudLightning className="size-5" />, note: 'A great storm that drifts across the land: walking and work are slow, and lightning may set buildings and trees alight.' },
  { kind: 'dragon', label: 'Dragon', icon: <Skull className="size-5" />, note: 'A dragon flies out of the mountains nearest where you click, burns the settlements near them for some months, and flies home unless it is slain.' },
];
const EFFECT_TOOLS: { kind: EffectKind; label: string; icon: ReactNode; note: string }[] = [
  { kind: 'rain', label: 'Rain', icon: <CloudRain className="size-5" />, note: 'Rain over the brush for two months (snow in winter). Puts out fires; slows walking and work a little.' },
  { kind: 'snow', label: 'Snow', icon: <Snowflake className="size-5" />, note: 'Snow over the brush for two months. Slows walking and work; people with no home are hurt by the cold in winter.' },
  { kind: 'fog', label: 'Fog', icon: <CloudFog className="size-5" />, note: 'Fog over the brush for two months. Walking is a little slower.' },
  { kind: 'clear', label: 'Clear sky', icon: <Sun className="size-5" />, note: 'Clears the weather over the brush, and ends a drought there.' },
  { kind: 'sicken', label: 'Sickness', icon: <Biohazard className="size-5" />, note: 'Makes the people in the brush sick. It spreads to people near them.' },
  { kind: 'heal', label: 'Heal', icon: <HeartPulse className="size-5" />, note: 'Cures the people in the brush of sickness and restores their health.' },
];
const RECORD_KINDS: { kind: RecordKind; label: string }[] = [
  { kind: 'settlement', label: 'Settlements' },
  { kind: 'nation', label: 'Nations' },
  { kind: 'war', label: 'Wars' },
  { kind: 'culture', label: 'Cultures' },
  { kind: 'disaster', label: 'Disasters' },
  { kind: 'crime', label: 'Crime' },
  { kind: 'creature', label: 'Beasts' },
];
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

function WorldScreen({ doc }: { doc: WorldDoc }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<IsoView | null>(null);
  const clientRef = useRef<SimClient | null>(null);
  const navigate = useNavigate();
  const unsaved = useApp((s) => s.worldUnsaved);
  const [tab, setTab] = useState<Tab>('main');
  const [tool, setTool] = useState<UnitTool>('person');
  const [soldierKind, setSoldierKind] = useState<SoldierKind>('infantry');
  const [creatureKind, setCreatureKind] = useState<CreatureKind>('deer');
  const [hazard, setHazard] = useState<HazardTool>({ type: 'disaster', kind: 'fire' });
  const [chosenCreature, setChosenCreature] = useState<number | null>(null);
  const [creatureDetails, setCreatureDetails] = useState<CreatureDetails | null>(null);
  const chosenCreatureRef = useRef<number | null>(null);
  chosenCreatureRef.current = chosenCreature;
  const [recordOpen, setRecordOpen] = useState(false);
  const [record, setRecord] = useState<RecordEntry[]>(() => doc.state.record ?? []);
  const [collectGood, setCollectGood] = useState<Good>('wood');
  const collectGoodRef = useRef(collectGood);
  collectGoodRef.current = collectGood;
  const [chosenBuilding, setChosenBuilding] = useState<number | null>(null);
  const [buildingDetails, setBuildingDetails] = useState<BuildingDetails | null>(null);
  /** Which way round a building being placed or ordered goes (R turns it). */
  const [rot, setRot] = useState<0 | 1>(0);
  const [radius, setRadius] = useState(2);
  const [speed, setSpeedState] = useState<Speed>(0);
  const [tick, setTick] = useState(doc.state.tick);
  const [population, setPopulation] = useState(doc.state.people.length);
  /** The people chosen, for inspecting (one) or giving imperatives (one or more). */
  const [selection, setSelection] = useState<number[]>([]);
  const [details, setDetails] = useState<PersonDetails | null>(null);
  const [died, setDied] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [toggles, setTogglesState] = useState<Toggles>({ ...DEFAULT_TOGGLES, ...doc.state.toggles });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The tick the world was at when it was loaded or last saved. */
  const [savedTick, setSavedTick] = useState(doc.state.tick);
  const docRef = useRef(doc);
  docRef.current = doc;
  const savedTickRef = useRef(savedTick);
  savedTickRef.current = savedTick;
  const empty = useRef(emptyFlags(doc));
  const trees = useRef(treeCounts(doc));
  const territory = useRef(territoryOf(doc));
  const covered = useRef(new Uint8Array(doc.size * doc.size));
  const walls = useRef(wallsOf(doc));
  const roads = useRef(roadsOf(doc));
  const bridges = useRef(bridgesOf(doc));
  const buildingsRef = useRef<BuildingView[]>([]);
  const buildingAt = useRef(new Map<number, BuildingView>());
  const settlementsRef = useRef<SettlementView[]>([]);
  const [settlementCount, setSettlementCount] = useState((doc.state.settlements ?? []).filter((x) => !x.abandoned).length);
  const [chosenSettlement, setChosenSettlement] = useState<number | null>(null);
  const chosenSettlementRef = useRef<number | null>(null);
  chosenSettlementRef.current = chosenSettlement;
  const [settlementDetails, setSettlementDetails] = useState<SettlementDetails | null>(null);
  const [pendingS, setPendingS] = useState<PendingSettlement>(null);
  /** Cultures (Stage 4a), the one whose panel is open, and which map view is shown. */
  const [cultures, setCultures] = useState<CultureView[]>([]);
  const culturesRef = useRef<CultureView[]>([]);
  const [chosenCulture, setChosenCultureState] = useState<number | null>(null);
  /** Nations (Stage 4b), and the one whose panel is open. */
  const [nations, setNations] = useState<NationView[]>([]);
  const nationsRef = useRef<NationView[]>([]);
  const [chosenNation, setChosenNationState] = useState<number | null>(null);
  // A culture's or a nation's panel replaces the other.
  const setChosenCulture = (id: number | null) => {
    setChosenCultureState(id);
    if (id !== null) setChosenNationState(null);
  };
  const setChosenNation = (id: number | null) => {
    setChosenNationState(id);
    if (id !== null) setChosenCultureState(null);
  };
  const [mapView, setMapView] = useState<MapView>('nations');
  const mapViewRef = useRef<MapView>(mapView);
  mapViewRef.current = mapView;
  const landKey = useRef('plain');
  /** Colors settlements' land for the map view chosen (redrawn only when the colors change). */
  const applyLand = () => {
    const view = viewRef.current;
    if (!view) return;
    if (mapViewRef.current === 'plain') {
      if (landKey.current !== 'plain') {
        landKey.current = 'plain';
        view.setLandColors(null);
      }
      return;
    }
    const byId = new Map(culturesRef.current.map((c) => [c.id, c]));
    const nById = new Map(nationsRef.current.map((n) => [n.id, n]));
    const colors = new Map<number, string>();
    for (const x of settlementsRef.current) {
      if (x.abandoned) continue;
      if (mapViewRef.current === 'nations') {
        const n = x.nation !== undefined ? nById.get(x.nation) : undefined;
        colors.set(x.id, n ? withAlpha(NATION_COLORS[n.color], 0.42) : 'rgba(0, 38, 87, 0.07)');
      } else {
        const c = x.culture !== undefined ? byId.get(x.culture) : undefined;
        colors.set(x.id, c ? withAlpha(CULTURE_COLORS[c.color], 0.4) : 'rgba(0, 38, 87, 0.07)');
      }
    }
    const key = [...colors].map(([k, v]) => `${k}:${v}`).join('|');
    if (key === landKey.current) return;
    landKey.current = key;
    view.setLandColors(colors);
  };
  const applyLandRef = useRef(applyLand);
  applyLandRef.current = applyLand;
  useEffect(() => applyLandRef.current(), [mapView]);

  const selectedSet = useRef<Set<number>>(new Set());
  const live = useRef({ tab, tool, radius, pending, selection, pendingS, chosenSettlement, rot, soldierKind, creatureKind, hazard });
  live.current = { tab, tool, radius, pending, selection, pendingS, chosenSettlement, rot, soldierKind, creatureKind, hazard };
  /** The box being dragged out to choose people, in screen pixels. */
  const box = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const atStart = tick === savedTick;
  const isSetup = doc.kind === 'setup';
  const inspected = selection.length === 1 ? selection[0] : null;

  const chooseSettlement = (id: number | null) => {
    if (id !== null) {
      setChosenCultureState(null);
      setChosenNationState(null);
    }
    setChosenSettlement(id);
    chosenSettlementRef.current = id;
    if (id === null) setSettlementDetails(null);
    clientRef.current?.watchSettlement(id);
    viewRef.current?.redraw();
  };
  const chooseSettlementRef = useRef(chooseSettlement);
  chooseSettlementRef.current = chooseSettlement;
  /** Opens a building's info panel (Caleb after Stage 5), or closes it. */
  const chooseBuilding = (id: number | null) => {
    if (id !== null) {
      setChosenCultureState(null);
      setChosenNationState(null);
    }
    setChosenBuilding(id);
    if (id === null) setBuildingDetails(null);
    clientRef.current?.watchBuilding(id);
  };
  const chooseBuildingRef = useRef(chooseBuilding);
  chooseBuildingRef.current = chooseBuilding;
  /** Follows an animal for its panel. */
  const chooseCreature = (id: number | null) => {
    setChosenCreature(id);
    if (id === null) setCreatureDetails(null);
    clientRef.current?.watchCreature(id);
    viewRef.current?.redraw();
  };
  const chooseCreatureRef = useRef(chooseCreature);
  chooseCreatureRef.current = chooseCreature;

  const choose = (ids: number[]) => {
    if (ids.length) {
      setChosenCultureState(null);
      setChosenNationState(null);
    }
    if (ids.length && chosenSettlementRef.current !== null) chooseSettlementRef.current(null);
    setSelection(ids);
    selectedSet.current = new Set(ids);
    setDied(null);
    if (ids.length !== 1) setDetails(null);
    clientRef.current?.watch(ids.length === 1 ? ids[0] : null);
    viewRef.current?.redraw();
  };

  /** Gives an imperative to the chosen people, at a tile if it needs one. */
  const giveOrder = (kind: OrderKind, ids: number[], tile?: number) => {
    const client = clientRef.current;
    if (!client || !ids.length) return;
    if (kind === 'stop') client.order(ids, { kind: 'stop' });
    else if (kind === 'collect') client.order(ids, { kind, tile, good: collectGoodRef.current });
    else client.order(ids, { kind, tile });
    setWorldUnsaved(true);
    notify(`${ORDER_LABEL[kind]}: ${ids.length === 1 ? '1 person' : `${ids.length} people`}.`);
  };
  const giveRef = useRef(giveOrder);
  giveRef.current = giveOrder;
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  /** A settlement's technologies: its nation's, or its own culture's (Stage 4c). */
  const techsOfSettlement = (id: number): Set<string> => {
    const sv = settlementsRef.current.find((x) => x.id === id);
    const n = sv?.nation !== undefined ? nationsRef.current.find((x) => x.id === sv.nation) : undefined;
    if (n) return new Set(n.techs);
    const c = sv?.culture !== undefined ? culturesRef.current.find((x) => x.id === sv.culture) : undefined;
    return new Set(c?.techs ?? []);
  };

  /** Gives an imperative to a settlement (SPEC 4). */
  const giveSettlement = (ps: NonNullable<PendingSettlement>, id: number, tile?: number) => {
    const client = clientRef.current;
    if (!client) return;
    const name = settlementsRef.current.find((x) => x.id === id)?.name ?? 'The settlement';
    if (ps.kind === 'build' && ps.building !== undefined && tile !== undefined) {
      const need = BUILDING_TECH[ps.building];
      if (need && !techsOfSettlement(id).has(need)) {
        notify(`${name} does not know ${TECH_BY_ID.get(need)!.name} yet, which a ${BUILDINGS[ps.building].name.toLowerCase()} needs.`, 'warn');
        return;
      }
      client.settlementOrder(id, { kind: 'build', building: ps.building, tile, rot: live.current.rot });
      notify(`${name}: build a ${BUILDINGS[ps.building].name.toLowerCase()} there.`);
    } else if (ps.kind === 'focus' && ps.focus) {
      client.settlementOrder(id, { kind: 'focus', focus: ps.focus });
      notify(`${name}: focus on ${FOCUS_LABEL[ps.focus].toLowerCase()}.`);
    } else if (ps.kind === 'settlers' && tile !== undefined) {
      client.settlementOrder(id, { kind: 'settlers', tile });
      notify(`${name}: settlers are setting out.`);
    } else if (ps.kind === 'expand' && tile !== undefined) {
      const sv = settlementsRef.current.find((x) => x.id === id);
      const n = nationsRef.current.find((x) => x.id === sv?.nation);
      if (!n) {
        notify(`${name} belongs to no nation.`, 'warn');
        return;
      }
      client.nationOrder(n.id, { kind: 'expand', tile });
      notify(`${n.name}: settlers are setting out to take land there.`);
    } else if (ps.kind === 'research' && ps.tech) {
      // An order to the settlement's culture (SPEC 4: imperatives to cultures; Caleb: the player can steer research).
      const sv = settlementsRef.current.find((x) => x.id === id);
      const c = culturesRef.current.find((x) => x.id === sv?.culture);
      const t = TECH_BY_ID.get(ps.tech)!;
      if (!c) {
        notify(`${name} has no culture yet.`, 'warn');
        return;
      }
      if (c.techs.includes(t.id)) {
        notify(`The ${c.name} already know ${t.name}.`, 'warn');
        return;
      }
      const missing = t.needs.filter((x) => !c.techs.includes(x));
      if (missing.length) {
        notify(`The ${c.name} need ${missing.map((x) => TECH_BY_ID.get(x)!.name).join(' and ')} before ${t.name}.`, 'warn');
        return;
      }
      client.cultureEdit(c.id, { research: t.id });
      notify(`The ${c.name} now research ${t.name}.`);
    } else if (ps.kind === 'breakCulture') {
      const sv = settlementsRef.current.find((x) => x.id === id);
      const culture = culturesRef.current.find((c) => c.id === sv?.culture);
      if (!culture) {
        notify(`${name} has no culture to break from yet.`, 'warn');
        return;
      }
      client.settlementOrder(id, { kind: 'breakCulture' });
      notify(`${name}: its ${culture.name} people break away and found a new culture.`);
    } else if (ps.kind === 'abandon') {
      void confirmDialog({ title: `Abandon ${name}?`, body: 'Its people leave and its land is given up. Its buildings stand empty for anyone to take over.', confirm: 'Abandon', danger: true }).then((ok) => {
        if (ok) {
          client.settlementOrder(id, { kind: 'abandon' });
          setWorldUnsaved(true);
          chooseSettlementRef.current(null);
        }
      });
      return;
    } else return;
    setWorldUnsaved(true);
  };
  const giveSettlementRef = useRef(giveSettlement);
  giveSettlementRef.current = giveSettlement;

  /** A settlement order button: needs a settlement (the chosen one, or the next one clicked), then maybe a place. */
  const onSettlementOrderRef = useRef<(ps: NonNullable<PendingSettlement>) => void>(() => {});
  const onSettlementOrder = (ps: NonNullable<PendingSettlement>) => {
    setPending(null);
    if (chosenSettlement === null) return setPendingS({ ...ps, stage: 'which' });
    if (ps.kind === 'build' || ps.kind === 'settlers' || ps.kind === 'expand') return setPendingS({ ...ps, stage: 'where' });
    giveSettlement(ps, chosenSettlement);
    setPendingS(null);
  };
  onSettlementOrderRef.current = onSettlementOrder;

  // Start the simulation and the view once, when the screen opens.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const view = new IsoView(canvas, { size: doc.size, terrain: doc.terrain, elevation: doc.elevation, deposit: doc.deposit, empty: empty.current, trees: trees.current, territory: territory.current, covered: covered.current, walls: walls.current, roads: roads.current, bridges: bridges.current });
    const client = new SimClient();
    viewRef.current = view;
    clientRef.current = client;
    client.init(doc.size, doc.terrain, doc.elevation, doc.deposit, doc.state);
    // The panels only need to change when the month does (or when time first moves), so
    // the interface is not redrawn for every step.
    let shownMonth = -1;
    let lastPopAt = 0;
    let shownAtStart = true;
    client.onSnapshot = (s) => {
      if (s.quake !== undefined) view.shakeUntil = performance.now() + SHAKE_MS;
      if (s.weather) view.redraw();
      const month = Math.floor(s.tick / TICKS_PER_MONTH);
      const atStartNow = s.tick === savedTickRef.current;
      if (month !== shownMonth || atStartNow !== shownAtStart) {
        shownMonth = month;
        shownAtStart = atStartNow;
        setTick(s.tick);
      }
      if (!atStartNow) setWorldUnsaved(true);
      // The panel's head count is refreshed a few times a second at most (each refresh redraws the panels).
      const nowMs = performance.now();
      if (nowMs - lastPopAt > 300 || s.ids.length === 0) {
        lastPopAt = nowMs;
        setPopulation(s.ids.length);
      }
      const tc = s.tileChanges;
      for (let k = 0; k < tc.length; k += 3) {
        const t = tc[k];
        const f = tc[k + 1];
        const v = tc[k + 2];
        if (f === TileField.Empty) empty.current[t] = v;
        else if (f === TileField.Trees) trees.current[t] = v;
        else if (f === TileField.Walls) walls.current[t] = v;
        else if (f === TileField.Roads) roads.current[t] = v;
        else if (f === TileField.Bridges) bridges.current[t] = v;
        else territory.current[t] = v;
        stockDirty.add(t);
      }
      if (s.buildings) {
        buildingsRef.current = s.buildings;
        // Every tile a building stands on, so clicking anywhere on it finds it.
        const at = new Map<number, BuildingView>();
        for (const b of s.buildings) {
          const bx = b.tile % doc.size;
          const by = Math.floor(b.tile / doc.size);
          for (let y = by; y < by + b.d; y++) for (let x = bx; x < bx + b.w; x++) at.set(y * doc.size + x, b);
        }
        buildingAt.current = at;
        // Tiles newly covered or uncovered are redrawn without (or with) their drawings.
        const cov = covered.current;
        for (const t of coveredTiles) {
          if (!at.has(t)) {
            cov[t] = 0;
            stockDirty.add(t);
          }
        }
        for (const t of at.keys()) {
          if (!cov[t]) {
            cov[t] = 1;
            stockDirty.add(t);
          }
        }
        coveredTiles = new Set(at.keys());
      }
      if (s.settlements) {
        settlementsRef.current = s.settlements;
        setSettlementCount(s.settlements.filter((x) => !x.abandoned).length);
      }
      if (s.cultures) {
        culturesRef.current = s.cultures;
        setCultures(s.cultures);
      }
      if (s.nations) {
        nationsRef.current = s.nations;
        setNations(s.nations);
      }
      if (s.settlements || s.cultures || s.nations) applyLandRef.current();
      view.redraw();
    };
    client.onWatchedSettlement = (d) => setSettlementDetails(d);
    client.onWatchedBuilding = (d) => setBuildingDetails(d);
    client.onWatchedCreature = (d) => setCreatureDetails(d);
    client.onRecord = (entries) => setRecord((r) => (r.length + entries.length > 3000 ? [...r, ...entries].slice(-3000) : [...r, ...entries]));
    // Bushes being picked, trees cut and land claimed are redrawn together about once a
    // second, not on every step, since each redraw of the terrain costs far more than drawing people.
    const stockDirty = new Set<number>();
    let coveredTiles = new Set<number>();
    const stockTimer = window.setInterval(() => {
      if (!stockDirty.size) return;
      view.tilesChanged(stockDirty);
      stockDirty.clear();
    }, 1000);
    // The inspect panel is refreshed a few times a second, not on every step.
    let lastWatched = 0;
    client.onWatched = (p, cause) => {
      const now = performance.now();
      if (p && now - lastWatched < 250) return;
      lastWatched = now;
      setDetails(p);
      if (!p && cause) setDied(cause);
    };
    client.onError = (m) => notify(`The simulation stopped with an error: ${m}`, 'warn');

    const placed = new Set<number>();
    const act = (t: { x: number; y: number } | null, first = false) => {
      if (!t) return;
      const { tab, tool, radius } = live.current;
      const i = t.y * doc.size + t.x;
      if (tab === 'disasters') {
        const hz = live.current.hazard;
        if (hz.type === 'disaster' || hz.kind === 'rain' || hz.kind === 'snow' || hz.kind === 'fog' || hz.kind === 'clear') {
          // Once per click (a drag does not set off a disaster on every tile).
          if (!first) return;
          if (hz.type === 'disaster') client.disaster(hz.kind, i);
          else client.effect(hz.kind, brushTiles(t.x, t.y, radius - 0.5, doc.size).map(([x, y]) => y * doc.size + x));
        } else {
          const tiles = brushTiles(t.x, t.y, radius - 0.5, doc.size).map(([x, y]) => y * doc.size + x).filter((x) => !placed.has(x));
          for (const x of tiles) placed.add(x);
          client.effect(hz.kind, tiles);
        }
        setWorldUnsaved(true);
        return;
      }
      if (tab !== 'units') return;
      if (tool === 'creature') {
        if (placed.has(i) || (live.current.creatureKind === 'dragon' && !first)) return;
        placed.add(i);
        client.placeCreatures([i], live.current.creatureKind);
      } else if (tool === 'criminal') {
        if (placed.has(i)) return;
        placed.add(i);
        client.placeCriminals([i]);
      } else if (tool === 'person') {
        if (placed.has(i)) return;
        placed.add(i);
        client.place([i]);
      } else if (tool === 'soldier') {
        if (placed.has(i)) return;
        placed.add(i);
        const b = buildingAt.current.get(i);
        const owner = (b && b.settlement) || territory.current[i];
        const sv = settlementsRef.current.find((x) => x.id === owner);
        if (!sv || sv.abandoned || sv.nation === undefined) return notify('Soldiers are placed on a nation’s land (a settlement that belongs to a nation).', 'warn');
        client.placeSoldiers([i], live.current.soldierKind);
      } else if (tool === 'nation') {
        if (placed.has(i)) return;
        placed.add(i);
        const b = buildingAt.current.get(i);
        const owner = (b && b.settlement) || territory.current[i];
        const sv = settlementsRef.current.find((x) => x.id === owner);
        if (!sv || sv.abandoned) return notify('Click a settlement (one of its buildings, or its land).', 'warn');
        if (sv.nation !== undefined) return notify(`${sv.name} already belongs to a nation.`, 'warn');
        client.placeNation(sv.id);
        notify(`${sv.name} is now the capital of a new nation.`);
      } else if (tool === 'remove') {
        const tiles = brushTiles(t.x, t.y, radius - 0.5, doc.size).map(([x, y]) => y * doc.size + x);
        client.remove(tiles);
        client.removeBuildings(tiles);
      } else {
        if (placed.has(i)) return;
        placed.add(i);
        client.placeBuilding(tool, i, live.current.rot);
      }
      setWorldUnsaved(true);
    };

    /** People whose feet are inside a screen rectangle. */
    const inBox = (b: { x0: number; y0: number; x1: number; y1: number }) => {
      const x0 = Math.min(b.x0, b.x1);
      const x1 = Math.max(b.x0, b.x1);
      const y0 = Math.min(b.y0, b.y1);
      const y1 = Math.max(b.y0, b.y1);
      const { size, elevation } = view.src;
      return client.idsWhere(performance.now(), (x, y) => {
        const h = elevation[Math.min(size - 1, Math.floor(y)) * size + Math.min(size - 1, Math.floor(x))];
        const [sx, sy] = view.toScreen((x - y) * 0.5, (x + y) * 0.25 - h * STEP);
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      });
    };

    /** A click or a finished box in the Imperatives tab. */
    const imperativePick = (ids: number[], tile: { x: number; y: number } | null, wasBox: boolean) => {
      const { pending, selection } = live.current;
      if (pending?.stage === 'where') {
        if (!tile || wasBox) return;
        giveRef.current(pending.kind, selection, tile.y * doc.size + tile.x);
        setPending(null);
        return;
      }
      chooseRef.current(ids);
      if (pending?.stage === 'who' && ids.length) {
        if (pending.kind === 'move' || pending.kind === 'gather' || pending.kind === 'collect' || pending.kind === 'attack') setPending({ kind: pending.kind, stage: 'where' });
        else {
          giveRef.current(pending.kind, ids);
          setPending(null);
        }
      }
    };

    /** A click while a settlement imperative is being given. */
    const settlementPick = (tile: { x: number; y: number } | null) => {
      const ps = live.current.pendingS;
      if (!ps || !tile) return;
      const t = tile.y * doc.size + tile.x;
      if (ps.stage === 'which') {
        const b = buildingAt.current.get(t);
        const owner = (b && b.settlement) || territory.current[t];
        if (!owner) return;
        chooseSettlementRef.current(owner);
        if (ps.kind === 'build' || ps.kind === 'settlers' || ps.kind === 'expand') setPendingS({ ...ps, stage: 'where' });
        else {
          giveSettlementRef.current(ps, owner);
          setPendingS(null);
        }
        return;
      }
      const target = live.current.chosenSettlement;
      if (target === null) return;
      giveSettlementRef.current(ps, target, t);
      setPendingS(null);
    };

    view.hooks = {
      onPointerDown: (p) => {
        const { tab } = live.current;
        if (tab === 'main') {
          const id = pickPerson(view, client, p.sx, p.sy, performance.now());
          if (id !== null) {
            chooseCreatureRef.current(null);
            return chooseRef.current([id]);
          }
          chooseRef.current([]);
          const animal = pickCreature(view, client, p.sx, p.sy, performance.now());
          chooseCreatureRef.current(animal);
          if (animal !== null) {
            chooseSettlementRef.current(null);
            chooseBuildingRef.current(null);
            return;
          }
          const b = p.tile ? buildingAt.current.get(p.tile.y * doc.size + p.tile.x) : undefined;
          chooseSettlementRef.current(null);
          chooseBuildingRef.current(b ? b.id : null);
          return;
        }
        if (tab === 'imperatives' && live.current.pendingS) {
          settlementPick(p.tile);
          return;
        }
        if (tab === 'imperatives') {
          box.current = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy };
          return;
        }
        placed.clear();
        act(p.tile, true);
      },
      onPointerMove: (p) => {
        if (live.current.tab === 'imperatives' && box.current) {
          box.current.x1 = p.sx;
          box.current.y1 = p.sy;
          view.redraw();
          return;
        }
        act(p.tile);
      },
      onPointerUp: (p) => {
        placed.clear();
        const b = box.current;
        box.current = null;
        if (live.current.tab !== 'imperatives' || !b || live.current.pendingS) return;
        view.redraw();
        if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 6) imperativePick(inBox(b), null, true);
        else {
          const id = pickPerson(view, client, p.sx, p.sy, performance.now());
          imperativePick(id === null ? [] : [id], p.tile, false);
        }
      },
      ground: (ctx, v) => drawWeatherGround(ctx, v, client.weather),
      objects: (ctx, v, now) => {
        drawPeople(ctx, v, client, now, selectedSet.current, buildingsRef.current, chosenSettlementRef.current, chosenCreatureRef.current);
        drawWeatherSky(ctx, v, client.weather, now);
      },
      overlay: (ctx, v) => {
        const b = box.current;
        if (b && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 6) {
          ctx.fillStyle = 'rgba(252, 63, 63, 0.1)';
          ctx.strokeStyle = 'rgba(252, 63, 63, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          const x = Math.min(b.x0, b.x1);
          const y = Math.min(b.y0, b.y1);
          ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
          ctx.strokeRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
          ctx.setLineDash([]);
        }
        drawLabels(ctx, v, settlementsRef.current, chosenSettlementRef.current);
        const h = v.hover;
        const { tab, tool, radius, pending, pendingS, rot } = live.current;
        const showTile = (tab === 'imperatives' && (pending?.stage === 'where' || pendingS?.stage === 'where')) || (tab === 'disasters' && live.current.hazard.type === 'disaster');
        const brush = tab === 'disasters' && live.current.hazard.type === 'effect';
        if (!h || (tab !== 'units' && !showTile && !brush)) return;
        ctx.beginPath();
        // A building's whole footprint, red where it fits and navy where it does not.
        const placing = tab === 'units' && typeof tool === 'number' ? tool : pendingS?.stage === 'where' && pendingS.kind === 'build' ? pendingS.building : undefined;
        let fits = true;
        if (placing !== undefined && placing !== BuildingKind.Campfire) {
          const { w, d } = footprint(placing, rot);
          const anchor = anchorFor(placing, rot, h.y * doc.size + h.x, doc.size);
          const ax = anchor % doc.size;
          const ay = Math.floor(anchor / doc.size);
          let lo = Infinity;
          let hi = -Infinity;
          for (let y = ay; y < ay + d; y++) {
            for (let x = ax; x < ax + w; x++) {
              if (x < 0 || y < 0 || x >= doc.size || y >= doc.size) {
                fits = false;
                continue;
              }
              const t = y * doc.size + x;
              v.traceTile(ctx, x, y);
              const ter = doc.terrain[t];
              const ok = kindAllowsTerrain(placing, ter, true);
              if (!ok || buildingAt.current.has(t) || walls.current[t] !== 0) fits = false;
              lo = Math.min(lo, doc.elevation[t]);
              hi = Math.max(hi, doc.elevation[t]);
            }
          }
          if (hi - lo > 1) fits = false;
          if (needsShore(placing)) {
            // One of its tiles must be beside water.
            let shore = false;
            for (let y = ay - 1; y <= ay + d && !shore; y++) {
              for (let x = ax - 1; x <= ax + w; x++) {
                if (x < 0 || y < 0 || x >= doc.size || y >= doc.size) continue;
                if (x >= ax && x < ax + w && y >= ay && y < ay + d) continue;
                const ter = doc.terrain[y * doc.size + x];
                if (ter === Terrain.DeepWater || ter === Terrain.ShallowWater) {
                  shore = true;
                  break;
                }
              }
            }
            if (!shore) fits = false;
          }
        } else {
          const r = (tab === 'units' && tool === 'remove') || brush ? radius - 0.5 : 0.5;
          for (const [x, y] of brushTiles(h.x, h.y, r, doc.size)) v.traceTile(ctx, x, y);
        }
        ctx.fillStyle = fits ? 'rgba(252, 63, 63, 0.18)' : 'rgba(0, 38, 87, 0.28)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(252, 63, 63, 0.85)';
        ctx.stroke();
      },
    };
    view.start();
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __view: view, __sim: client, __pick: pickPerson });
    return () => {
      window.clearInterval(stockTimer);
      view.destroy();
      client.destroy();
      viewRef.current = null;
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw every frame while time runs (people move between steps); otherwise only on change.
  useEffect(() => {
    if (viewRef.current) viewRef.current.animating = speed > 0;
  }, [speed]);
  useEffect(() => viewRef.current?.redraw(), [tab, tool, radius, selection, pending, pendingS, chosenSettlement, rot, hazard, chosenCreature]);
  // Changing tabs drops a half-given imperative.
  useEffect(() => {
    setPending(null);
    setPendingS(null);
  }, [tab]);

  const setSpeed = (s: Speed) => {
    clientRef.current?.setSpeed(s);
    setSpeedState(s);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        setSpeed(speed === 0 ? 1 : 0);
      } else if (e.key === '1' || e.key === '2' || e.key === '3') setSpeed(Number(e.key) as Speed);
      else if (e.key === 'r' || e.key === 'R') setRot((r) => (r ? 0 : 1));
      else if (e.key === 'Escape') {
        if (pendingS) setPendingS(null);
        else if (pending) setPending(null);
        else {
          choose([]);
          setTab('main');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onOrderButton = (kind: OrderKind) => {
    if (!selection.length) {
      setPending({ kind, stage: 'who' });
      return;
    }
    if (kind === 'move' || kind === 'gather' || kind === 'collect' || kind === 'attack') setPending({ kind, stage: 'where' });
    else {
      giveOrder(kind, selection);
      setPending(null);
    }
  };

  const currentState = async () => {
    const client = clientRef.current!;
    return client.save();
  };

  const onSaveSetup = async () => {
    setBusy(true);
    const { state, deposit } = await currentState();
    const r = await saveWorld(docRef.current, state, deposit);
    setBusy(false);
    if (!r.ok) return alertDialog({ title: 'Could not save', body: r.reason });
    setSavedTick(state.tick);
    notify('Setup saved.');
  };

  const onSaveRun = async () => {
    const d = docRef.current;
    const wasSpeed = speed;
    setSpeed(0);
    if (d.kind === 'run') {
      setBusy(true);
      const { state, deposit } = await currentState();
      const r = await saveWorld(d, state, deposit);
      setBusy(false);
      if (!r.ok) return alertDialog({ title: 'Could not save', body: r.reason });
      setSavedTick(state.tick);
      notify('Run saved.');
    } else {
      const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
      const name = await promptDialog({ title: 'Save run', label: 'Name', value: `${d.name}, year ${year}`, confirm: 'Save' });
      if (!name) return setSpeed(wasSpeed);
      setBusy(true);
      const { state, deposit } = await currentState();
      const r = await saveRunAs(d, name, state, deposit);
      setBusy(false);
      if (!r.ok) return alertDialog({ title: 'Could not save', body: r.reason });
      setSavedTick(state.tick);
      notify(`Saved as “${r.value.name}”. Saving again updates it.`);
      navigate(`/world/${r.value.id}`, { replace: true });
    }
    setSpeed(wasSpeed);
  };

  const onRestart = async () => {
    const d = docRef.current;
    const setupId = d.kind === 'setup' ? d.id : d.setupId;
    if (!setupId) return;
    if (unsaved) {
      const ok = await confirmDialog({ title: 'Start again from the setup?', body: 'Changes since the last save are lost.', confirm: 'Start again', danger: true });
      if (!ok) return;
    }
    if (d.kind === 'run') {
      setWorldUnsaved(false);
      navigate(`/world/${setupId}`);
      return;
    }
    const setup = await readSetup(setupId);
    if (!setup) return alertDialog({ title: 'The setup is gone', body: 'It was deleted, so there is nothing to start again from.' });
    setSpeed(0);
    clientRef.current?.init(setup.size, setup.terrain, setup.elevation, setup.deposit, setup.state);
    setTogglesState({ ...DEFAULT_TOGGLES, ...setup.state.toggles });
    empty.current.set(emptyFlags(setup));
    trees.current.set(treeCounts(setup));
    territory.current.set(territoryOf(setup));
    covered.current.fill(0);
    walls.current.set(wallsOf(setup));
    roads.current.set(roadsOf(setup));
    bridges.current.set(bridgesOf(setup));
    buildingsRef.current = [];
    buildingAt.current = new Map();
    viewRef.current?.replaceTiles({ size: setup.size, terrain: doc.terrain, elevation: doc.elevation, deposit: doc.deposit, empty: empty.current, trees: trees.current, territory: territory.current, covered: covered.current, walls: walls.current, roads: roads.current, bridges: bridges.current });
    choose([]);
    chooseSettlement(null);
    setSavedTick(setup.state.tick);
    setTick(setup.state.tick);
    setWorldUnsaved(false);
  };

  const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
  const month = Math.floor((tick % TICKS_PER_YEAR) / TICKS_PER_MONTH) % MONTHS_PER_YEAR;
  const setupAvailable = isSetup || !!doc.setupId;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: BACKDROP }}>
      <canvas ref={canvasRef} tabIndex={0} className="absolute inset-0 h-full w-full outline-none" />

      {/* Top left: the world. */}
      <div className="pointer-events-none absolute left-3 top-3 w-64 rounded-xl border border-line bg-surface/95 px-3.5 py-2.5 text-sm shadow-card">
        <p className="label-caps text-muted">{isSetup ? 'Setup' : 'Saved run'}</p>
        <p className="truncate font-display text-xl uppercase leading-tight">{doc.name}</p>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted">Date</dt>
          <dd>
            {MONTHS[month]}, year {year} <span className="text-muted">· {SEASONS[Math.floor(((month + 10) % 12) / 3)]}</span>
          </dd>
          <dt className="text-muted">People</dt>
          <dd>{population}</dd>
          <dt className="text-muted">Settlements</dt>
          <dd>{settlementCount}</dd>
          <dt className="text-muted">Nations</dt>
          <dd>{nations.filter((n) => n.destroyedYear === undefined).length}</dd>
          <dt className="text-muted">Time</dt>
          <dd>{speed === 0 ? 'Paused' : `Running at ${speed}×`}</dd>
        </dl>
      </div>

      {/* Top left, under the world: the cultures on the culture map view. */}
      {mapView === 'cultures' && <CultureKey cultures={cultures} onOpen={(id) => setChosenCulture(id)} />}
      {mapView === 'nations' && <NationKey nations={nations} onOpen={(id) => setChosenNation(id)} />}

      {/* Top right: view. */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-line bg-surface/95 p-1 shadow-card">
        <span className="pl-1.5 pr-0.5 text-xs text-muted">Map</span>
        <Segmented
          size="xs"
          value={mapView}
          onChange={(v) => setMapView(v)}
          options={[
            { value: 'nations', label: 'Nations', title: 'Each settlement’s land in its nation’s color' },
            { value: 'cultures', label: 'Cultures', title: 'Each settlement’s land in its culture’s color' },
            { value: 'plain', label: 'Plain', title: 'Settlements’ land in plain red' },
          ]}
        />
        <span className="mx-0.5 h-5 w-px bg-line" />
        <IconButton label="Zoom out (-)" onClick={() => viewRef.current && viewRef.current.zoomAt(viewRef.current.width / 2, viewRef.current.height / 2, 0.8)}>
          <Minus className="size-4" />
        </IconButton>
        <IconButton label="Zoom in (+)" onClick={() => viewRef.current && viewRef.current.zoomAt(viewRef.current.width / 2, viewRef.current.height / 2, 1.25)}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Show the whole map" onClick={() => viewRef.current?.fit()}>
          <Maximize className="size-4" />
        </IconButton>
      </div>

      {/* Right: a culture, the inspected person, or how many are chosen. */}
      {chosenCulture !== null && (
        <CulturePanel
          culture={cultures.find((c) => c.id === chosenCulture)}
          cultures={cultures}
          onOpen={(id) => setChosenCulture(id)}
          onClose={() => setChosenCulture(null)}
          onEdit={(e) => {
            clientRef.current?.cultureEdit(chosenCulture, e);
            setWorldUnsaved(true);
          }}
        />
      )}
      {chosenNation !== null && (
        <NationPanel
          nation={nations.find((n) => n.id === chosenNation)}
          nations={nations}
          cultures={cultures}
          settlements={settlementsRef.current}
          onNation={(id) => setChosenNation(id)}
          onCulture={(id) => setChosenCulture(id)}
          onPerson={(id) => choose([id])}
          onSettlement={(id) => chooseSettlement(id)}
          onClose={() => setChosenNation(null)}
          onEdit={(e) => {
            clientRef.current?.nationEdit(chosenNation, e);
            setWorldUnsaved(true);
          }}
        />
      )}
      {chosenCulture === null && chosenNation === null && inspected !== null && (
        <InspectPanel
          details={details}
          died={died}
          cultures={cultures}
          nations={nations}
          onCulture={(id) => setChosenCulture(id)}
          onNation={(id) => setChosenNation(id)}
          onSelect={(id) => choose([id])}
          onUnpair={() => {
            clientRef.current?.unpair(inspected);
            setWorldUnsaved(true);
          }}
          onClose={() => choose([])}
          onEdit={(edit) => {
            clientRef.current?.edit(inspected, edit);
            setWorldUnsaved(true);
          }}
          onMakeRuler={(nationId) => {
            clientRef.current?.nationEdit(nationId, { ruler: inspected });
            setWorldUnsaved(true);
          }}
          onRemove={() => {
            clientRef.current?.removePerson(inspected);
            setWorldUnsaved(true);
            choose([]);
          }}
        />
      )}
      {chosenCulture === null && chosenNation === null && chosenSettlement === null && chosenBuilding !== null && selection.length === 0 && (
        <BuildingPanel
          details={buildingDetails}
          onSettlement={(id) => {
            chooseBuilding(null);
            chooseSettlement(id);
          }}
          onPerson={(id) => {
            chooseBuilding(null);
            choose([id]);
          }}
          onClose={() => chooseBuilding(null)}
        />
      )}
      {chosenCulture === null && chosenNation === null && chosenSettlement === null && chosenBuilding === null && chosenCreature !== null && selection.length === 0 && (
        <CreaturePanel details={creatureDetails} onClose={() => chooseCreature(null)} />
      )}
      {recordOpen && tab === 'main' && (
        <RecordPanel
          entries={record}
          onGo={(tile) => {
            const v = viewRef.current;
            if (!v) return;
            const x = tile % doc.size;
            const y = Math.floor(tile / doc.size);
            v.cam.x = (x - y) * 0.5;
            v.cam.y = (x + y) * 0.25;
            v.cam.zoom = Math.max(v.cam.zoom, 24);
            v.redraw();
          }}
          onClose={() => setRecordOpen(false)}
        />
      )}
      {chosenCulture === null && chosenNation === null && chosenSettlement !== null && selection.length === 0 && (
        <SettlementPanel
          details={settlementDetails}
          cultures={cultures}
          nations={nations}
          onCulture={(id) => setChosenCulture(id)}
          onNation={(id) => setChosenNation(id)}
          onClose={() => chooseSettlement(null)}
          onOrder={(ps) => {
            setTab('imperatives');
            setTimeout(() => onSettlementOrderRef.current(ps), 0);
          }}
        />
      )}
      {chosenCulture === null && chosenNation === null && selection.length > 1 && (
        <div className="absolute right-3 top-16 flex w-64 items-center justify-between rounded-xl border border-line bg-surface/97 px-3.5 py-2.5 text-sm shadow-pop">
          <span>
            <span className="font-display text-lg uppercase">{selection.length}</span> people chosen
          </span>
          <Button size="xs" variant="ghost" onClick={() => choose([])}>
            Clear
          </Button>
        </div>
      )}

      {rulesOpen && tab === 'main' && (
        <RulesPanel
          toggles={toggles}
          onChange={(t) => {
            setTogglesState(t);
            clientRef.current?.setToggles(t);
            setWorldUnsaved(true);
          }}
          onClose={() => setRulesOpen(false)}
        />
      )}

      {/* Bottom: the toolbar. */}
      <div className="absolute inset-x-0 bottom-3 flex flex-col items-center px-3">
        <div className="max-w-full rounded-2xl border border-line bg-surface/97 shadow-pop">
          <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
            <TabButton active={tab === 'main'} onClick={() => setTab('main')}>
              Main
            </TabButton>
            <TabButton active={tab === 'units'} onClick={() => setTab('units')}>
              Units
            </TabButton>
            <TabButton active={tab === 'disasters'} onClick={() => setTab('disasters')}>
              Disasters &amp; effects
            </TabButton>
            <TabButton active={tab === 'imperatives'} onClick={() => setTab('imperatives')}>
              Imperatives
            </TabButton>
            <span className="ml-auto hidden pr-2 text-xs text-muted lg:block">
              {tab === 'main'
                ? 'Click a person to inspect · Space pauses · 1 2 3 set the speed'
                : tab === 'imperatives'
                  ? 'Click a person or drag a box to choose · right drag moves'
                  : tab === 'disasters'
                    ? 'Click to set it going · right drag moves · wheel zooms'
                    : 'Left drag places · right drag moves · wheel zooms'}
            </span>
          </div>

          {tab === 'main' && (
            <div className="flex flex-wrap items-center gap-3 p-2.5">
              <div className="flex items-center gap-1">
                <Button variant={speed === 0 ? 'primary' : 'navy'} size="sm" onClick={() => setSpeed(speed === 0 ? 1 : 0)} className="w-28">
                  {speed === 0 ? <Play className="size-4" /> : <Pause className="size-4" />}
                  {speed === 0 ? 'Play' : 'Pause'}
                </Button>
                {([1, 2, 3] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={cx('h-9 w-11 rounded-lg border font-mono text-sm transition', speed === s ? 'border-navy bg-navy text-on-accent' : 'border-line text-ink hover:bg-raised')}
                    title={`${s}× speed (${s})`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <span className="h-7 w-px bg-line" />
              {isSetup && atStart ? (
                <Button size="sm" onClick={onSaveSetup} loading={busy} disabled={!unsaved}>
                  <Save className="size-4" />
                  Save setup
                </Button>
              ) : (
                <Button size="sm" onClick={onSaveRun} loading={busy}>
                  <Save className="size-4" />
                  {isSetup ? 'Save run…' : 'Save run'}
                </Button>
              )}
              {setupAvailable && (
                <Button size="sm" variant="ghost" onClick={onRestart} disabled={isSetup && atStart && !unsaved}>
                  <RotateCcw className="size-4" />
                  Start again from setup
                </Button>
              )}
              <Button
                size="sm"
                variant={rulesOpen ? 'navy' : 'secondary'}
                onClick={() => {
                  setRulesOpen((o) => !o);
                  setRecordOpen(false);
                }}
              >
                <ListChecks className="size-4" />
                Rules
              </Button>
              <Button
                size="sm"
                variant={recordOpen ? 'navy' : 'secondary'}
                onClick={() => {
                  setRecordOpen((o) => !o);
                  setRulesOpen(false);
                }}
              >
                <History className="size-4" />
                Record
              </Button>
              <p className="max-w-64 text-xs text-muted">
                {isSetup && atStart
                  ? 'This is the setup’s starting point. Place people in Units, save the setup, then press Play to run it.'
                  : isSetup
                    ? 'Running. Save run keeps this moment as a saved run; the setup itself stays as it was.'
                    : 'A saved run. Save run updates it.'}
              </p>
            </div>
          )}

          {tab === 'units' && (
            <div className="flex max-w-[calc(100vw-2rem)] items-stretch gap-3 overflow-x-auto p-2 scrollbar-thin">
              <div className="flex gap-1">
                <ToolButton active={tool === 'person'} label="Person" onClick={() => setTool('person')}>
                  <User className="size-5" />
                </ToolButton>
                <ToolButton active={tool === 'nation'} label="Nation" onClick={() => setTool('nation')}>
                  <Crown className="size-5" />
                </ToolButton>
                <ToolButton active={tool === 'soldier'} label="Soldier" onClick={() => setTool('soldier')}>
                  <Sword className="size-5" />
                </ToolButton>
                <ToolButton active={tool === 'creature'} label="Animal" onClick={() => setTool('creature')}>
                  <PawPrint className="size-5" />
                </ToolButton>
                <ToolButton active={tool === 'criminal'} label="Criminal" onClick={() => setTool('criminal')}>
                  <VenetianMask className="size-5" />
                </ToolButton>
                {PLACE_KINDS.map((k) => {
                  const Icon = BUILDING_ICON[k];
                  return (
                    <ToolButton key={k} active={tool === k} label={BUILDINGS[k].name} onClick={() => setTool(k)}>
                      <Icon className="size-5" />
                    </ToolButton>
                  );
                })}
                <ToolButton active={tool === 'remove'} label="Remove" onClick={() => setTool('remove')}>
                  <Eraser className="size-5" />
                </ToolButton>
              </div>
              {tool === 'soldier' ? (
                <div className="flex shrink-0 flex-col justify-center gap-1 border-l border-line pl-3">
                  <span className="text-xs text-muted">Kind</span>
                  <Segmented size="xs" value={soldierKind} onChange={(v) => setSoldierKind(v as SoldierKind)} options={SOLDIER_KINDS.map((k) => ({ value: k.kind, label: k.label }))} />
                </div>
              ) : null}
              {tool === 'creature' ? (
                <div className="flex shrink-0 flex-col justify-center gap-1 border-l border-line pl-3">
                  <span className="text-xs text-muted">Kind</span>
                  <Segmented size="xs" value={creatureKind} onChange={(v) => setCreatureKind(v as CreatureKind)} options={CREATURE_TOOLS.map((k) => ({ value: k.kind, label: k.label }))} />
                </div>
              ) : null}
              {tool === 'remove' ? (
                <div className="flex w-44 shrink-0 flex-col justify-center gap-1 border-l border-line pl-3">
                  <span className="flex justify-between text-xs text-muted">
                    <span>Brush size</span>
                    <span className="font-mono">{radius}</span>
                  </span>
                  <input
                    type="range"
                    className="slider"
                    min={1}
                    max={8}
                    value={radius}
                    style={{ ['--fill' as string]: `${((radius - 1) / 7) * 100}%` }}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    aria-label="Brush size"
                  />
                </div>
              ) : null}
              <p className="w-56 shrink-0 self-center text-xs text-muted">
                {tool === 'person'
                  ? 'Click or drag on land to place adults, one per tile.'
                  : tool === 'soldier'
                    ? `Click or drag on a nation’s land to place soldiers of that nation, armed with ${SOLDIER_KINDS.find((k) => k.kind === soldierKind)!.note}. They serve in its army raised for placed soldiers.`
                  : tool === 'nation'
                    ? 'Click a settlement outside any nation: it becomes the capital of a new nation, and its most influential adult its ruler.'
                    : tool === 'creature'
                    ? CREATURE_TOOLS.find((k) => k.kind === creatureKind)!.note + (creatureKind === 'dragon' ? '' : ' Click or drag to place, one per tile.')
                    : tool === 'criminal'
                    ? 'Click or drag to place criminals, one per tile. They join the nearest bandit camp (three or more placed together set up one), live outside settlements, and raid them to steal or kill.'
                    : tool === BuildingKind.BanditCamp
                    ? 'A bandit camp with its band of four to seven bandits, outside any settlement’s land. They raid settlements near it.'
                    : tool === 'remove'
                    ? 'Removes everyone, every animal and every building inside the brush. Removing a campfire abandons its settlement.'
                    : tool === BuildingKind.Campfire
                      ? 'A campfire founds a camp; unsettled people nearby join it.'
                      : `${BUILDINGS[tool].name}: ${footprint(tool, rot).w} by ${footprint(tool, rot).d} tiles, R turns it. ${tool === BuildingKind.Farm ? 'Needs grassland or hills. ' : needsShore(tool) ? 'Must stand by water. ' : ''}Placed buildings appear finished and belong to the settlement whose land they are on, or the nearest within 15 tiles.`}
              </p>
            </div>
          )}

          {tab === 'disasters' && (
            <div className="flex max-w-[calc(100vw-2rem)] items-stretch gap-3 overflow-x-auto p-2 scrollbar-thin">
              <div className="flex shrink-0 flex-col justify-center gap-1 pr-1">
                <span className="label-caps text-muted">Disasters</span>
                <div className="flex gap-1">
                  {DISASTER_TOOLS.map((d) => (
                    <ToolButton key={d.kind} active={hazard.type === 'disaster' && hazard.kind === d.kind} label={d.label} onClick={() => setHazard({ type: 'disaster', kind: d.kind })}>
                      {d.icon}
                    </ToolButton>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col justify-center gap-1 border-l border-line pl-3 pr-1">
                <span className="label-caps text-muted">Effects</span>
                <div className="flex gap-1">
                  {EFFECT_TOOLS.map((d) => (
                    <ToolButton key={d.kind} active={hazard.type === 'effect' && hazard.kind === d.kind} label={d.label} onClick={() => setHazard({ type: 'effect', kind: d.kind })}>
                      {d.icon}
                    </ToolButton>
                  ))}
                </div>
              </div>
              {hazard.type === 'effect' ? (
                <div className="flex w-40 shrink-0 flex-col justify-center gap-1 border-l border-line pl-3">
                  <span className="flex justify-between text-xs text-muted">
                    <span>Brush size</span>
                    <span className="font-mono">{radius}</span>
                  </span>
                  <input
                    type="range"
                    className="slider"
                    min={1}
                    max={8}
                    value={radius}
                    style={{ ['--fill' as string]: `${((radius - 1) / 7) * 100}%` }}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    aria-label="Brush size"
                  />
                </div>
              ) : null}
              <p className="w-64 shrink-0 self-center text-xs text-muted">
                {hazard.type === 'disaster' ? DISASTER_TOOLS.find((d) => d.kind === hazard.kind)!.note : EFFECT_TOOLS.find((d) => d.kind === hazard.kind)!.note}
                {hazard.type === 'disaster' && !toggles.events ? ' (Sim-triggered events are off in Rules; disasters you set going still happen.)' : ''}
              </p>
            </div>
          )}

          {tab === 'imperatives' && (
            <div className="flex max-w-[calc(100vw-2rem)] items-stretch gap-3 overflow-x-auto p-2 scrollbar-thin">
              <div className="flex flex-col justify-center gap-1 pr-1">
                <span className="label-caps text-muted">Units</span>
                <span className="text-[0.6875rem] text-muted">Click or box people</span>
              </div>
              <div className="flex gap-1">
                {(['move', 'gather', 'collect', 'rest', 'attack', 'stop'] as const).map((k) => (
                  <ToolButton key={k} active={pending?.kind === k} label={ORDER_LABEL[k]} onClick={() => onOrderButton(k)}>
                    {k === 'move' ? <Footprints className="size-5" /> : k === 'gather' ? <Apple className="size-5" /> : k === 'collect' ? <Pickaxe className="size-5" /> : k === 'rest' ? <Moon className="size-5" /> : k === 'attack' ? <Crosshair className="size-5" /> : <Hand className="size-5" />}
                  </ToolButton>
                ))}
                {pending?.kind === 'collect' && (
                  <div className="flex shrink-0 flex-col justify-center gap-1 pl-1">
                    <span className="text-xs text-muted">Resource</span>
                    <Segmented size="xs" value={collectGood} onChange={(v) => setCollectGood(v as Good)} options={COLLECT_GOODS.map((g) => ({ value: g, label: GOOD_NAME[g] }))} />
                  </div>
                )}
              </div>
              <div className="flex flex-col justify-center gap-1 border-l border-line pl-3 pr-1">
                <span className="label-caps text-muted">Settlements</span>
                <div className="flex gap-1">
                  <OrderMenu
                    active={pendingS?.kind === 'build'}
                    label="Build"
                    icon={<Hammer className="size-5" />}
                    options={BUILD_ORDER_KINDS.map((k) => ({ label: BUILDINGS[k].name, onPick: () => onSettlementOrder({ kind: 'build', stage: 'which', building: k }) }))}
                  />
                  <OrderMenu
                    active={pendingS?.kind === 'focus'}
                    label="Focus"
                    icon={<Flag className="size-5" />}
                    options={(['balanced', 'food', 'housing', 'goods'] as Focus[]).map((f) => ({ label: FOCUS_LABEL[f], onPick: () => onSettlementOrder({ kind: 'focus', stage: 'which', focus: f }) }))}
                  />
                  <ToolButton active={pendingS?.kind === 'settlers'} label="Settlers" onClick={() => onSettlementOrder({ kind: 'settlers', stage: 'which' })}>
                    <Users className="size-5" />
                  </ToolButton>
                  <ToolButton active={pendingS?.kind === 'breakCulture'} label="Break away" onClick={() => onSettlementOrder({ kind: 'breakCulture', stage: 'which' })}>
                    <Split className="size-5" />
                  </ToolButton>
                  <ToolButton active={pendingS?.kind === 'abandon'} label="Abandon" onClick={() => onSettlementOrder({ kind: 'abandon', stage: 'which' })}>
                    <LogOut className="size-5" />
                  </ToolButton>
                </div>
              </div>
              <div className="flex flex-col justify-center gap-1 border-l border-line pl-3 pr-1">
                <span className="label-caps text-muted">Cultures</span>
                <div className="flex gap-1">
                  <OrderMenu
                    active={pendingS?.kind === 'research'}
                    label="Research"
                    icon={<BookOpen className="size-5" />}
                    options={TECHS.map((t) => ({ label: t.name, onPick: () => onSettlementOrder({ kind: 'research', stage: 'which', tech: t.id }) }))}
                  />
                </div>
              </div>
              <div className="flex flex-col justify-center gap-1 border-l border-line pl-3 pr-1">
                <span className="label-caps text-muted">Nations</span>
                <div className="flex gap-1">
                  <ToolButton active={pendingS?.kind === 'expand'} label="Expand" onClick={() => onSettlementOrder({ kind: 'expand', stage: 'which' })}>
                    <MapPinPlus className="size-5" />
                  </ToolButton>
                </div>
              </div>
              <p className="w-64 shrink-0 self-center text-xs text-muted">
                {pendingS?.stage === 'which'
                  ? 'Now click a settlement (one of its buildings, or its land). Esc cancels.'
                  : pendingS?.stage === 'where'
                    ? pendingS.kind === 'build'
                      ? `Click where to build the ${BUILDINGS[pendingS.building ?? 1].name.toLowerCase()}, on or beside its land. R turns it. Esc cancels.`
                      : 'Click where the settlers should found their settlement. Esc cancels.'
                    : pending?.stage === 'who'
                  ? `${ORDER_LABEL[pending.kind]}: now click a person or drag a box around people. Esc cancels.`
                  : pending?.stage === 'where'
                    ? `${ORDER_LABEL[pending.kind]}: now click ${pending.kind === 'move' ? 'where to go' : pending.kind === 'attack' ? 'where to go; on the way they fight any enemy of their nation at war' : pending.kind === 'collect' ? `where to gather ${GOOD_NAME[collectGood].toLowerCase()}; they bring a load to their settlement's store` : 'where to look for food'}. Esc cancels.`
                    : selection.length
                      ? `${selection.length === 1 ? '1 person' : `${selection.length} people`} chosen. Pick an order.`
                      : 'Choose people first (click one, or drag a box), or pick an order first and then choose.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, disabled, title, onClick, children }: { active: boolean; disabled?: boolean; title?: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        '-mb-px rounded-t-lg border border-b-0 px-3.5 py-1.5 font-display text-[0.9375rem] uppercase tracking-[0.06em] transition disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-line bg-surface text-ink' : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function ToolButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={cx(
        'flex w-[4.6rem] shrink-0 flex-col items-center gap-1 rounded-xl border px-1 py-1.5 text-[0.6875rem] leading-tight transition',
        active ? 'border-accent bg-accent/10 text-ink' : 'border-transparent text-muted hover:bg-raised hover:text-ink',
      )}
    >
      <span className="flex size-10 items-center justify-center">{children}</span>
      <span className="w-full truncate text-center">{label}</span>
    </button>
  );
}

const TASK_TEXT: Record<string, string> = {
  idle: 'Standing',
  sleep: 'Sleeping',
  gather: 'Gathering food',
  eat: 'Eating',
  chop: 'Cutting down a tree',
  farm: 'Tending the field',
  harvest: 'Harvesting',
  mine: 'Mining ore',
  fish: 'Fishing',
  dig: 'Digging clay',
  craft: 'Working at the workshop',
  study: 'Studying',
  trade: 'Trading',
  quarry: 'Breaking stone',
  build: 'Building',
  fight: 'Fighting',
  drill: 'Drilling by the barracks',
  collect: 'Gathering resources (by order)',
};

const WALK_TEXT: Record<string, string> = {
  food: 'Going to gather food',
  order: 'Following an order',
  home: 'Going home to sleep',
  wood: 'Going to cut wood',
  stone: 'Going for stone',
  site: 'Going to a building site',
  settle: 'Going to found a settlement',
  trade: 'Taking goods to sell',
  tradeHome: 'Bringing goods home',
  fence: 'Putting up the fence',
  job: 'Going to work',
  deliver: 'Taking goods to the store',
  fetch: 'Fetching materials from the store',
  store: 'Going to the store for food',
  muster: 'Marching with their army',
  chase: 'Going after an enemy',
  tax: 'Going to collect taxes',
  taxHome: 'Bringing taxes to the hall',
  pave: 'Going to pave',
  bridge: 'Going to build a bridge',
  collect: 'Going to gather resources (by order)',
};

function doingText(d: PersonDetails) {
  if (d.task === 'walk' && d.purpose === 'trade' && d.tradingWith) return `Taking goods to sell in ${d.tradingWith}`;
  if (d.task === 'walk') return (d.purpose && WALK_TEXT[d.purpose]) || 'Walking';
  if (d.task === 'sleep') return d.hasHome ? 'Sleeping' : 'Sleeping out in the open';
  return TASK_TEXT[d.task] ?? d.task;
}

function Bar({ value, warn }: { value: number; warn: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <span className={cx('block h-full rounded-full', warn ? 'bg-accent' : 'bg-navy')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="w-7 text-right font-mono text-xs">{value}</span>
    </span>
  );
}

function PersonLink({ id, onSelect }: { id: number; onSelect: (id: number) => void }) {
  return (
    <button className="text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onSelect(id)}>
      No. {id}
    </button>
  );
}

function InspectPanel({
  details,
  died,
  cultures,
  nations,
  onCulture,
  onNation,
  onSelect,
  onUnpair,
  onClose,
  onEdit,
  onMakeRuler,
  onRemove,
}: {
  details: PersonDetails | null;
  died: string | null;
  cultures: CultureView[];
  nations: NationView[];
  onCulture: (id: number) => void;
  onNation: (id: number) => void;
  onSelect: (id: number) => void;
  onUnpair: () => void;
  onClose: () => void;
  onEdit: (e: PersonEdit) => void;
  onMakeRuler: (nationId: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const d = details;
  const needs: string[] = [];
  if (d) {
    if (d.food < 45) needs.push(d.food === 0 ? 'Starving' : 'Hungry');
    if (d.rest < 25) needs.push('Tired');
    if (!d.hasHome) needs.push('Shelter');
    if (d.jobNeed === 'unmet') needs.push('Job');
    if (d.danger) needs.push('Safety');
    if (d.status.includes('Sick') || d.status.includes('Cold')) needs.push('Health');
  }
  return (
    <div className="absolute right-3 top-16 max-h-[calc(100%-14.5rem)] w-72 overflow-y-auto rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop scrollbar-thin">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {d && (
            <span className="relative block size-9 shrink-0 overflow-hidden rounded-full border-2 border-navy" style={{ background: CLOTHES[unpackLook(d.look).clothes] }}>
              <span className="absolute left-1/2 top-1 block size-4 -translate-x-1/2 rounded-full border-2 border-navy" style={{ background: SKINS[unpackLook(d.look).skin] }} />
            </span>
          )}
          <div>
            <p className="label-caps text-muted">{d?.name ? `Unique person · No. ${d.id}` : 'Person'}</p>
            <p className="font-display text-lg uppercase leading-tight">{d ? (d.name ?? `No. ${d.id}`) : died ? 'Died' : 'Gone'}</p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {d ? (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <dt className="text-muted">Sex</dt>
            <dd>{d.sex === 1 ? 'Male' : 'Female'}</dd>
            <dt className="text-muted">Age</dt>
            <dd>
              {d.ageYears} <span className="text-muted">({d.ageYears < ADULT_AGE ? 'child' : d.ageYears >= ELDER_AGE ? 'elder' : 'adult'})</span>
            </dd>
            <dt className="text-muted">Health</dt>
            <dd>
              <Bar value={d.health} warn={d.health < 40} />
            </dd>
            <dt className="text-muted">Job</dt>
            <dd>
              {d.job ? (
                <>
                  {d.job.light ? (LIGHT_JOB_NAME[d.job.kind] ?? JOB_NAME[d.job.kind]) : d.job.kind === 'trader' || d.job.kind === 'official' || d.job.kind === 'scholar' ? JOB_NAME[d.job.kind] : `Tradesman: ${JOB_NAME[d.job.kind].toLowerCase()}`}
                  <span className="text-muted"> ({d.job.at})</span>
                </>
              ) : (
                <span className={d.jobNeed === 'unmet' ? 'text-warn' : 'text-muted'}>
                  {d.jobNeed === 'unmet' ? 'None (no work free)' : !d.settlement ? 'None' : d.ageYears < 14 ? 'None (child)' : 'None (camps have no formal jobs)'}
                </span>
              )}
            </dd>
            {d.office && (
              <>
                <dt className="text-muted">Office</dt>
                <dd>{d.office}</dd>
              </>
            )}
            {d.soldier && (
              <>
                <dt className="text-muted">Soldier</dt>
                <dd>
                  {SOLDIER_NAME[d.soldier.kind]}
                  {d.soldier.leads ? ', leader' : ''} of the {d.soldier.army ?? 'army'}
                </dd>
                <dt className="text-muted">Arms</dt>
                <dd>
                  {[d.soldier.weapon ? GOOD_NAME[d.soldier.weapon].replace(/s$/, '') : 'No weapon', d.soldier.armor ? GOOD_NAME[d.soldier.armor] : null, d.soldier.horse ? 'horse' : null, d.soldier.engine ? 'catapult' : null]
                    .filter(Boolean)
                    .join(', ')}
                  {d.soldier.kills > 0 && <span className="text-muted"> · {d.soldier.kills} foe{d.soldier.kills === 1 ? '' : 's'} struck down</span>}
                </dd>
              </>
            )}
            <dt className="text-muted">Culture</dt>
            <dd>
              <CultureLink culture={cultures.find((c) => c.id === d.culture)} onOpen={onCulture} />
            </dd>
            <dt className="text-muted">Nation</dt>
            <dd>
              <NationLink nation={nations.find((n) => n.id === d.nation)} onOpen={onNation} />
            </dd>
            <dt className="text-muted">Influence</dt>
            <dd>
              {d.influence}
              {d.unique && <span className="text-muted"> · unique since year {d.unique.sinceYear} ({UNIQUE_WHY[d.unique.why]})</span>}
            </dd>
            <dt className="text-muted">Pair</dt>
            <dd>{d.pair !== undefined ? <PersonLink id={d.pair} onSelect={onSelect} /> : <span className="text-muted">None</span>}</dd>
            {(d.mother !== undefined || d.father !== undefined) && (
              <>
                <dt className="text-muted">Parents</dt>
                <dd className="flex flex-wrap gap-x-1.5">
                  {d.mother !== undefined && <PersonLink id={d.mother} onSelect={onSelect} />}
                  {d.mother !== undefined && d.father !== undefined && <span>and</span>}
                  {d.father !== undefined && <PersonLink id={d.father} onSelect={onSelect} />}
                </dd>
              </>
            )}
            <dt className="text-muted">Children</dt>
            <dd className="flex flex-wrap gap-x-1.5">
              {d.children.length ? d.children.slice(0, 6).map((c) => <PersonLink key={c} id={c} onSelect={onSelect} />) : <span className="text-muted">None</span>}
              {d.children.length > 6 && <span className="text-muted">and {d.children.length - 6} more</span>}
            </dd>
            {d.pregnant && (
              <>
                <dt className="text-muted">Expecting</dt>
                <dd>A child</dd>
              </>
            )}
          </dl>
          <p className="label-caps mt-3 text-muted">Needs</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <dt className="text-muted">Food</dt>
            <dd>
              <Bar value={d.food} warn={d.food < 45} />
            </dd>
            <dt className="text-muted">Rest</dt>
            <dd>
              <Bar value={d.rest} warn={d.rest < 25} />
            </dd>
            <dt className="text-muted">Shelter</dt>
            <dd className="text-xs">{d.hasHome ? 'Has a home' : <span className="text-warn">No home</span>}</dd>
            <dt className="text-muted">Safety</dt>
            <dd className="text-xs">{d.danger ? <span className="text-warn">In danger (enemies near)</span> : 'Safe'}</dd>
            {d.status.length > 0 && (
              <>
                <dt className="text-muted">Status</dt>
                <dd className="text-xs text-warn">{d.status.join(', ')}</dd>
              </>
            )}
            {d.criminal && (
              <>
                <dt className="text-muted">Criminal</dt>
                <dd className="text-xs">{d.criminal.raiding ? <span className="text-warn">On a raid</span> : d.criminal.band ? 'Lives at a bandit camp' : 'Lives in the wilds'}</dd>
              </>
            )}
          </dl>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Doing</dt>
            <dd>{doingText(d)}</dd>
            <dt className="text-muted">Unmet needs</dt>
            <dd>{needs.length ? needs.join(', ') : 'None'}</dd>
            <dt className="text-muted">Coins</dt>
            <dd>
              {d.coins}
              {d.goods > 0 && (
                <span className="text-muted">
                  {' '}
                  + {d.goods} pottery (wealth {d.wealth})
                </span>
              )}
            </dd>
            <dt className="text-muted">Lives in</dt>
            <dd>{d.settlement ?? <span className="text-muted">No settlement</span>}</dd>
            <dt className="text-muted">Carrying</dt>
            <dd>{[d.carry ? `${d.carry} food` : '', d.load ? `${d.load.n} ${d.load.kind}` : ''].filter(Boolean).join(', ') || 'Nothing'}</dd>
            <dt className="text-muted">Order</dt>
            <dd>{d.order ? ORDER_LABEL[d.order] : 'None'}</dd>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button size="xs" variant={editing ? 'navy' : 'secondary'} onClick={() => setEditing((e) => !e)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
            <Button size="xs" variant="danger" onClick={onRemove}>
              Remove
            </Button>
          </div>
          {editing && <EditPerson details={d} cultures={cultures} onEdit={onEdit} onUnpair={onUnpair} onMakeRuler={d.nation !== undefined && !d.office && d.ageYears >= ADULT_AGE ? () => onMakeRuler(d.nation!) : undefined} />}
        </>
      ) : (
        <p className="mt-3 text-muted">{died ? deathText(died) : 'This person is no longer in the world.'}</p>
      )}
    </div>
  );
}

/** Editing a person by hand (SPEC 1: everything can be modified). */
function EditPerson({
  details,
  cultures,
  onEdit,
  onUnpair,
  onMakeRuler,
}: {
  details: PersonDetails;
  cultures: CultureView[];
  onEdit: (e: PersonEdit) => void;
  onUnpair: () => void;
  onMakeRuler?: () => void;
}) {
  const [age, setAge] = useState(String(details.ageYears));
  const slider = (label: string, key: 'health' | 'food' | 'rest', value: number) => (
    <label className="block space-y-1">
      <span className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </span>
      <input
        type="range"
        className="slider"
        min={key === 'health' ? 1 : 0}
        max={100}
        value={value}
        style={{ ['--fill' as string]: `${value}%` }}
        onChange={(e) => onEdit({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-raised/50 p-2.5">
      {slider('Health', 'health', details.health)}
      {slider('Food', 'food', details.food)}
      {slider('Rest', 'rest', details.rest)}
      <div className="flex items-center gap-2">
        <span className="w-10 text-xs text-muted">Sex</span>
        <Segmented
          size="xs"
          value={details.sex === 1 ? 'm' : 'f'}
          onChange={(v) => onEdit({ sex: v === 'm' ? 1 : 0 })}
          options={[
            { value: 'f', label: 'Female' },
            { value: 'm', label: 'Male' },
          ]}
        />
      </div>
      <label className="flex items-center gap-2">
        <span className="w-10 text-xs text-muted">Age</span>
        <Input
          className="h-8 w-20 text-sm"
          inputMode="numeric"
          value={age}
          onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
          onBlur={() => age && onEdit({ ageYears: Number(age) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && age) onEdit({ ageYears: Number(age) });
          }}
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {details.pair !== undefined && (
          <Button size="xs" variant="secondary" onClick={onUnpair}>
            End pair
          </Button>
        )}
        {details.job && (
          <Button size="xs" variant="secondary" onClick={() => onEdit({ leaveJob: true })}>
            Leave job
          </Button>
        )}
        {onMakeRuler && (
          <Button size="xs" variant="secondary" onClick={onMakeRuler}>
            <Crown className="size-3.5" />
            Make ruler
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 text-xs text-muted">Name</span>
        <Input
          className="h-8 min-w-0 flex-1 text-sm"
          maxLength={40}
          placeholder="Name to make unique"
          defaultValue={details.name ?? ''}
          key={`name-${details.id}`}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== details.name && onEdit({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) onEdit({ name: (e.target as HTMLInputElement).value });
          }}
        />
        {details.name && !details.office && (
          <Button size="xs" variant="ghost" onClick={() => onEdit({ name: null })}>
            Not unique
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2">
        <span className="w-10 text-xs text-muted">Culture</span>
        <select
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm"
          value={details.culture ?? ''}
          onChange={(e) => onEdit({ culture: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">None</option>
          {cultures
            .filter((c) => c.extinctYear === undefined || c.id === details.culture)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-10 text-xs text-muted">Coins</span>
        <Input
          className="h-8 w-24 text-sm"
          inputMode="numeric"
          defaultValue={String(details.coins)}
          key={details.id}
          onBlur={(e) => onEdit({ coins: Number(e.target.value.replace(/\D/g, '')) || 0 })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEdit({ coins: Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || 0 });
          }}
        />
      </label>
    </div>
  );
}

/** The automatic behaviors the player can turn off (SPEC 10). More are added as their systems are built. */
function RulesPanel({ toggles, onChange, onClose }: { toggles: Toggles; onChange: (t: Toggles) => void; onClose: () => void }) {
  const rows: { key: keyof Toggles; label: string; note: string }[] = [
    { key: 'lifeCycle', label: 'Pairing, births and aging', note: 'Off freezes the population: nobody pairs up, is born, ages, or dies of old age.' },
    { key: 'founding', label: 'Settlement founding by units', note: 'Off: people no longer found settlements by themselves, and grown settlements no longer send people out to found new ones. People still join settlements, and you can still place campfires and send settlers.' },
    { key: 'nations', label: 'Nations emerging from settlements', note: 'Off: no leader claims rule, so no new nation forms by itself (a settlement that revolts stands on its own). You can still place nations.' },
    { key: 'policyChanges', label: 'Nation policy changes during major events', note: 'Off: nations keep their policies through changes of ruler, revolts and falls. You can still change them.' },
    { key: 'diplomacy', label: 'Diplomatic relation changes', note: 'Off: nations stay as they stand with each other. You can still change relations in a nation’s panel.' },
    { key: 'uniques', label: 'Emergence of unique individuals', note: 'Off: people no longer become unique by their influence. Rulers are still unique, and you can still name anyone.' },
    { key: 'research', label: 'Culture research and nation tech derivation', note: 'Off: cultures stop researching and nations stop taking up technology from their cultures. What they know stays, and you can still set it in a culture’s panel.' },
    { key: 'war', label: 'Nations raising armies; units declaring war', note: 'Off: nations build no new barracks and declare no wars by themselves. Armies already raised stay, wars already begun go on until peace, and you can still declare war and make peace in a nation’s panel.' },
    { key: 'events', label: 'Sim-triggered events (wars and natural disasters)', note: 'Off: no disaster strikes by itself (fires, floods, earthquakes, plague, locusts, droughts, lightning, dragons) and no nation declares war by itself, and no new bandit band appears. Weather still comes and goes, and you can still set disasters going.' },
    { key: 'criminals', label: 'Criminals entering settlements', note: 'Off: nobody turns to crime and bands raid no settlements. Criminals who are already about stay outside settlements, and you can still place them.' },
    { key: 'record', label: 'Writing the record of events', note: 'Off: nothing new is written in the record. What is written stays.' },
    { key: 'cultures', label: 'Culture formation', note: 'Off: no new cultures form, and none break away by themselves. Cultures that exist stay; newcomers still take up the culture they live among, and you can still order a settlement to break away.' },
  ];
  return (
    <div className="absolute bottom-36 left-1/2 flex max-h-[calc(100%-10.5rem)] w-[46rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 animate-rise flex-col rounded-2xl border border-line bg-surface p-4 text-sm shadow-pop">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <h2 className="text-xl">Rules</h2>
          <p className="mt-0.5 text-xs text-muted">Automatic behaviors you can turn off. More appear as their systems are built.</p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <ul className="-mr-2 mt-3 grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-2 scrollbar-thin md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 rounded-lg border border-line bg-raised/40 p-2.5">
            <button
              role="switch"
              aria-checked={toggles[r.key]}
              aria-label={r.label}
              onClick={() => onChange({ ...toggles, [r.key]: !toggles[r.key] })}
              className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', toggles[r.key] ? 'bg-navy' : 'bg-line')}
            >
              <span className={cx('absolute top-0.5 size-4 rounded-full bg-surface shadow-card transition-all', toggles[r.key] ? 'left-[1.125rem]' : 'left-0.5')} />
            </button>
            <span>
              <span className="block font-medium">{r.label}</span>
              <span className="block text-xs text-muted">{r.note}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 shrink-0 text-xs text-muted">
        Always on (SPEC 10): people meeting their needs and doing their tasks, including dying of unmet needs or injury; fights settled by stats and equipment; succession when a leader dies or
        leaves.
      </p>
    </div>
  );
}

/** An order button with a small menu of choices (building kind, focus). */
function OrderMenu({ active, label, icon, options }: { active: boolean; label: string; icon: ReactNode; options: { label: string; onPick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <ToolButton active={active || open} label={label} onClick={() => setOpen((o) => !o)}>
        {icon}
      </ToolButton>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-40 rounded-xl border border-line bg-surface p-1 shadow-pop">
          {options.map((o) => (
            <button
              key={o.label}
              className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised"
              onClick={() => {
                setOpen(false);
                o.onPick();
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A color written as #rrggbb, made see-through. */
function withAlpha(hex: string, a: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

function Swatch({ color }: { color: number }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full border border-navy" style={{ background: CULTURE_COLORS[color] }} />;
}

/** A culture's name with its color, opening its panel. */
function CultureLink({ culture, onOpen }: { culture?: CultureView; onOpen: (id: number) => void }) {
  if (!culture) return <span className="text-muted">None</span>;
  return (
    <button className="inline-flex items-center gap-1.5 text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onOpen(culture.id)}>
      <Swatch color={culture.color} />
      {culture.name}
    </button>
  );
}

/** The key to the culture map view: each living culture, its color and its people. */
function CultureKey({ cultures, onOpen }: { cultures: CultureView[]; onOpen: (id: number) => void }) {
  const alive = cultures.filter((c) => c.extinctYear === undefined && c.members > 0).sort((a, b) => b.members - a.members);
  return (
    <div className="absolute left-3 top-[12.25rem] max-h-[calc(100%-26rem)] w-64 overflow-y-auto rounded-xl border border-line bg-surface/95 px-3.5 py-2.5 text-sm shadow-card scrollbar-thin">
      <p className="label-caps text-muted">Cultures</p>
      {alive.length ? (
        <ul className="mt-1 space-y-0.5">
          {alive.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <CultureLink culture={c} onOpen={onOpen} />
              <span className="text-xs text-muted">{c.members}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted">None yet. A culture forms where people have lived without one for a few years.</p>
      )}
    </div>
  );
}

/** A culture (SPEC 7): what it is, and editing it (cultures only emerge, but can be edited afterwards). */
function CulturePanel({
  culture,
  cultures,
  onOpen,
  onClose,
  onEdit,
}: {
  culture?: CultureView;
  cultures: CultureView[];
  onOpen: (id: number) => void;
  onClose: () => void;
  onEdit: (e: CultureEdit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const c = culture;
  const parent = c?.parent !== undefined ? cultures.find((x) => x.id === c.parent) : undefined;
  const children = c ? cultures.filter((x) => x.parent === c.id) : [];
  return (
    <div className="absolute right-3 top-16 max-h-[calc(100%-14.5rem)] w-72 overflow-y-auto rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop scrollbar-thin">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {c && <span className="block size-7 shrink-0 rounded-full border-2 border-navy" style={{ background: CULTURE_COLORS[c.color] }} />}
          <div>
            <p className="label-caps text-muted">{c?.extinctYear !== undefined ? 'Culture (extinct)' : 'Culture'}</p>
            <p className="font-display text-lg uppercase leading-tight">{c ? c.name : 'Gone'}</p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {c && (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Formed</dt>
            <dd>
              Year {c.foundedYear}
              {c.origin && <span className="text-muted"> in {c.origin}</span>}
            </dd>
            {parent && (
              <>
                <dt className="text-muted">Broke from</dt>
                <dd>
                  <CultureLink culture={parent} onOpen={onOpen} />
                </dd>
              </>
            )}
            {children.length > 0 && (
              <>
                <dt className="text-muted">Gave rise to</dt>
                <dd className="flex flex-wrap gap-x-2">
                  {children.map((x) => (
                    <CultureLink key={x.id} culture={x} onOpen={onOpen} />
                  ))}
                </dd>
              </>
            )}
            <dt className="text-muted">People</dt>
            <dd>{c.members}</dd>
            <dt className="text-muted">Settlements</dt>
            <dd>{c.settlements}</dd>
            {c.extinctYear !== undefined && (
              <>
                <dt className="text-muted">Extinct</dt>
                <dd>Year {c.extinctYear}</dd>
              </>
            )}
          </dl>
          <p className="label-caps mt-3 text-muted">Traits</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {TRAIT_AXES.map((a) => (
              <div key={a.key} className="contents">
                <dt className="text-muted">{a.label}</dt>
                <dd>{a.names[a.poles.indexOf(c.traits[a.key])]}</dd>
              </div>
            ))}
          </dl>
          {c.extinctYear === undefined && <ResearchSection culture={c} onEdit={onEdit} />}
          <div className="mt-3">
            <Button size="xs" variant={editing ? 'navy' : 'secondary'} onClick={() => setEditing((e) => !e)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          </div>
          {editing && (
            <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-raised/50 p-2.5">
              <label className="flex items-center gap-2">
                <span className="w-16 text-xs text-muted">Name</span>
                <Input
                  className="h-8 min-w-0 flex-1 text-sm"
                  maxLength={40}
                  defaultValue={c.name}
                  key={c.id}
                  onBlur={(e) => e.target.value.trim() && onEdit({ name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onEdit({ name: (e.target as HTMLInputElement).value });
                  }}
                />
              </label>
              <div className="flex items-start gap-2">
                <span className="w-16 pt-1 text-xs text-muted">Color</span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {CULTURE_COLORS.map((col, i) => (
                    <button
                      key={col}
                      title={`Color ${i + 1}`}
                      aria-pressed={c.color === i}
                      onClick={() => onEdit({ color: i })}
                      className={cx('size-5 rounded-full border-2', c.color === i ? 'border-navy ring-2 ring-accent' : 'border-navy/40')}
                      style={{ background: col }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted">Technologies it knows</span>
                <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {TECHS.map((t) => {
                    const known = c.techs.includes(t.id);
                    const can = t.needs.every((x) => c.techs.includes(x));
                    return (
                      <li key={t.id}>
                        <label className={cx('flex items-center gap-1.5 text-xs', !known && !can && 'text-muted')}>
                          <input
                            type="checkbox"
                            checked={known}
                            disabled={!known && !can}
                            onChange={(e) => onEdit({ techs: e.target.checked ? [...c.techs, t.id] : c.techs.filter((x) => x !== t.id) })}
                          />
                          {t.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-[0.6875rem] text-muted">Unticking one also takes away those that need it.</p>
              </div>
              {TRAIT_AXES.map((a) => (
                <div key={a.key} className="flex items-center gap-2">
                  <span className="w-16 text-xs text-muted">{a.label}</span>
                  <Segmented
                    size="xs"
                    value={c.traits[a.key] as string}
                    onChange={(v) => onEdit({ traits: { [a.key]: v } })}
                    options={a.poles.map((pole, k) => ({ value: pole, label: a.names[k] }))}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            {TRAIT_NOTE}
          </p>
        </>
      )}
    </div>
  );
}

/** What a culture is researching, how fast, what waits for goods, and what it knows; and choosing what is next (Caleb: the player can steer). */
function ResearchSection({ culture: c, onEdit }: { culture: CultureView; onEdit: (e: CultureEdit) => void }) {
  const known = new Set(c.techs);
  const next = TECHS.filter((t) => !known.has(t.id) && t.needs.every((x) => known.has(x)));
  const r = c.research;
  const rt = r ? TECH_BY_ID.get(r.tech) : undefined;
  return (
    <>
      <p className="label-caps mt-3 flex justify-between text-muted">
        <span>Research</span>
        <span>{c.researchRate} a year</span>
      </p>
      {rt && r ? (
        <div className="mt-1" title={rt.opens}>
          <div className="flex justify-between gap-2">
            <span>{rt.name}</span>
            <span className="text-xs text-muted">{r.waiting ? `waiting for ${r.waiting}` : `${r.progress} of ${r.cost}`}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-raised">
            <div className="h-full rounded-full bg-navy" style={{ width: `${Math.min(100, (r.progress / r.cost) * 100)}%` }} />
          </div>
          <p className="mt-0.5 text-[0.6875rem] text-muted">{rt.opens}</p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">{next.length ? 'Nothing chosen yet.' : 'It knows everything it can research now.'}</p>
      )}
      {c.awaiting.filter((a) => a.tech !== r?.tech).length > 0 && (
        <p className="mt-1 text-xs text-muted">
          Done, waiting for goods: {c.awaiting.filter((a) => a.tech !== r?.tech).map((a) => `${TECH_BY_ID.get(a.tech)?.name} (${a.needs})`).join(', ')}
        </p>
      )}
      {next.length > 0 && (
        <label className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted">Research</span>
          <select className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm" value={r?.tech ?? ''} onChange={(e) => e.target.value && onEdit({ research: e.target.value })}>
            {!r && <option value="">Choose…</option>}
            {next.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.cost})
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="mt-2 text-xs text-muted">
        Knows {c.techs.length} of {TECHS.length}
        {c.techs.length > 0 && `: ${c.techs.map((t) => TECH_BY_ID.get(t)?.name).join(' · ')}`}
      </p>
    </>
  );
}

const TRAIT_NOTE = 'Mercantile cultures build markets sooner; agrarian ones keep more fields. Progressive cultures break away more readily when far from home than traditional ones. Traits also shape what a culture researches, and nations’ policies; temper matters more once wars exist.';

const UNIQUE_WHY: Record<string, string> = { ruler: 'a ruler', founder: 'a founder', chosen: 'named by you', influence: 'by their influence', revolt: 'led a revolt', leader: 'leads an army', dragon: 'slew a dragon' };

/** How a person died, as a sentence. */
function deathText(cause: string): string {
  if (cause === 'battle') return 'This person fell in battle.';
  if (cause === 'bandits') return 'This person was killed by bandits.';
  if (cause.startsWith('a ') || cause.startsWith('the ')) return `This person was killed by ${cause}.`;
  if (cause === 'fire') return 'This person died in a fire.';
  if (cause === 'earthquake') return 'This person died in an earthquake.';
  return `This person died of ${cause}.`;
}
const SOLDIER_NAME: Record<SoldierKind, string> = { infantry: 'Infantry', archer: 'Archer', cavalry: 'Cavalry', artillery: 'Artillery' };

/** A nation's name with its color, opening its panel. */
function NationLink({ nation, onOpen }: { nation?: NationView; onOpen: (id: number) => void }) {
  if (!nation) return <span className="text-muted">None</span>;
  return (
    <button className="inline-flex items-center gap-1.5 text-left text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onOpen(nation.id)}>
      <span className="inline-block size-2.5 shrink-0 rounded-sm border border-navy" style={{ background: NATION_COLORS[nation.color] }} />
      {nation.name}
    </button>
  );
}

/** The key to the nation map view: each nation, its color and its people. */
function NationKey({ nations, onOpen }: { nations: NationView[]; onOpen: (id: number) => void }) {
  const alive = nations.filter((n) => n.destroyedYear === undefined).sort((a, b) => b.people - a.people);
  return (
    <div className="absolute left-3 top-[13.75rem] max-h-[calc(100%-27.5rem)] w-64 overflow-y-auto rounded-xl border border-line bg-surface/95 px-3.5 py-2.5 text-sm shadow-card scrollbar-thin">
      <p className="label-caps text-muted">Nations</p>
      {alive.length ? (
        <ul className="mt-1 space-y-0.5">
          {alive.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-2">
              <NationLink nation={n} onOpen={onOpen} />
              <span className="shrink-0 text-xs text-muted">{n.people}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted">None yet. A nation forms when someone of high influence in a village or bigger claims rule, or when you place one (Units, Nation).</p>
      )}
    </div>
  );
}

/** A nation (SPEC 7): its ruler, lands, treasury, cultures, policies and relations, and editing it. */
function NationPanel({
  nation,
  nations,
  cultures,
  settlements,
  onNation,
  onCulture,
  onPerson,
  onSettlement,
  onClose,
  onEdit,
}: {
  nation?: NationView;
  nations: NationView[];
  cultures: CultureView[];
  settlements: SettlementView[];
  onNation: (id: number) => void;
  onCulture: (id: number) => void;
  onPerson: (id: number) => void;
  onSettlement: (id: number) => void;
  onClose: () => void;
  onEdit: (e: NationEdit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const n = nation;
  const fallen = n?.destroyedYear !== undefined;
  const mine = n ? settlements.filter((x) => x.nation === n.id && !x.abandoned) : [];
  return (
    <div className="absolute right-3 top-16 max-h-[calc(100%-14.5rem)] w-80 overflow-y-auto rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop scrollbar-thin">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {n && <span className="block size-7 shrink-0 rounded-md border-2 border-navy" style={{ background: NATION_COLORS[n.color] }} />}
          <div>
            <p className="label-caps text-muted">{fallen ? 'Nation (fallen)' : 'Nation'}</p>
            <p className="font-display text-lg uppercase leading-tight">{n ? n.name : 'Gone'}</p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {n && (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Founded</dt>
            <dd>Year {n.foundedYear}</dd>
            {fallen ? (
              <>
                <dt className="text-muted">Fell</dt>
                <dd>Year {n.destroyedYear}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted">Ruler</dt>
                <dd>
                  {n.ruler ? (
                    <button className="text-left text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onPerson(n.ruler!.id)}>
                      {n.ruler.title} {n.ruler.name}
                    </button>
                  ) : (
                    <span className="text-muted">None (no grown-up in the nation)</span>
                  )}
                </dd>
                <dt className="text-muted">Capital</dt>
                <dd>
                  <button className="text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onSettlement(n.capital)}>
                    {n.capitalName}
                  </button>
                </dd>
                <dt className="text-muted">Lands</dt>
                <dd>
                  {n.settlements} settlement{n.settlements === 1 ? '' : 's'}, {n.people} people
                </dd>
                <dt className="text-muted">Treasury</dt>
                <dd>
                  {n.coins} coins <span className="text-muted">({n.officials} official{n.officials === 1 ? '' : 's'})</span>
                </dd>
                <dt className="text-muted">Soldiers</dt>
                <dd>
                  {n.soldiers} <span className="text-muted">({n.armies.length} arm{n.armies.length === 1 ? 'y' : 'ies'})</span>
                </dd>
                {n.unrest > 0 && (
                  <>
                    <dt className="text-muted">Unrest</dt>
                    <dd className="text-warn">
                      {n.unrest} settlement{n.unrest === 1 ? '' : 's'}
                    </dd>
                  </>
                )}
                <dt className="text-muted">Cultures</dt>
                <dd className="flex flex-col gap-0.5">
                  {n.cultures.length ? (
                    n.cultures.slice(0, 4).map((c, k) => (
                      <span key={c.id} className="flex items-center justify-between gap-2">
                        <CultureLink culture={cultures.find((x) => x.id === c.id)} onOpen={onCulture} />
                        <span className="text-xs text-muted">
                          {c.members}
                          {k === 0 ? ' · main' : ''}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-muted">None yet</span>
                  )}
                </dd>
              </>
            )}
          </dl>
          {!fallen && (
            <>
              <p className="label-caps mt-3 flex justify-between text-muted">
                <span>Policies</span>
                <span title="How much its main culture supports each policy now">support</span>
              </p>
              <dl className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
                {POLICY_DEFS.map((d) => (
                  <div key={d.key} className="contents" title={d.note}>
                    <dt className="text-muted">{d.label}</dt>
                    <dd>{d.names[d.choices.indexOf(n.policies[d.key])]}</dd>
                    <dd className={cx('text-right text-xs', n.support[d.key] < 45 ? 'text-warn' : 'text-muted')}>{n.support[d.key]}</dd>
                  </div>
                ))}
              </dl>
              <p className="label-caps mt-3 flex justify-between text-muted">
                <span>Technology</span>
                <span>
                  {n.techs.length} of {TECHS.length}
                </span>
              </p>
              <p className="mt-1 text-xs leading-relaxed">{n.techs.length ? n.techs.map((t) => TECH_BY_ID.get(t)?.name).join(' · ') : <span className="text-muted">None yet. A nation has all of its main culture’s technology, and some of its other cultures’.</span>}</p>
              {n.wars.length > 0 && (
                <>
                  <p className="label-caps mt-3 text-warn">At war</p>
                  <ul className="mt-1 space-y-1.5">
                    {n.wars.map((wr) => {
                      const o = nations.find((x) => x.id === wr.other);
                      if (!o) return null;
                      return (
                        <li key={wr.other}>
                          <span className="flex items-center justify-between gap-2">
                            <NationLink nation={o} onOpen={onNation} />
                            <span className="shrink-0 text-xs text-muted">
                              {wr.years ? `${wr.years} year${wr.years === 1 ? '' : 's'}` : 'this year'}, declared by {wr.declaredBy === n.id ? 'it' : 'them'}
                            </span>
                          </span>
                          <span className="block text-xs text-muted">
                            Fallen: {wr.lost} of theirs, {wr.enemyLost} of the enemy’s. Settlements taken: {wr.taken}, lost: {wr.enemyTaken}.
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {n.armies.length > 0 && (
                <>
                  <p className="label-caps mt-3 text-muted">Armies</p>
                  <ul className="mt-1 space-y-1.5">
                    {n.armies.map((a) => (
                      <li key={a.id}>
                        <span className="flex items-center justify-between gap-2">
                          <span>{a.name}</span>
                          <span className="shrink-0 text-xs text-muted">{a.soldiers} soldiers</span>
                        </span>
                        <span className="block text-xs text-muted">
                          {a.leader ? (
                            <>
                              Led by{' '}
                              <button className="text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onPerson(a.leader!.id)}>
                                {a.leader.name}
                              </button>
                              .{' '}
                            </>
                          ) : (
                            'No leader yet. '
                          )}
                          {a.order}.
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {n.relations.length > 0 && (
                <>
                  <p className="label-caps mt-3 text-muted">Relations</p>
                  <ul className="mt-1 space-y-1">
                    {n.relations.map((r) => {
                      const o = nations.find((x) => x.id === r.other);
                      if (!o) return null;
                      return (
                        <li key={r.other} className="flex items-center justify-between gap-2">
                          <NationLink nation={o} onOpen={onNation} />
                          {editing ? (
                            <select
                              className="h-7 rounded-lg border border-line bg-surface px-1.5 text-xs"
                              value={r.kind}
                              onChange={(e) => onEdit({ relation: { other: r.other, kind: e.target.value as RelationKind } })}
                            >
                              {(['alliance', 'trade', 'peace', 'rivalry', 'war'] as const).map((k) => (
                                <option key={k} value={k}>
                                  {RELATION_NAME[k]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={cx('shrink-0 text-xs', r.kind === 'rivalry' || r.kind === 'war' ? 'text-warn' : 'text-muted')}>{RELATION_NAME[r.kind]}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              <div className="mt-3">
                <Button size="xs" variant={editing ? 'navy' : 'secondary'} onClick={() => setEditing((e) => !e)}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              </div>
              {editing && (
                <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-raised/50 p-2.5">
                  <label className="flex items-center gap-2">
                    <span className="w-20 text-xs text-muted">Name</span>
                    <Input
                      className="h-8 min-w-0 flex-1 text-sm"
                      maxLength={50}
                      defaultValue={n.name}
                      key={n.id}
                      onBlur={(e) => e.target.value.trim() && onEdit({ name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onEdit({ name: (e.target as HTMLInputElement).value });
                      }}
                    />
                  </label>
                  <div className="flex items-start gap-2">
                    <span className="w-20 pt-1 text-xs text-muted">Color</span>
                    <div className="flex flex-1 flex-wrap gap-1">
                      {NATION_COLORS.map((col, i) => (
                        <button
                          key={col}
                          title={`Color ${i + 1}`}
                          aria-pressed={n.color === i}
                          onClick={() => onEdit({ color: i })}
                          className={cx('size-5 rounded-md border-2', n.color === i ? 'border-navy ring-2 ring-accent' : 'border-navy/40')}
                          style={{ background: col }}
                        />
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="w-20 text-xs text-muted">Capital</span>
                    <select className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm" value={n.capital} onChange={(e) => onEdit({ capital: Number(e.target.value) })}>
                      {mine.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {POLICY_DEFS.map((d) => (
                    <div key={d.key} className="flex items-center gap-2" title={d.note}>
                      <span className="w-20 text-xs text-muted">{d.label}</span>
                      <Segmented
                        size="xs"
                        value={n.policies[d.key] as string}
                        onChange={(v) => onEdit({ policies: { [d.key]: v } })}
                        options={d.choices.map((c, k) => {
                          const need = POLICY_TECH[`${d.key}:${c}`];
                          const locked = need && !n.techs.includes(need);
                          return { value: c, label: locked ? `${d.names[k]} (needs ${TECH_BY_ID.get(need)!.name})` : d.names[k] };
                        })}
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted">To make someone else the ruler, inspect them and use Make ruler.</p>
                </div>
              )}
              <p className="mt-3 text-xs text-muted">Policies start as the main culture’s traits would have them; the longer one is in force, the more its people support it. During a change of ruler, a revolt or a fall, a policy its main culture supports less than the other may change.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** What each building is and does, for its info panel (Caleb after Stage 5). */
const BUILDING_INFO: Record<number, string> = {
  [BuildingKind.Campfire]: 'The heart of a settlement: where it was founded and what it grows around. Its store until a storehouse is built. Removing it abandons the settlement.',
  [BuildingKind.Hut]: 'A small home of wattle and thatch, for a family of a camp or village.',
  [BuildingKind.House]: 'A timber and plaster home for a family, built with stone once a village has some.',
  [BuildingKind.Storehouse]: 'The settlement\'s store: workers bring what they make here, builders and buyers take from it.',
  [BuildingKind.Farm]: 'A field. Farmers tend it from March to November until the wheat ripens, then harvest it and carry the sheaves to the store as food.',
  [BuildingKind.Woodcutter]: 'Woodcutters fell the trees nearby and carry the wood to the store.',
  [BuildingKind.Quarry]: 'Quarrymen break stone from the deposits nearby and carry it to the store.',
  [BuildingKind.Mine]: 'Miners dig iron ore or gold ore from the deposits nearby, whichever the settlement needs more, and carry it to the store.',
  [BuildingKind.FishingHut]: 'Fishers catch fish from the shore nearby and carry them to the store as food.',
  [BuildingKind.Market]: 'Traders load goods the settlement has plenty of, sell them where they pay most, and bring back what home lacks.',
  [BuildingKind.Smithy]: 'Blacksmiths turn iron ore from the store into tools, which make every kind of work quicker.',
  [BuildingKind.Pottery]: 'Potters dig clay and make pottery, which people buy for their homes.',
  [BuildingKind.Mint]: 'Minters strike coins for the settlement\'s treasury from gold ore.',
  [BuildingKind.Townhouse]: 'A tall stone and timber home with room for several families (towns and cities).',
  [BuildingKind.Hall]: 'Officials work here, collecting taxes from the nation\'s settlements for its treasury. Flies the nation\'s banner.',
  [BuildingKind.Scriptorium]: 'Scholars study here, adding to their culture\'s research.',
  [BuildingKind.University]: 'Scholars study here twice as fast as at a scriptorium (towns and cities).',
  [BuildingKind.Barracks]: 'Home of an army: soldiers serve here full time, drill, and march out at war. Flies the nation\'s banner.',
  [BuildingKind.Armory]: 'Armorers make spears, swords, bows, crossbows, mail, plate and catapults from iron ore and wood, whatever the soldiers here lack most.',
  [BuildingKind.Stable]: 'Grooms raise horses from food, for cavalry.',
  [BuildingKind.Dock]: 'A landing where people board boats to cross wide water: settlers, traders and armies going where there is no way on foot.',
  [BuildingKind.Castle]: 'The seat of the nation\'s ruler, built in its biggest city, which becomes the capital. An enemy takes the capital only by claiming the castle.',
  [BuildingKind.HuntingLodge]: 'Hunters hunt deer and wild boar nearby and carry the meat to the store as food.',
  [BuildingKind.Pasture]: 'A fenced field where herders keep the cattle and sheep they tame. The herd breeds, gives food for the store, and cattle pull the plough (fields ripen faster). Herders slaughter an animal when the store runs short.',
  [BuildingKind.BanditCamp]: 'Tents of a band of criminals, outside any settlement. They raid settlements near it to steal or kill.',
};

function BuildingPanel({ details, onSettlement, onPerson, onClose }: { details: BuildingDetails | null; onSettlement: (id: number) => void; onPerson: (id: number) => void; onClose: () => void }) {
  const d = details;
  const Icon = d ? BUILDING_ICON[d.kind] : null;
  return (
    <div className="absolute right-3 top-16 max-h-[calc(100%-14.5rem)] w-72 overflow-y-auto rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop scrollbar-thin">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border-2 border-navy bg-raised">
              <Icon className="size-5" />
            </span>
          )}
          <div>
            <p className="label-caps text-muted">Building</p>
            <p className="font-display text-lg uppercase leading-tight">{d ? BUILDINGS[d.kind].name : 'Gone'}</p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {d && (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted">{BUILDING_INFO[d.kind]}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Settlement</dt>
            <dd>
              {d.settlement !== undefined && d.settlementName ? (
                <button className="text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onSettlement(d.settlement!)}>
                  {d.settlementName}
                </button>
              ) : (
                <span className="text-muted">None</span>
              )}
            </dd>
            <dt className="text-muted">State</dt>
            <dd className={d.burning ? 'text-warn' : ''}>{d.burning ? 'Burning' : d.progress >= 1 ? 'Built' : `Being built, ${Math.floor(d.progress * 100)}%`}</dd>
            {d.materials && (
              <>
                <dt className="text-muted">Materials</dt>
                <dd>
                  Wood {d.materials.wood[0]}/{d.materials.wood[1]}, stone {d.materials.stone[0]}/{d.materials.stone[1]}
                  {d.materials.tools ? `, tools ${d.materials.tools[0]}/${d.materials.tools[1]}` : ''}
                  <span className="text-muted"> · {d.builders} builder{d.builders === 1 ? '' : 's'}</span>
                </dd>
              </>
            )}
            {d.jobs > 0 && (
              <>
                <dt className="text-muted">Workers</dt>
                <dd>
                  {d.workers} of {d.jobs}
                  {d.lightJobs > 0 && <span className="text-muted"> · children {d.lightWorkers} of {d.lightJobs}</span>}
                </dd>
              </>
            )}
            {d.homes > 0 && (
              <>
                <dt className="text-muted">Living here</dt>
                <dd>
                  {d.residents} of {d.homes}
                </dd>
              </>
            )}
            {d.ruler && (
              <>
                <dt className="text-muted">Ruler</dt>
                <dd>
                  <button className="text-left text-ink underline decoration-accent decoration-2 underline-offset-2 hover:text-accent" onClick={() => onPerson(d.ruler!.id)}>
                    {d.ruler.name}
                  </button>
                  {d.residents > 1 && <span className="text-muted"> and family ({d.residents - 1})</span>}
                </dd>
              </>
            )}
            {d.growth !== undefined && (
              <>
                <dt className="text-muted">Crop</dt>
                <dd>
                  <Bar value={Math.round(d.growth * 100)} warn={false} />
                </dd>
              </>
            )}
            {(d.output ?? 0) > 0 && (
              <>
                <dt className="text-muted">Waiting</dt>
                <dd>{d.output} food in sheaves, to carry in</dd>
              </>
            )}
            {d.doing.length > 0 && (
              <>
                <dt className="text-muted">Now</dt>
                <dd>{d.doing.map((x) => x.replace(/making (\w+)/, (_m, g: string) => `making ${(GOOD_NAME[g as Good] ?? g).toLowerCase()}`).replace(/carrying (\d+) (\w+)/, (_m, n: string, g: string) => `carrying ${n} ${(GOOD_NAME[g as Good] ?? g).toLowerCase()}`)).join('; ')}</dd>
              </>
            )}
          </dl>
        </>
      )}
    </div>
  );
}

function SettlementPanel({
  details,
  cultures,
  nations,
  onCulture,
  onNation,
  onClose,
  onOrder,
}: {
  details: SettlementDetails | null;
  cultures: CultureView[];
  nations: NationView[];
  onCulture: (id: number) => void;
  onNation: (id: number) => void;
  onClose: () => void;
  onOrder: (ps: NonNullable<PendingSettlement>) => void;
}) {
  const d = details;
  return (
    <div className="absolute right-3 top-16 flex max-h-[calc(100%-14.5rem)] w-72 flex-col rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <p className="label-caps text-muted">{d ? (d.abandoned ? 'Abandoned settlement' : STAGE_NAME[d.stage]) : 'Settlement'}</p>
          <p className="font-display text-lg uppercase leading-tight">{d ? d.name : '…'}</p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {d && (
        <>
          <div className="-mr-2 mt-3 min-h-0 flex-1 overflow-y-auto pr-2 scrollbar-thin">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">Founded</dt>
              <dd>
                Year {d.foundedYear}
                {d.from && <span className="text-muted">, by settlers from {d.from}</span>}
              </dd>
              <dt className="text-muted">People</dt>
              <dd>{d.people}</dd>
              <dt className="text-muted">Homes</dt>
              <dd>
                {d.housed} housed, room for {d.homes}
              </dd>
              <dt className="text-muted">Nation</dt>
              <dd>
                {d.nation !== undefined ? (
                  <>
                    <NationLink nation={nations.find((n) => n.id === d.nation)} onOpen={onNation} />
                    {nations.find((n) => n.id === d.nation)?.capital === d.id && <span className="text-muted"> (capital)</span>}
                  </>
                ) : (
                  <span className="text-muted">None (independent)</span>
                )}
              </dd>
              {d.underAttack && (
                <>
                  <dt className="text-muted">War</dt>
                  <dd className="text-warn">Under attack (enemy soldiers on its land)</dd>
                </>
              )}
              {d.garrison > 0 && (
                <>
                  <dt className="text-muted">Garrison</dt>
                  <dd>{d.garrison} soldiers</dd>
                </>
              )}
              {d.unrest > 0 && (
                <>
                  <dt className="text-muted">Unrest</dt>
                  <dd className={d.unrest >= 12 ? 'text-warn' : ''}>
                    {d.unrest} month{d.unrest > 1 ? 's' : ''}
                    <span className="text-muted"> (unhappy with the nation’s policies)</span>
                  </dd>
                </>
              )}
              <dt className="text-muted">Culture</dt>
              <dd>
                {d.culture !== undefined ? (
                  <>
                    <CultureLink culture={cultures.find((c) => c.id === d.culture)} onOpen={onCulture} />
                    {d.otherCultures > 0 && <span className="text-muted"> and {d.otherCultures} other{d.otherCultures > 1 ? 's' : ''}</span>}
                  </>
                ) : (
                  <span className="text-muted">None yet</span>
                )}
              </dd>
              <dt className="text-muted">Focus</dt>
              <dd>{FOCUS_LABEL[d.focus]}</dd>
              <dt className="text-muted">Jobs</dt>
              <dd>
                {d.stage === 'camp' ? (
                  <span className="text-muted">None yet (camps have no formal jobs)</span>
                ) : (
                  <>
                    {d.jobsFilled} of {d.jobsOffered} filled
                    {d.jobless > 0 && <span className="text-warn">, {d.jobless} without work</span>}
                    {d.lightJobs > 0 && <span className="text-muted">, {d.lightJobs} children helping</span>}
                  </>
                )}
              </dd>
            </dl>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">Treasury</dt>
              <dd>{d.coins} coins</dd>
              {d.paved + d.toPave > 0 && (
                <>
                  <dt className="text-muted">Pavement</dt>
                  <dd>
                    {d.paved} of {d.paved + d.toPave} tiles laid
                  </dd>
                </>
              )}
              {d.bridges + d.toBridge > 0 && (
                <>
                  <dt className="text-muted">Bridges</dt>
                  <dd>
                    {d.bridges} of {d.bridges + d.toBridge} tiles built
                  </dd>
                </>
              )}
              {(d.stage === 'town' || d.stage === 'city') && (
                <>
                  <dt className="text-muted">Fence</dt>
                  <dd>
                    {d.fenceBuilt} of {d.fenceBuilt + d.fencePlanned} stretches built
                  </dd>
                </>
              )}
            </dl>
            <p className="label-caps mt-3 flex justify-between text-muted">
              <span>Store</span>
              <span>price</span>
            </p>
            <ul className="mt-1 space-y-0.5">
              {/* Arms are listed when the store holds some (they are made for soldiers, not sold). */}
              {GOODS.filter((g) => !ARMS.includes(g) || d.stock[g] > 0).map((g) => (
                <li key={g} className="flex justify-between">
                  <span>{GOOD_NAME[g]}</span>
                  <span className={d.stock[g] ? '' : 'text-muted'}>
                    {d.stock[g]} {!ARMS.includes(g) && <span className="text-[0.6875rem] text-muted">· {d.prices[g]}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="label-caps mt-3 text-muted">Buildings</p>
            <ul className="mt-1 space-y-0.5">
              {d.buildings.map((b) => (
                <li key={b.kind} className="flex justify-between">
                  <span>{BUILDINGS[b.kind].name}</span>
                  <span className="text-muted">
                    {b.done}
                    {b.building ? ` (+${b.building} being built)` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {d.queue > 0 && <p className="mt-1 text-xs text-muted">{d.queue} ordered, not started yet</p>}
          </div>
          {!d.abandoned && (
            <div className="mt-3 flex shrink-0 flex-wrap gap-1.5">
              <Button size="xs" onClick={() => onOrder({ kind: 'build', stage: 'which', building: BuildingKind.Hut })}>
                Build…
              </Button>
              <Button size="xs" onClick={() => onOrder({ kind: 'settlers', stage: 'which' })}>
                Send settlers
              </Button>
              {d.culture !== undefined && (
                <Button size="xs" onClick={() => onOrder({ kind: 'breakCulture', stage: 'which' })}>
                  Break away
                </Button>
              )}
              <Button size="xs" variant="danger" onClick={() => onOrder({ kind: 'abandon', stage: 'which' })}>
                Abandon
              </Button>
            </div>
          )}
          <p className="mt-2 shrink-0 text-xs text-muted">More orders (focus, other buildings) are in the Imperatives tab.</p>
        </>
      )}
    </div>
  );
}

/** Settlement names over their campfires, like place names on a map. */
function drawLabels(ctx: CanvasRenderingContext2D, view: IsoView, list: readonly SettlementView[], chosen: number | null) {
  const { size, elevation } = view.src;
  ctx.font = '13px Norwester, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  for (const s of list) {
    if (s.abandoned) continue;
    const x = s.center % size;
    const y = (s.center - x) / size;
    const [sx, sy] = view.toScreen((x - y) * 0.5, (x + y) * 0.25 + 0.25 - elevation[s.center] * STEP);
    const ty = sy - Math.max(14, view.cam.zoom * 0.45);
    if (sx < -100 || sx > view.width + 100 || ty < -20 || ty > view.height + 20) continue;
    // The name, with the stage in small letters under it.
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(250, 238, 218, 0.95)';
    ctx.font = '13px Norwester, sans-serif';
    ctx.strokeText(s.name.toUpperCase(), sx, ty - 11);
    ctx.fillStyle = s.id === chosen ? '#fc3f3f' : '#002657';
    ctx.fillText(s.name.toUpperCase(), sx, ty - 11);
    ctx.font = '600 10px "Archivo Variable", sans-serif';
    const stage = `${STAGE_NAME[s.stage]}, ${s.people}`;
    ctx.strokeText(stage, sx, ty);
    ctx.fillText(stage, sx, ty);
  }
}

/** An animal's panel (Stage 6). */
function CreaturePanel({ details, onClose }: { details: CreatureDetails | null; onClose: () => void }) {
  const d = details;
  const def = d ? CREATURES[d.kind] : null;
  const name = d && def ? (d.tame === undefined && def.wildName ? def.wildName : def.name) : 'Gone';
  const note = d ? CREATURE_TOOLS.find((k) => k.kind === d.kind)?.note : undefined;
  return (
    <div className="absolute right-3 top-16 w-72 rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border-2 border-navy bg-raised">
            <PawPrint className="size-5" />
          </span>
          <div>
            <p className="label-caps text-muted">{d?.tame !== undefined ? 'Livestock' : 'Animal'}</p>
            <p className="font-display text-lg uppercase leading-tight">{name}</p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {d ? (
        <>
          {note && <p className="mt-2 text-xs leading-relaxed text-muted">{note}</p>}
          <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <dt className="text-muted">Health</dt>
            <dd>
              <Bar value={d.health} warn={d.health < 40} />
            </dd>
            <dt className="text-muted">Age</dt>
            <dd>{d.ageYears < 1 ? 'Young (under a year)' : `${d.ageYears} year${d.ageYears === 1 ? '' : 's'}`}</dd>
            {d.tame !== undefined && (
              <>
                <dt className="text-muted">Belongs to</dt>
                <dd>{d.tame}</dd>
              </>
            )}
            <dt className="text-muted">Doing</dt>
            <dd>{d.doing}</dd>
          </dl>
        </>
      ) : (
        <p className="mt-3 text-muted">This animal is no longer in the world.</p>
      )}
    </div>
  );
}

/** The record of events (SPEC 5), newest first, with a filter by kind; clicking an entry goes to where it happened. */
function RecordPanel({ entries, onGo, onClose }: { entries: RecordEntry[]; onGo: (tile: number) => void; onClose: () => void }) {
  const [shown, setShown] = useState<Set<RecordKind>>(() => new Set(RECORD_KINDS.map((k) => k.kind)));
  const list = entries.filter((e) => shown.has(e.kind)).slice(-400).reverse();
  const toggle = (k: RecordKind) =>
    setShown((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <div className="absolute bottom-36 left-1/2 flex max-h-[calc(100%-10.5rem)] w-[34rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 animate-rise flex-col rounded-2xl border border-line bg-surface p-4 text-sm shadow-pop">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <h2 className="text-xl">Record</h2>
          <p className="mt-0.5 text-xs text-muted">What has happened in this world, newest first. Click an entry to go there.</p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap gap-1">
        {RECORD_KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => toggle(k.kind)}
            className={cx('rounded-full border px-2 py-0.5 text-xs transition', shown.has(k.kind) ? 'border-navy bg-navy text-on-accent' : 'border-line text-muted hover:bg-raised')}
          >
            {k.label}
          </button>
        ))}
      </div>
      <ul className="-mr-2 mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-2 scrollbar-thin">
        {list.length === 0 && <li className="text-xs text-muted">Nothing yet.</li>}
        {list.map((e, k) => (
          <li key={`${e.tick}-${k}`}>
            <button
              disabled={e.tile === undefined}
              onClick={() => e.tile !== undefined && onGo(e.tile)}
              className="flex w-full gap-2 rounded-lg px-2 py-1 text-left hover:bg-raised disabled:hover:bg-transparent"
            >
              <span className="w-24 shrink-0 font-mono text-xs text-muted">
                {MONTHS[Math.floor(e.tick / TICKS_PER_MONTH) % MONTHS_PER_YEAR].slice(0, 3)} yr {Math.floor(e.tick / TICKS_PER_YEAR) + 1}
              </span>
              <span className="text-xs">{e.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
