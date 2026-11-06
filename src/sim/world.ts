import { Deposit, isWater } from '../map/terrain';
import { randomLook } from './look';
import { PathFinder } from './path';
import { packLook, unpackLook } from './look';
import { Towns } from './towns';
import { Cultures } from './cultures';
import { Nations } from './nations';
import { Technology } from './tech';
import { Military } from './military';
import { Weather } from './weather';
import { Disasters } from './disasters';
import { Creatures } from './creatures';
import { Crime } from './crime';
import { EventRecord } from './record';
import { BUILDINGS } from './buildings';
import {
  ADULT_AGE,
  AgeLook,
  DEFAULT_TOGGLES,
  ELDER_AGE,
  Pose,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
  type Order,
  type Person,
  type PersonDetails,
  type PersonEdit,
  type SimState,
  type Snapshot,
  type Toggles,
  TileField,
} from './types';

// The running world, inside the simulation worker. Every individual is simulated in
// full each step, on screen or not (SPEC 2).
//
// Stage 2b: people have needs (SPEC 6). Food is gathered from berry bushes and fish on the
// map, carried, and eaten; rest is sleeping where they stand. Hunger that goes on too long
// takes health, and at no health a person dies (SPEC 10: death from unmet needs). Shelter
// has nothing to meet it until houses exist (Stage 3), and safety has nothing to threaten
// it until beasts, criminals and war exist, so neither does anything yet.
//
// Stage 2c: the life cycle (SPEC 6). People age; from middle age, death of old age grows
// more likely each year. Unpaired adults who meet someone of the other sex near their own
// age may pair up, and pairs keep near each other. A paired woman who is fed and healthy
// may become pregnant and gives birth nine months later. Children stay near their mother,
// are fed from what their parents carry when they can be, and otherwise forage close by.
// All of this can be turned off together (SPEC 10), which freezes the population.

/** Tiles a search may look at per step, shared by everyone waiting for a path. */
const PATH_BUDGET = 12_000;
/** Walking speed on open ground, in tiles per step (1.5 tiles a second at 1x). */
const WALK_SPEED = 0.15;

// Needs, per step. At 1x a step is a tenth of a second.
/** Food lost per step: from full to hungry in about 45 seconds at 1x. */
const FOOD_DECAY = 0.12;
const HUNGRY = 45;
/** Below this, they top up what they carry when food is close by. */
const PECKISH = 85;
const EAT_GAIN = 50;
const CARRY_MAX = 3;
/** A load collected by order (wood, stone, ore or clay) before it goes to the store. */
const COLLECT_LOAD = 6;
/** Rest lost per step awake, and gained per step asleep. */
const REST_DECAY = 0.08;
const REST_GAIN = 0.6;
const TIRED = 25;
/** Below this much food, finding food comes before sleep. */
const STARVING = 15;
const RESTED = 95;
/** Health lost per step with no food at all: from full to dead in about 25 seconds at 1x. */
const STARVE = 0.4;
/** Health gained per step when fed and rested. */
const HEAL = 0.15;
const GATHER_STEPS = 20;
/** Work done out of doors, which bad weather slows (Stage 6). */
const OUTDOORS = new Set<string>(['gather', 'collect', 'chop', 'quarry', 'build', 'farm', 'harvest', 'mine', 'fish', 'dig', 'herd']);
const EAT_STEPS = 10;

/** Most food a tile holds, and the chance each month that it grows back by one. */
const FOOD_MAX: Record<number, number> = { [Deposit.Berries]: 6, [Deposit.Fish]: 8 };
const REGROW: Record<number, number> = { [Deposit.Berries]: 0.6, [Deposit.Fish]: 0.8 };
const isFood = (d: number) => d === Deposit.Berries || d === Deposit.Fish;

/** Food tiles are grouped in cells of this many tiles a side, to find the nearest quickly. */
const CELL = 16;

// Life cycle. Ages are in years; a year is a minute at 1x.
const PAIR_AGE = 16;
/** How near (tiles) two people must be to pair up, and how far apart in age at most. */
const PAIR_RANGE = 10;
const PAIR_AGE_GAP = 12;
/** Chance each month that an unpaired adult pairs with someone suitable nearby. */
const PAIR_CHANCE = 0.35;
const FERTILE_MIN = 16;
const FERTILE_MAX = 45;
/** Chance each month that a fed, healthy, paired woman with her pair nearby becomes pregnant. */
const CONCEIVE_CHANCE = 0.1;
const PREGNANCY = 9 * TICKS_PER_MONTH;
/** At least this long between births. */
const BIRTH_GAP = 12 * TICKS_PER_MONTH;
/** How near a parent must be to share food with a hungry child. */
const SHARE_RANGE = 6;

/** Chance of dying of old age within a year, by age: none before 45, then rising (about 6% at 65, 15% at 75, 36% at 85). */
function oldAgeChance(age: number) {
  return age < 45 ? 0 : Math.min(1, 0.01 * Math.exp(0.09 * (age - 45)));
}

/** A seeded random number generator whose state can be saved. */
class Rand {
  s: number;
  constructor(s: number) {
    this.s = s >>> 0;
  }
  next = () => {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  int(n: number) {
    return Math.floor(this.next() * n);
  }
}

interface Route {
  tiles: number[];
  step: number;
}

/** Fills in anything a person saved by an older version lacks. */
function complete(p: Person) {
  p.food ??= 100;
  p.rest ??= 100;
  p.carry ??= 0;
  if (p.task !== 'sleep' && p.task !== 'idle') p.task = 'idle';
  if (p.task !== 'sleep') delete p.indoors;
  delete p.purpose;
  delete p.target;
}

export class World {
  readonly size: number;
  readonly terrain: Uint8Array;
  readonly elevation: Uint8Array;
  readonly deposit: Uint8Array;
  readonly state: SimState;
  /** Food (berries, fish) and stone left on each deposit tile. */
  readonly stock: Uint8Array;
  readonly finder: PathFinder;
  readonly rand: Rand;
  readonly byId = new Map<number, Person>();
  private routes = new Map<number, Route>();
  /** People waiting for a path: where they want to go, and why. */
  private queue: { id: number; goal: number; req: number; far?: boolean }[] = [];
  private queueHead = 0;
  /** Each person's latest path request; older ones still in the queue are skipped. */
  private latestReq = new Map<number, number>();
  private reqCounter = 0;
  /** How many people are on their way to each food tile, so a crowd does not all head for one bush. */
  private claims = new Map<number, number>();
  /** How much each person's claim holds. */
  private claimed = new Map<number, number>();
  /** Which way each person last faced (true: left on screen), kept while they stand. */
  private facing = new Map<number, boolean>();
  /** Food tiles, by cell. */
  private foodCells: number[][];
  /** How many tiles in each cell still have food nobody has claimed, so searches skip empty cells at once. */
  private cellFree: Int32Array;
  private foodTiles: number[];
  private regrowCursor = 0;
  /** Food tiles each person could not reach lately (the last few), so they look elsewhere. */
  private avoid = new Map<number, number[]>();
  private tileChanges: number[] = [];
  /** People by cell, rebuilt every so often, for finding someone to pair with. */
  private grid = new Map<number, Person[]>();
  readonly toggles: Toggles;
  readonly towns: Towns;
  readonly cultures: Cultures;
  readonly nations: Nations;
  readonly tech: Technology;
  readonly military: Military;
  readonly weather: Weather;
  readonly disasters: Disasters;
  readonly creatures: Creatures;
  readonly crime: Crime;
  readonly record: EventRecord;
  /** Why people died recently (for the inspect panel); cleared as it is read. */
  readonly deaths = new Map<number, string>();

  constructor(size: number, terrain: Uint8Array, elevation: Uint8Array, deposit: Uint8Array, state: SimState) {
    this.size = size;
    this.terrain = terrain;
    this.elevation = elevation;
    this.deposit = deposit;
    this.state = state;
    this.rand = new Rand(state.rng);
    this.finder = new PathFinder(size, terrain, elevation);
    const n = size * size;
    const cells = Math.ceil(size / CELL);
    this.foodCells = Array.from({ length: cells * cells }, () => []);
    this.cellFree = new Int32Array(cells * cells);
    this.foodTiles = [];
    const fresh = !state.stock || state.stock.length !== n;
    this.stock = fresh ? new Uint8Array(n) : state.stock!;
    // Stone deposits got a stock in Stage 3a (ore in 3b); a world saved before then starts them full.
    const freshStone = fresh || !state.trees;
    for (let i = 0; i < n; i++) {
      const d = deposit[i];
      if (d === Deposit.Stone || d === Deposit.Iron || d === Deposit.Gold || d === Deposit.Clay) {
        if (freshStone) this.stock[i] = Towns.stoneStock();
        continue;
      }
      if (!isFood(d)) {
        this.stock[i] = 0;
        continue;
      }
      if (fresh) this.stock[i] = FOOD_MAX[d];
      this.foodTiles.push(i);
      const x = i % size;
      const y = (i - x) / size;
      this.foodCells[Math.floor(y / CELL) * cells + Math.floor(x / CELL)].push(i);
    }
    state.stock = this.stock;
    this.toggles = { ...DEFAULT_TOGGLES, ...state.toggles };
    state.toggles = this.toggles;
    for (const t of this.foodTiles) if (this.stock[t] > 0) this.cellFree[this.cellOf(t)]++;
    for (const p of state.people) {
      complete(p);
      this.byId.set(p.id, p);
    }
    this.towns = new Towns(this);
    this.finder.walls = this.towns.walls;
    this.finder.roads = this.towns.roads;
    this.finder.bridges = this.towns.bridges;
    this.towns.markDocks();
    this.cultures = new Cultures(this);
    this.nations = new Nations(this);
    this.tech = new Technology(this);
    this.military = new Military(this);
    this.record = new EventRecord(this);
    this.weather = new Weather(this);
    this.disasters = new Disasters(this);
    this.creatures = new Creatures(this);
    this.crime = new Crime(this);
  }

  /** Records that a tile's drawing changed (deposit used up or back, trees, land). */
  tileChange(t: number, field: number, value: number) {
    this.tileChanges.push(t, field, value);
  }

  /** A deposit has been used up (drawn without its goods). */
  tileEmptied(t: number) {
    this.tileChange(t, TileField.Empty, 1);
  }

  private cellOf(t: number) {
    const size = this.size;
    const x = t % size;
    return Math.floor((t - x) / size / CELL) * Math.ceil(size / CELL) + Math.floor(x / CELL);
  }

  private isFree(t: number) {
    return this.stock[t] - (this.claims.get(t) ?? 0) > 0;
  }

  /** Runs a change to a food tile's stock or claims, keeping its cell's count of free tiles right. */
  private touch(t: number, change: () => void) {
    const before = this.isFree(t);
    change();
    const after = this.isFree(t);
    if (before !== after) this.cellFree[this.cellOf(t)] += after ? 1 : -1;
  }

  // ---------------------------------------------------------------- stepping

  step() {
    const st = this.state;
    st.tick++;
    this.finder.expanded = 0;
    this.servePaths();
    this.regrow();
    this.towns.step();
    this.military.step();
    this.weather.step();
    this.disasters.step();
    this.creatures.step();
    this.crime.step();
    if (st.tick % TICKS_PER_MONTH === 13) this.cultures.monthly();
    if (st.tick % TICKS_PER_MONTH === 19) this.nations.monthly();
    if (st.tick % TICKS_PER_MONTH === 23) this.tech.monthly();
    if (st.tick % TICKS_PER_MONTH === 29) this.military.monthly();
    if (this.toggles.lifeCycle) {
      if (st.tick % 25 === 0) this.buildGrid();
    } else {
      // Aging is off: everyone stays the age they are.
      for (const p of st.people) {
        p.born++;
        if (p.lastBirth !== undefined) p.lastBirth++;
      }
    }
    // Copy the list: people can die or be born during the step.
    for (const p of st.people.slice()) this.update(p);
    st.rng = this.rand.s;
  }

  private buildGrid() {
    this.grid.clear();
    const cells = Math.ceil(this.size / CELL);
    for (const p of this.state.people) {
      const c = Math.floor(p.y / CELL) * cells + Math.floor(p.x / CELL);
      const list = this.grid.get(c);
      if (list) list.push(p);
      else this.grid.set(c, [p]);
    }
  }

  ageOf(p: Person) {
    return (this.state.tick - p.born) / TICKS_PER_YEAR;
  }

  near(a: Person, b: Person, range: number) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= range * range;
  }

  // ---------------------------------------------------------------- life cycle

  /** Once a month for each person: old age, pairing, and pregnancy. Returns false if they died. */
  private monthly(p: Person): boolean {
    const age = this.ageOf(p);
    const yearly = oldAgeChance(age);
    if (yearly > 0 && this.rand.next() < 1 - Math.pow(1 - yearly, 1 / 12)) {
      this.die(p, 'old age');
      return false;
    }
    if (p.pair === undefined && age >= PAIR_AGE) this.tryPair(p, age);
    if (
      p.sex === 0 &&
      p.pair !== undefined &&
      p.pregnant === undefined &&
      age >= FERTILE_MIN &&
      age <= FERTILE_MAX &&
      (p.lastBirth === undefined || this.state.tick - p.lastBirth >= BIRTH_GAP) &&
      p.food > 50 &&
      p.health > 60
    ) {
      const partner = this.byId.get(p.pair);
      // Together: near each other, or sharing a home (pairs with jobs are often apart by day).
      const together = partner && (this.near(p, partner, 8) || (p.home !== undefined && p.home === partner.home));
      if (partner && together && this.rand.next() < CONCEIVE_CHANCE) {
        p.pregnant = PREGNANCY;
        p.childFather = partner.id;
      }
    }
    return true;
  }

  isRelated(a: Person, b: Person) {
    return this.related(a, b);
  }

  private related(a: Person, b: Person) {
    if (a.mother !== undefined && (a.mother === b.mother || a.mother === b.id)) return true;
    if (a.father !== undefined && (a.father === b.father || a.father === b.id)) return true;
    return b.mother === a.id || b.father === a.id;
  }

  private tryPair(p: Person, age: number) {
    const cells = Math.ceil(this.size / CELL);
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    let best: Person | null = null;
    let bestD = Infinity;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gy < 0 || gx >= cells || gy >= cells) continue;
        for (const q of this.grid.get(gy * cells + gx) ?? []) {
          if (q === p || q.sex === p.sex || q.pair !== undefined || !this.byId.has(q.id) || !!q.criminal !== !!p.criminal) continue;
          const qa = this.ageOf(q);
          if (qa < PAIR_AGE || Math.abs(qa - age) > PAIR_AGE_GAP || this.related(p, q)) continue;
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d <= PAIR_RANGE * PAIR_RANGE && d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
    }
    if (best && this.rand.next() < PAIR_CHANCE) {
      p.pair = best.id;
      best.pair = p.id;
    }
  }

  private giveBirth(mother: Person) {
    const st = this.state;
    const fatherId = mother.childFather;
    delete mother.childFather;
    const father = fatherId !== undefined ? this.byId.get(fatherId) : undefined;
    const ml = unpackLook(mother.look);
    const fl = father ? unpackLook(father.look) : ml;
    const pick = <T,>(a: T, b: T) => (this.rand.next() < 0.5 ? a : b);
    const child: Person = {
      id: st.nextId++,
      sex: this.rand.next() < 0.5 ? 0 : 1,
      born: st.tick,
      health: 100,
      // Skin and hair from either parent; clothes of their own.
      look: packLook(pick(ml.skin, fl.skin), pick(ml.hair, fl.hair), this.rand.int(10)),
      x: mother.x + (this.rand.next() - 0.5) * 0.4,
      y: mother.y + (this.rand.next() - 0.5) * 0.4,
      task: 'idle',
      wait: 20,
      food: 80,
      rest: 100,
      carry: 0,
      mother: mother.id,
      father: fatherId,
      // Born into their mother's settlement and home.
      settlement: mother.settlement,
      home: mother.home,
    };
    st.people.push(child);
    this.byId.set(child.id, child);
    this.cultures.onBirth(child, mother, father);
    delete mother.pregnant;
    mother.lastBirth = st.tick;
  }

  private servePaths() {
    while (this.queueHead < this.queue.length && this.finder.expanded < PATH_BUDGET) {
      const { id, goal, req, far } = this.queue[this.queueHead++];
      const p = this.byId.get(id);
      if (!p || p.task !== 'idle' || this.latestReq.get(id) !== req) continue;
      this.latestReq.delete(id);
      // Long journeys (traders) may look much further. Between pieces of land there is no way on
      // foot: a long journey may go by boat, from land with a dock (Caleb: water is crossed by boat or bridge).
      const start = this.tileOf(p);
      const from = this.finder.land(start);
      const to = this.finder.land(goal);
      // (Someone already afloat sails wherever they go next.)
      const byBoat = from < 0 || ((far || p.purpose === 'order') && this.finder.hasBoats && this.finder.dockOn(from));
      // A short trip that needs a long way round (food just across a river) is given up quickly,
      // so they choose something else: the search looks at more tiles the further the goal is.
      const sx = start % this.size - goal % this.size;
      const sy = Math.floor(start / this.size) - Math.floor(goal / this.size);
      let limit = far ? 60000 : Math.min(8000, Math.max(600, (sx * sx + sy * sy) * 25));
      // Settled people near home: when their settlement's walk map says the goal can be walked to,
      // the search is given room for the way round it may take (so it finds it rather than giving up).
      if (p.settlement !== undefined && from >= 0 && from === to) {
        const ds = this.towns.walkDist(p.settlement, start);
        const dg = this.towns.walkDist(p.settlement, goal);
        if (ds !== undefined && dg !== undefined && ds >= 0 && dg >= 0) limit = Math.max(limit, Math.min(30000, (ds + dg) * (ds + dg) * 3 + 600));
      }
      const tiles = from >= 0 && from === to ? this.finder.find(start, goal, limit) : byBoat ? this.finder.find(start, goal, 60000, 'boat') : null;
      if (tiles && tiles.length) {
        this.routes.set(id, { tiles, step: 0 });
        p.task = 'walk';
      } else if (tiles && !tiles.length) {
        // Already there.
        this.arrive(p);
      } else {
        if (p.target !== undefined) {
          // They remember the last few things they could not get to, and look elsewhere.
          const list = this.avoid.get(p.id) ?? [];
          list.push(p.target);
          if (list.length > 6) list.shift();
          this.avoid.set(p.id, list);
          this.release(p);
        }
        if (p.purpose === 'order') delete p.order;
        if (p.purpose === 'settle') {
          delete p.settleAt;
          delete p.settleFrom;
        }
        this.towns.dropWork(p);
        delete p.purpose;
        p.wait = 10 + this.rand.int(30);
      }
    }
    if (this.queueHead > 2000) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  /** Each food tile is looked at about once a month and may grow back by one. */
  private regrow() {
    const tiles = this.foodTiles;
    if (!tiles.length) return;
    const per = Math.ceil(tiles.length / TICKS_PER_MONTH);
    for (let k = 0; k < per; k++) {
      const i = tiles[this.regrowCursor];
      this.regrowCursor = (this.regrowCursor + 1) % tiles.length;
      const d = this.deposit[i];
      // Berries do not grow back in winter, and seldom in a drought (Stage 6: weather).
      if (d === Deposit.Berries && !this.weather.berriesGrow(i)) continue;
      if (this.stock[i] < FOOD_MAX[d] && this.rand.next() < REGROW[d]) {
        if (this.stock[i] === 0) this.tileChange(i, TileField.Empty, 0);
        this.touch(i, () => this.stock[i]++);
      }
    }
  }

  private update(p: Person) {
    // Struck down earlier in this step.
    if (!this.byId.has(p.id)) return;
    if ((this.state.tick + p.id) % TICKS_PER_MONTH === 0) {
      if (this.toggles.lifeCycle && !this.monthly(p)) return;
      this.towns.monthly(p);
      this.crime.monthly(p);
    }
    if (this.toggles.lifeCycle && p.pregnant !== undefined && --p.pregnant <= 0) this.giveBirth(p);
    // Needs change every step (the cold makes people hungrier).
    const cold = this.weather.cold(p);
    p.food = Math.max(0, p.food - (cold ? FOOD_DECAY * 1.1 : FOOD_DECAY));
    // Sleeping at home (shelter) rests fully; sleeping out in the open rests more slowly.
    if (p.task === 'sleep') p.rest = Math.min(100, p.rest + (p.indoors ? REST_GAIN : REST_GAIN * 0.6));
    else p.rest = Math.max(0, p.rest - REST_DECAY);
    if (p.food <= 0) p.health -= STARVE;
    else if (p.food > 30 && p.rest > 15 && !cold && !p.sick) p.health = Math.min(100, p.health + HEAL);
    if (p.health <= 0) {
      this.die(p, 'hunger');
      return;
    }
    // Status effects: sickness and cold (Stage 6).
    if ((p.sick || cold) && !this.weather.person(p)) return;
    // Too tired to stay awake: they fall asleep wherever they are (after eating, if they are).
    if (p.rest <= 0 && p.task !== 'sleep' && p.task !== 'eat') this.sleep(p);
    // Settlement land grows where its people go (Caleb), looked at every few steps.
    if ((this.state.tick + p.id) % 15 === 0) this.towns.explore(p);
    // Fighting comes before anything else (Stage 5).
    if (this.military.fight(p)) return;
    // Bad weather slows work out of doors (Stage 6).
    if (OUTDOORS.has(p.task) && this.weather.slowsWork(this.tileOf(p))) return;

    switch (p.task) {
      case 'sleep':
        // Hunger wakes a sleeper once they have had some rest.
        if (p.rest >= RESTED || (p.food <= 0 && (p.carry > 0 || p.rest >= 40) && p.order?.kind !== 'rest')) {
          p.task = 'idle';
          delete p.indoors;
          p.wait = 5 + this.rand.int(15);
          if (p.order?.kind === 'rest') delete p.order;
          // Woken by hunger with food in hand: they eat first.
          if (p.food < HUNGRY && p.carry > 0) this.eat(p);
        }
        return;
      case 'walk':
        if ((this.state.tick + p.id) % 10 === 0) {
          // Hungry with food in hand: they eat where they are, then go on.
          if (p.food < HUNGRY && p.carry > 0) {
            this.stop(p);
            this.eat(p);
            return;
          }
          // A stroll gives way to hunger or tiredness; anyone starving on the way somewhere else
          // stops to see to it (unless they are already going for food).
          // (Someone in a boat keeps going: there is nothing to find on open water.)
          const forFood = p.purpose === 'food' || p.purpose === 'store';
          const afloat = this.finder.water(this.tileOf(p));
          if (!afloat && ((p.purpose === 'stroll' && (p.food < HUNGRY || p.rest < TIRED)) || (p.food < STARVING && !forFood))) {
            this.stop(p);
            p.wait = 0;
            return;
          }
        }
        this.walk(p);
        return;
      case 'gather':
        if (--p.wait <= 0) this.finishGather(p);
        return;
      case 'collect':
        if (--p.wait <= 0) {
          const t = p.target;
          const good = p.order?.kind === 'collect' ? p.order.good : undefined;
          delete p.target;
          if (t !== undefined && good) {
            const n = this.towns.takeFrom(good, t);
            if (n > 0) {
              if (p.load && p.load.kind === good) p.load.n += n;
              else p.load = { kind: good, n };
            }
          }
          p.task = 'idle';
          p.wait = 2;
        }
        return;
      case 'eat':
        if (--p.wait <= 0) {
          p.carry = Math.max(0, p.carry - 1);
          p.food = Math.min(100, p.food + EAT_GAIN);
          if (p.food < HUNGRY && p.carry > 0) p.wait = EAT_STEPS;
          else {
            p.task = 'idle';
            p.wait = 5 + this.rand.int(10);
          }
        }
        return;
      case 'douse':
        this.disasters.douse(p);
        return;
      case 'hunt':
        this.creatures.hunt(p);
        return;
      case 'herd':
        this.creatures.herd(p);
        return;
      case 'idle':
        if (p.wait === Infinity) {
          // Waiting for a path: someone hungry with food in hand eats meanwhile (the search is then dropped).
          if (p.food < HUNGRY && p.carry > 0) this.eat(p);
          return;
        }
        if (--p.wait <= 0) this.decide(p);
        return;
      default:
        if (!this.towns.tick(p)) this.towns.economy.tick(p);
        return;
    }
  }

  /** Chooses what to do next: the player's order first, then the most pressing need. */
  private decide(p: Person) {
    const o = p.order;
    if (o) {
      if (o.kind === 'rest') return this.sleep(p);
      if ((o.kind === 'move' || o.kind === 'attack') && o.tile !== undefined) return this.goTo(p, o.tile, 'order');
      if (o.kind === 'collect' && o.good && o.tile !== undefined && p.task !== 'sleep') {
        // A full load: to the store with it (or kept, by someone with no settlement); the order is done.
        if (p.load && p.load.kind === o.good && p.load.n >= COLLECT_LOAD) {
          delete p.order;
          if (this.towns.economy.deliver(p)) return;
        } else {
          const src = this.towns.sourceOf(o.good, o.tile, 24, p.settlement);
          if (src >= 0) {
            p.target = src;
            return this.goTo(p, src, 'collect');
          }
          delete p.order;
        }
      }
      if (o.kind === 'gather') {
        if (p.carry >= CARRY_MAX) {
          delete p.order;
        } else {
          const t = this.findFood(p, o.tile ?? this.tileOf(p), 24);
          if (t >= 0) return this.headFor(p, t);
          delete p.order;
        }
      }
    }
    // Someone hungry with food in hand eats before anything else; someone starving looks for food
    // before lying down, unless they cannot stay awake.
    if (p.food < HUNGRY && p.carry > 0) return this.eat(p);
    const starving = p.food < STARVING && p.rest > 5;
    if (p.rest < TIRED && !starving) {
      // Soldiers away on campaign sleep where they are.
      const bed = this.military.onCampaign(p) ? -1 : this.towns.bed(p);
      if (bed >= 0 && bed !== this.tileOf(p)) return this.goTo(p, bed, 'home');
      this.sleep(p);
      if (bed >= 0) p.indoors = true;
      return;
    }
    const child = this.ageOf(p) < ADULT_AGE;
    // Children run home when enemy soldiers are near (Stage 5).
    if (child && this.military.danger(p)) {
      const bed = this.towns.bed(p);
      if (bed >= 0 && bed !== this.tileOf(p)) return this.goTo(p, bed, 'home');
    }
    if (p.food < HUNGRY) {
      if (p.carry > 0) return this.eat(p);
      // A hungry child is fed from what a parent nearby carries.
      if (child) {
        for (const id of [p.mother, p.father]) {
          const parent = id !== undefined ? this.byId.get(id) : undefined;
          if (parent && parent.carry > 0 && this.near(p, parent, SHARE_RANGE)) {
            parent.carry--;
            p.carry++;
            return this.eat(p);
          }
        }
      }
      // Settled people eat from their settlement's store when it has food.
      // Soldiers away on campaign live off the land.
      const store = this.military.onCampaign(p) && this.military.awayFromHome(p) ? -1 : this.towns.economy.foodStore(p);
      if (store >= 0) return this.goTo(p, store, 'store');
      // Look close first; only the very hungry look far (far searches cost the most). Children stay closer.
      for (const r of child ? (p.food < 20 ? [14, 40] : [14]) : p.food < 20 ? [14, 40, 90] : [14, 40]) {
        const t = this.findFood(p, this.tileOf(p), r);
        if (t >= 0) return this.headFor(p, t);
      }
      // No food anywhere near: settlers press on; others wander further and look again.
      if (p.settleAt !== undefined) return this.goTo(p, p.settleAt, 'settle', true);
      return this.stroll(p, 25);
    }
    // Settlers on their way to found a settlement keep going once fed and rested.
    if (p.settleAt !== undefined) return this.goTo(p, p.settleAt, 'settle', true);
    if (p.carry < CARRY_MAX - 1 && p.food < PECKISH) {
      const t = this.findFood(p, this.tileOf(p), 10);
      if (t >= 0) return this.headFor(p, t);
    }
    // Soldiers serve full time (Stage 5).
    if (p.soldier && this.military.soldierWork(p)) return;
    // Criminals go about their own business (Stage 6).
    if (p.criminal && this.crime.decide(p)) return;
    // Their job first (now and then they help with building instead), then building work.
    const eco = this.towns.economy;
    if (p.job !== undefined && (p.load || this.rand.next() < 0.85) && eco.work(p)) return;
    if (!child && this.towns.work(p)) return;
    if (eco.deliver(p)) return;
    // Settled people keep near home (or the settlement's fire) when nothing needs doing.
    const homeTile = this.towns.anchorTile(p);
    if (homeTile >= 0 && !child) {
      const [hx, hy] = [homeTile % this.size, Math.floor(homeTile / this.size)];
      if ((p.x - hx) ** 2 + (p.y - hy) ** 2 > 36) return this.strollAt(p, homeTile, 3);
      if (this.rand.next() < 0.5) return this.strollAt(p, homeTile, 5);
      p.wait = 20 + this.rand.int(40);
      return;
    }
    // Children keep near their mother (or father); pairs keep near each other.
    const anchorId = child ? (p.mother !== undefined && this.byId.has(p.mother) ? p.mother : p.father) : p.pair;
    const anchor = anchorId !== undefined ? this.byId.get(anchorId) : undefined;
    if (anchor && !this.near(p, anchor, child ? 5 : 8)) return this.stroll(p, child ? 2 : 3, anchor);
    if (this.rand.next() < 0.6) this.stroll(p, child ? 4 : 8, anchor);
    else p.wait = 20 + this.rand.int(40);
  }

  private sleep(p: Person) {
    this.stop(p);
    p.task = 'sleep';
  }

  private eat(p: Person) {
    p.task = 'eat';
    p.wait = EAT_STEPS;
  }

  /** A stroll: to a spot nearby that can be walked to in a straight line (strolls are aimless, so not worth a search). */
  private stroll(p: Person, radius: number, around?: Person) {
    this.strollTo(p, () => this.randomNearby(around ?? p, radius));
  }

  private strollAt(p: Person, tile: number, radius: number) {
    this.strollTo(p, () => this.randomNearby({ x: (tile % this.size) + 0.5, y: Math.floor(tile / this.size) + 0.5 }, radius));
  }

  private strollTo(p: Person, pick: () => number) {
    const here = this.tileOf(p);
    for (let k = 0; k < 4; k++) {
      const goal = pick();
      if (goal >= 0 && (goal === here || this.straightLine(here, goal))) return this.goTo(p, goal, 'stroll');
    }
    p.wait = 20;
  }

  goTo(p: Person, goal: number, purpose: Person['purpose'], far = false) {
    // A goal that cannot be walked on (a fence, deep water): stand beside it instead.
    if (!this.finder.walkable(goal)) {
      const a = this.approach(goal);
      if (a >= 0) goal = a;
    }
    p.purpose = purpose;
    // A short trip with nothing in the way is walked straight, without a search (most trips are
    // short: strolls, the store, work nearby), which keeps the searches for the long ones.
    const line = this.straightLine(this.tileOf(p), goal);
    if (line && line.length) {
      this.latestReq.delete(p.id);
      this.routes.set(p.id, { tiles: line, step: 0 });
      p.task = 'walk';
      p.wait = Infinity;
      return;
    }
    p.wait = Infinity; // until the path search answers
    const req = ++this.reqCounter;
    this.latestReq.set(p.id, req);
    this.queue.push({ id: p.id, goal, req, far });
  }

  /** The tiles of a straight walk from one tile to another (up to 12 tiles away), if all of it can be walked; else null. */
  private straightLine(from: number, to: number): number[] | null {
    const size = this.size;
    const x0 = from % size;
    const y0 = (from - x0) / size;
    const dx = (to % size) - x0;
    const dy = Math.floor(to / size) - y0;
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    if (n === 0 || n > 12) return null;
    const f = this.finder;
    const out: number[] = [];
    let px = x0;
    let py = y0;
    for (let k = 1; k <= n; k++) {
      const x = Math.round(x0 + (dx * k) / n);
      const y = Math.round(y0 + (dy * k) / n);
      const t = y * size + x;
      if (!f.walkable(t)) return null;
      // No cutting corners past what cannot be walked.
      if (x !== px && y !== py && (!f.walkable(py * size + x) || !f.walkable(y * size + px))) return null;
      out.push(t);
      px = x;
      py = y;
    }
    return out;
  }

  /** Heads for a food tile, claiming a share of it. */
  private headFor(p: Person, tile: number) {
    const goal = this.approach(tile);
    if (goal < 0) {
      p.wait = 10;
      return;
    }
    p.target = tile;
    // A claim holds what they will take (up to a full hand), so those after them find what is left.
    const take = Math.max(1, Math.min(CARRY_MAX - p.carry, this.stock[tile] - (this.claims.get(tile) ?? 0)));
    this.claimed.set(p.id, take);
    this.touch(tile, () => this.claims.set(tile, (this.claims.get(tile) ?? 0) + take));
    this.goTo(p, goal, 'food');
  }

  private release(p: Person) {
    const t = p.target;
    if (t === undefined) return;
    this.touch(t, () => {
      const c = (this.claims.get(t) ?? 1) - (this.claimed.get(p.id) ?? 1);
      if (c <= 0) this.claims.delete(t);
      else this.claims.set(t, c);
    });
    this.claimed.delete(p.id);
    delete p.target;
  }

  /** Stops whatever they are doing and lets go of any food they had claimed. */
  stop(p: Person) {
    this.towns?.dropWork(p);
    delete p.fireAt;
    delete p.prey;
    this.routes.delete(p.id);
    this.latestReq.delete(p.id);
    this.release(p);
    delete p.purpose;
    p.task = 'idle';
    p.wait = 0;
  }

  private walk(p: Person) {
    const r = this.routes.get(p.id);
    if (!r || r.step >= r.tiles.length) {
      this.routes.delete(p.id);
      this.arrive(p);
      return;
    }
    const size = this.size;
    const here = this.tileOf(p);
    let budget = (WALK_SPEED / this.finder.cost(here)) * this.weather.walkFactor(here) * this.disasters.walkFactor(here);
    if (p.horse || p.engine) budget *= this.military.speedOf(p);
    if (p.sick) budget *= 0.8;
    while (budget > 0 && r.step < r.tiles.length) {
      const next = r.tiles[r.step];
      // An enemy gate or fence in a soldier's way: they break it (Stage 5: sieges).
      if (p.soldier && this.military.bars(p, next)) {
        p.siegeTile = next;
        p.task = 'fight';
        return;
      }
      const tx = (next % size) + 0.5;
      const ty = Math.floor(next / size) + 0.5;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        p.x = tx;
        p.y = ty;
        budget -= d;
        r.step++;
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  private arrive(p: Person) {
    const purpose = p.purpose;
    delete p.purpose;
    p.task = 'idle';
    if (purpose === 'collect') {
      // At the source: work it for a while (see 'collect' in update).
      p.task = 'collect';
      p.wait = 45;
      return;
    }
    if (purpose === 'muster' || purpose === 'chase') {
      this.military.muster(p);
      p.wait = purpose === 'chase' ? 0 : 10 + this.rand.int(30);
      return;
    }
    if (this.disasters.arrive(p, purpose) || this.creatures.arrive(p, purpose) || (p.criminal && this.crime.arrive(p, purpose))) return;
    if (this.towns.arrive(p, purpose) || this.towns.economy.arrive(p, purpose)) return;
    if (purpose === 'food' && p.target !== undefined) {
      if (this.stock[p.target] > 0) {
        p.task = 'gather';
        p.wait = GATHER_STEPS;
        return;
      }
      // Someone got there first.
      this.release(p);
      p.wait = 0;
      return;
    }
    if (purpose === 'order' && (p.order?.kind === 'move' || p.order?.kind === 'attack')) delete p.order;
    p.wait = purpose === 'order' ? 30 : 20 + this.rand.int(50);
  }

  private finishGather(p: Person) {
    const t = p.target;
    const held = this.claimed.get(p.id) ?? CARRY_MAX;
    this.release(p);
    if (t === undefined) {
      p.task = 'idle';
      return;
    }
    // What their claim held (more if nobody else is waiting on it).
    const free = this.stock[t] - (this.claims.get(t) ?? 0);
    const take = Math.min(this.stock[t], CARRY_MAX - p.carry, Math.max(held, free));
    if (take > 0) {
      this.touch(t, () => (this.stock[t] -= take));
      p.carry += take;
      if (this.stock[t] === 0) this.tileChange(t, TileField.Empty, 1);
    }
    if (p.order?.kind === 'gather') delete p.order;
    if (p.food < 70 && p.carry > 0) this.eat(p);
    else {
      p.task = 'idle';
      p.wait = 5 + this.rand.int(10);
    }
  }

  /** The nearest food tile within `radius` of `from` that still has food nobody has claimed, or -1. */
  private findFood(p: Person, from: number, radius: number): number {
    const size = this.size;
    const cells = Math.ceil(size / CELL);
    const fx = from % size;
    const fy = (from - fx) / size;
    const cx = Math.floor(fx / CELL);
    const cy = Math.floor(fy / CELL);
    const rings = Math.ceil(radius / CELL);
    const skip = this.avoid.get(p.id);
    const myLand = this.finder.land(this.tileOf(p));
    const home = p.settlement;
    let best = -1;
    let bestD = radius * radius + 1;
    for (let ring = 0; ring <= rings; ring++) {
      // Nothing in a further ring can be nearer than what is already found.
      if (best >= 0 && (ring - 1) * CELL > Math.sqrt(bestD)) break;
      for (let gy = cy - ring; gy <= cy + ring; gy++) {
        for (let gx = cx - ring; gx <= cx + ring; gx++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
          if (gx < 0 || gy < 0 || gx >= cells || gy >= cells) continue;
          if (this.cellFree[gy * cells + gx] <= 0) continue;
          for (const t of this.foodCells[gy * cells + gx]) {
            if (skip && skip.includes(t)) continue;
            const left = this.stock[t] - (this.claims.get(t) ?? 0);
            if (left <= 0) continue;
            // Only food they can walk to (not across a river or sea).
            if (!this.finder.reachable(myLand, t) || (home !== undefined && !this.towns.canWalk(home, t))) continue;
            const dx = (t % size) - fx;
            const dy = Math.floor(t / size) - fy;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = t;
            }
          }
        }
      }
    }
    return best;
  }

  /** Where to stand to gather from a tile: the tile itself, or a walkable tile beside it (fish in deep water). */
  approach(tile: number): number {
    if (this.finder.walkable(tile)) return tile;
    const size = this.size;
    const x = tile % size;
    const y = (tile - x) / size;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (this.finder.walkable(j)) return j;
      }
    }
    return -1;
  }

  /** Someone is killed (Stage 5: in battle). */
  kill(p: Person, cause: string) {
    this.die(p, cause);
  }

  private die(p: Person, cause: string) {
    if (!this.byId.has(p.id)) return;
    this.stop(p);
    this.towns.leave(p);
    this.unpair(p.id);
    this.deaths.set(p.id, cause);
    this.removeWhere((q) => q === p);
  }

  tileOf(p: { x: number; y: number }) {
    return Math.floor(p.y) * this.size + Math.floor(p.x);
  }

  private randomNearby(p: { x: number; y: number }, radius: number): number {
    const size = this.size;
    for (let k = 0; k < 8; k++) {
      const x = Math.floor(p.x) + this.rand.int(radius * 2 + 1) - radius;
      const y = Math.floor(p.y) + this.rand.int(radius * 2 + 1) - radius;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = y * size + x;
      if (this.finder.walkable(i) && !isWater(this.terrain[i])) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- player actions

  /** Places one adult on each land tile given (SPEC 4: unit placement). Returns how many were placed. */
  place(tiles: number[]): number {
    let n = 0;
    for (const i of tiles) {
      if (!Number.isInteger(i) || i < 0 || i >= this.terrain.length || isWater(this.terrain[i]) || !this.finder.walkable(i)) continue;
      const st = this.state;
      const age = 16 + this.rand.next() * 20;
      const p: Person = {
        id: st.nextId++,
        sex: this.rand.next() < 0.5 ? 0 : 1,
        born: st.tick - Math.floor(age * TICKS_PER_YEAR),
        health: 100,
        look: randomLook(this.rand.next),
        x: (i % this.size) + 0.3 + this.rand.next() * 0.4,
        y: Math.floor(i / this.size) + 0.3 + this.rand.next() * 0.4,
        task: 'idle',
        wait: 10 + this.rand.int(40),
        // Placed people arrive fed and rested, but not all exactly the same.
        food: 70 + this.rand.next() * 30,
        rest: 60 + this.rand.next() * 40,
        carry: 0,
      };
      st.people.push(p);
      this.byId.set(p.id, p);
      n++;
    }
    return n;
  }

  /** Adds someone made elsewhere (a band of bandits). */
  addPerson(p: Person) {
    this.state.people.push(p);
    this.byId.set(p.id, p);
  }

  /** Food on a tile spoiled or eaten (a flood, locusts): up to n taken away. */
  spoilFood(t: number, n: number) {
    if (!isFood(this.deposit[t]) || this.stock[t] <= 0) return;
    this.touch(t, () => (this.stock[t] = Math.max(0, this.stock[t] - n)));
    if (this.stock[t] === 0) this.tileChange(t, TileField.Empty, 1);
  }

  /** Removes everyone standing on the given tiles. */
  removeOn(tiles: number[]) {
    this.creatures.removeOn(tiles);
    const set = new Set(tiles);
    for (const p of this.state.people) if (set.has(this.tileOf(p))) this.stop(p);
    this.removeWhere((p) => set.has(this.tileOf(p)));
  }

  removePerson(id: number) {
    const p = this.byId.get(id);
    if (p) this.stop(p);
    this.removeWhere((q) => q.id === id);
  }

  private removeWhere(test: (p: Person) => boolean) {
    const keep: Person[] = [];
    for (const p of this.state.people) {
      if (test(p)) {
        this.release(p);
        if (p.pair !== undefined) {
          const q = this.byId.get(p.pair);
          if (q && q.pair === p.id) delete q.pair;
        }
        this.byId.delete(p.id);
        this.routes.delete(p.id);
        this.avoid.delete(p.id);
        this.latestReq.delete(p.id);
        this.towns.leave(p);
        this.cultures?.onGone(p);
        this.nations?.onGone(p);
        this.weather?.onGone(p);
        this.creatures?.onGone(p);
      } else keep.push(p);
    }
    this.state.people = keep;
  }

  /** Ends a person's pair, if they have one (by hand, or when one of them dies). */
  unpair(id: number) {
    const p = this.byId.get(id);
    if (!p || p.pair === undefined) return;
    const q = this.byId.get(p.pair);
    if (q && q.pair === p.id) delete q.pair;
    delete p.pair;
  }

  setToggles(t: Toggles) {
    Object.assign(this.toggles, t);
  }

  /** Changes a person by hand (SPEC 1). */
  edit(id: number, e: PersonEdit) {
    const p = this.byId.get(id);
    if (!p) return;
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    if (e.leaveJob) this.towns.economy.quit(p);
    if (e.coins !== undefined) p.coins = Math.max(0, e.coins);
    if (e.health !== undefined) p.health = Math.max(1, clamp(e.health));
    if (e.food !== undefined) p.food = clamp(e.food);
    if (e.rest !== undefined) p.rest = clamp(e.rest);
    if (e.sex !== undefined) p.sex = e.sex;
    if (e.culture !== undefined) this.cultures.setPersonCulture(p, e.culture);
    if (e.name !== undefined) {
      if (e.name === null) {
        // Rulers stay unique (SPEC 6).
        if (!this.nations.rulers.has(p.id)) delete p.unique;
      } else if (e.name.trim()) {
        if (p.unique) p.unique.name = e.name.trim().slice(0, 40);
        else p.unique = { name: e.name.trim().slice(0, 40), since: this.state.tick, why: 'chosen' };
      }
      this.nations.changed = true;
    }
    if (e.ageYears !== undefined) p.born = this.state.tick - Math.floor(Math.max(0, e.ageYears) * TICKS_PER_YEAR) - (this.state.tick - p.born) % TICKS_PER_YEAR;
  }

  /** Gives an order to some people (SPEC 4: imperatives), or cancels their orders ('stop'). */
  order(ids: number[], order: Order | { kind: 'stop' }) {
    for (const id of ids) {
      const p = this.byId.get(id);
      if (!p) continue;
      if (order.kind === 'stop') {
        delete p.order;
        if (p.task !== 'sleep' || p.rest > TIRED) this.stop(p);
        continue;
      }
      p.order = { ...order };
      // An order wakes them unless they are worn out.
      if (p.task !== 'sleep' || p.rest > TIRED || order.kind === 'rest') this.stop(p);
      p.wait = this.rand.int(5);
    }
  }

  /** Development only: n people on land around (x, y). */
  spawnTest(n: number, cx: number, cy: number) {
    const tiles: number[] = [];
    const size = this.size;
    for (let k = 0; k < n * 20 && tiles.length < n; k++) {
      const r = Math.sqrt(this.rand.next()) * 60;
      const a = this.rand.next() * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      tiles.push(y * size + x);
    }
    this.place(tiles);
  }

  // ---------------------------------------------------------------- reading

  details(id: number): PersonDetails | null {
    const p = this.byId.get(id);
    if (!p) return null;
    return {
      id: p.id,
      sex: p.sex,
      ageYears: Math.max(0, Math.floor((this.state.tick - p.born) / TICKS_PER_YEAR)),
      health: Math.round(p.health),
      look: p.look,
      task: p.task,
      purpose: p.purpose,
      food: Math.round(p.food),
      rest: Math.round(p.rest),
      carry: p.carry,
      order: p.order?.kind,
      pair: p.pair,
      mother: p.mother,
      father: p.father,
      children: this.state.people.filter((q) => q.mother === p.id || q.father === p.id).map((q) => q.id),
      pregnant: p.pregnant !== undefined,
      settlement: this.towns.settlementName(p.settlement),
      hasHome: p.home !== undefined,
      load: p.load ? { ...p.load } : undefined,
      ...this.jobDetails(p),
      coins: Math.floor(p.coins ?? 0),
      goods: p.goods ?? 0,
      wealth: Math.floor(this.towns.economy.wealthOf(p)),
      tradingWith: p.tradeTo !== undefined ? this.towns.settlementName(p.tradeTo) : undefined,
      culture: p.culture,
      name: p.unique?.name,
      unique: p.unique ? { why: p.unique.why, sinceYear: Math.floor(p.unique.since / TICKS_PER_YEAR) + 1 } : undefined,
      office: this.nations.officeOf(p),
      influence: this.nations.influence(p),
      nation: this.nations.nationOfPerson(p)?.id,
      soldier: this.military.detailsOf(p),
      danger: this.military.danger(p),
      status: this.weather.statusOf(p),
      criminal: p.criminal ? { band: p.band !== undefined && this.towns.byBuildingId(p.band) ? 'a bandit camp' : undefined, raiding: !!p.raid } : undefined,
    };
  }

  private jobDetails(p: Person): Pick<PersonDetails, 'job' | 'jobNeed'> {
    const t = this.towns;
    const b = p.job !== undefined ? t.byBuildingId(p.job) : undefined;
    const kind = t.economy.jobOf(p);
    const child = this.ageOf(p) < ADULT_AGE;
    const s = p.settlement !== undefined ? t.byId(p.settlement) : undefined;
    const job = b && kind ? { kind, light: child, at: BUILDINGS[b.kind].name } : undefined;
    // A job is a need for adults in a village or bigger (camps have no formal jobs).
    const jobNeed = child || !s || s.stage === 'camp' ? 'none' : job ? 'met' : 'unmet';
    return { job, jobNeed };
  }

  snapshot(stepMs: number): Snapshot {
    const people = this.state.people;
    const n = people.length;
    const ids = new Int32Array(n);
    const pos = new Float32Array(n * 2);
    const look = new Uint16Array(n);
    const flags = new Uint16Array(n);
    const gear = new Uint16Array(n);
    for (let k = 0; k < n; k++) {
      const p = people[k];
      ids[k] = p.id;
      pos[k * 2] = p.x;
      pos[k * 2 + 1] = p.y;
      look[k] = p.look;
      const pose = p.task === 'sleep' ? Pose.Sleep : p.task === 'walk' || p.task === 'idle' ? Pose.Stand : Pose.Work;
      const age = (this.state.tick - p.born) / TICKS_PER_YEAR;
      const ageLook = age < 7 ? AgeLook.Young : age < ADULT_AGE ? AgeLook.Child : age >= ELDER_AGE ? AgeLook.Elder : AgeLook.Adult;
      let f = (p.task === 'walk' ? 1 : 0) | (p.sex === 1 ? 4 : 0) | (pose << 3) | (ageLook << 5) | (p.indoors ? 128 : 0) | (p.load || p.taxCoins ? 256 : 0) | (this.nations.rulers.has(p.id) ? 512 : 0) | (this.finder.water(this.tileOf(p)) ? 1024 : 0) | (p.task === 'fight' || p.task === 'hunt' ? 2048 : 0) | (p.sick ? 4096 : 0) | (p.criminal ? 8192 : 0);
      const r = p.task === 'walk' ? this.routes.get(p.id) : undefined;
      if (r && r.step < r.tiles.length) {
        // Facing left on screen when heading toward smaller (x - y).
        const next = r.tiles[r.step];
        const nx = (next % this.size) + 0.5;
        const ny = Math.floor(next / this.size) + 0.5;
        if (nx - ny < p.x - p.y) f |= 2;
        this.facing.set(p.id, nx - ny < p.x - p.y);
      } else if (p.task === 'fight') {
        // A fighter faces their foe.
        const foe = p.foe !== undefined ? this.byId.get(p.foe) : undefined;
        if (foe ? foe.x - foe.y < p.x - p.y : this.facing.get(p.id)) f |= 2;
      } else if (this.facing.get(p.id)) f |= 2;
      flags[k] = f;
      if (p.soldier) gear[k] = this.military.gearOf(p);
    }
    const tileChanges = Int32Array.from(this.tileChanges);
    this.tileChanges = [];
    const t = this.towns;
    const buildings = t.buildingsChanged ? t.buildingViews() : undefined;
    const settlements = t.settlementsChanged ? t.settlementViews() : undefined;
    const cultures = this.cultures.changed || this.tech.changed ? this.cultures.views() : undefined;
    const nations = this.nations.changed || this.military.changed ? this.nations.views() : undefined;
    t.buildingsChanged = false;
    t.settlementsChanged = false;
    this.cultures.changed = false;
    this.nations.changed = false;
    this.tech.changed = false;
    this.military.changed = false;
    const { shots, falls } = this.military.takeEffects();
    if (this.facing.size > people.length * 2) for (const id of this.facing.keys()) if (!this.byId.has(id)) this.facing.delete(id);
    const creatures = this.creatures.snapshot();
    const weather = this.weather.changed || this.disasters.changed ? { season: this.weather.season(), fronts: this.weather.fronts(), droughts: this.weather.st.droughts.map((d) => ({ x: d.x, y: d.y, r: d.r })), ...this.disasters.view() } : undefined;
    this.weather.changed = false;
    this.disasters.changed = false;
    const quake = this.disasters.quake;
    this.disasters.quake = undefined;
    return { tick: this.state.tick, ids, pos, look, flags, gear, shots, falls, tileChanges, buildings, settlements, cultures, nations, creatures, weather, record: this.record.take(), quake, stepMs };
  }

  /** A copy of everything that is saved. */
  saveState(): SimState {
    return {
      ...this.state,
      rng: this.rand.s,
      stock: this.stock.slice(),
      toggles: { ...this.toggles },
      trees: this.towns.trees.slice(),
      territory: this.towns.territory.slice(),
      walls: this.towns.walls.slice(),
      roads: this.towns.roads.slice(),
      bridges: this.towns.bridges.slice(),
      settlements: this.towns.settlements.map((s) => ({ ...s, queue: s.queue.map((q) => ({ ...q })) })),
      buildings: this.towns.buildings.map((b) => ({ ...b })),
      cultures: this.cultures.list.map((c) => ({ ...c, traits: { ...c.traits }, support: c.support ? { ...c.support } : undefined, techs: c.techs ? [...c.techs] : undefined, progress: c.progress ? { ...c.progress } : undefined })),
      nations: this.nations.list.map((n) => ({ ...n, policies: { ...n.policies }, techs: n.techs ? [...n.techs] : undefined })),
      relations: this.nations.relations.map((r) => ({ ...r, war: r.war ? { ...r.war, strength: { ...r.war.strength }, lost: { ...r.war.lost }, taken: { ...r.war.taken } } : undefined })),
      armies: this.military.armies.map((a) => ({ ...a, order: a.order ? { ...a.order } : undefined })),
      weather: { ...this.weather.st, fronts: this.weather.st.fronts.map((f) => ({ ...f })), droughts: this.weather.st.droughts.map((d) => ({ ...d })) },
      disasters: { floods: this.disasters.st.floods.map((f) => ({ ...f, tiles: [...f.tiles] })), swarms: this.disasters.st.swarms.map((x) => ({ ...x })), burning: [...this.disasters.st.burning] },
      creatures: this.creatures.save(),
      record: this.record.list.map((e) => ({ ...e })),
      people: this.state.people.map((p) => {
        const q: Person = { ...p, wait: Number.isFinite(p.wait) ? Math.min(p.wait, 100) : 0 };
        // Routes and claims are not saved; anyone on the move starts again from standing.
        if (q.task !== 'sleep') q.task = 'idle';
        delete q.purpose;
        delete q.target;
        if (q.load) q.load = { ...q.load };
        else delete q.site;
        if (q.unique) q.unique = { ...q.unique };
        if (q.raid) q.raid = { ...q.raid };
        // Hunting, herding and fire-fighting start again from standing too.
        delete q.prey;
        delete q.herding;
        delete q.fireAt;
        return q;
      }),
    };
  }
}
