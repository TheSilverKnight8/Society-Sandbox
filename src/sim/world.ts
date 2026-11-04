import { Deposit, isWater } from '../map/terrain';
import { randomLook } from './look';
import { PathFinder } from './path';
import { packLook, unpackLook } from './look';
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
/** Rest lost per step awake, and gained per step asleep. */
const REST_DECAY = 0.08;
const REST_GAIN = 0.6;
const TIRED = 25;
const RESTED = 95;
/** Health lost per step with no food at all: from full to dead in about 25 seconds at 1x. */
const STARVE = 0.4;
/** Health gained per step when fed and rested. */
const HEAL = 0.15;
const GATHER_STEPS = 20;
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
const CONCEIVE_CHANCE = 0.03;
const PREGNANCY = 9 * TICKS_PER_MONTH;
/** At least this long between births. */
const BIRTH_GAP = 18 * TICKS_PER_MONTH;
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
  delete p.purpose;
  delete p.target;
}

export class World {
  readonly size: number;
  readonly terrain: Uint8Array;
  readonly elevation: Uint8Array;
  readonly deposit: Uint8Array;
  readonly state: SimState;
  private stock: Uint8Array;
  private finder: PathFinder;
  private rand: Rand;
  private byId = new Map<number, Person>();
  private routes = new Map<number, Route>();
  /** People waiting for a path: where they want to go, and why. */
  private queue: { id: number; goal: number; req: number }[] = [];
  private queueHead = 0;
  /** Each person's latest path request; older ones still in the queue are skipped. */
  private latestReq = new Map<number, number>();
  private reqCounter = 0;
  /** How many people are on their way to each food tile, so a crowd does not all head for one bush. */
  private claims = new Map<number, number>();
  /** Food tiles, by cell. */
  private foodCells: number[][];
  /** How many tiles in each cell still have food nobody has claimed, so searches skip empty cells at once. */
  private cellFree: Int32Array;
  private foodTiles: number[];
  private regrowCursor = 0;
  /** A food tile each person could not reach last time, so they look elsewhere next. */
  private avoid = new Map<number, number>();
  private stockChanges: number[] = [];
  /** People by cell, rebuilt every so often, for finding someone to pair with. */
  private grid = new Map<number, Person[]>();
  private toggles: Toggles;
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
    for (let i = 0; i < n; i++) {
      const d = deposit[i];
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

  private ageOf(p: Person) {
    return (this.state.tick - p.born) / TICKS_PER_YEAR;
  }

  private near(a: Person, b: Person, range: number) {
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
      if (partner && this.near(p, partner, 8) && this.rand.next() < CONCEIVE_CHANCE) {
        p.pregnant = PREGNANCY;
        p.childFather = partner.id;
      }
    }
    return true;
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
          if (q === p || q.sex === p.sex || q.pair !== undefined || !this.byId.has(q.id)) continue;
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
    };
    st.people.push(child);
    this.byId.set(child.id, child);
    delete mother.pregnant;
    mother.lastBirth = st.tick;
  }

  private servePaths() {
    while (this.queueHead < this.queue.length && this.finder.expanded < PATH_BUDGET) {
      const { id, goal, req } = this.queue[this.queueHead++];
      const p = this.byId.get(id);
      if (!p || p.task !== 'idle' || this.latestReq.get(id) !== req) continue;
      this.latestReq.delete(id);
      const tiles = this.finder.find(this.tileOf(p), goal, 8000);
      if (tiles && tiles.length) {
        this.routes.set(id, { tiles, step: 0 });
        p.task = 'walk';
      } else if (tiles && !tiles.length) {
        // Already there.
        this.arrive(p);
      } else {
        if (p.target !== undefined) {
          this.avoid.set(p.id, p.target);
          this.release(p);
        }
        if (p.purpose === 'order') delete p.order;
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
      if (this.stock[i] < FOOD_MAX[d] && this.rand.next() < REGROW[d]) {
        if (this.stock[i] === 0) this.stockChanges.push(-(i + 1));
        this.touch(i, () => this.stock[i]++);
      }
    }
  }

  private update(p: Person) {
    if (this.toggles.lifeCycle) {
      if ((this.state.tick + p.id) % TICKS_PER_MONTH === 0 && !this.monthly(p)) return;
      if (p.pregnant !== undefined && --p.pregnant <= 0) this.giveBirth(p);
    }
    // Needs change every step.
    p.food = Math.max(0, p.food - FOOD_DECAY);
    if (p.task === 'sleep') p.rest = Math.min(100, p.rest + REST_GAIN);
    else p.rest = Math.max(0, p.rest - REST_DECAY);
    if (p.food <= 0) p.health -= STARVE;
    else if (p.food > 30 && p.rest > 15) p.health = Math.min(100, p.health + HEAL);
    if (p.health <= 0) {
      this.die(p, 'hunger');
      return;
    }
    // Too tired to stay awake: they fall asleep wherever they are.
    if (p.rest <= 0 && p.task !== 'sleep') this.sleep(p);

    switch (p.task) {
      case 'sleep':
        if (p.rest >= RESTED) {
          p.task = 'idle';
          p.wait = 5 + this.rand.int(15);
          if (p.order?.kind === 'rest') delete p.order;
        }
        return;
      case 'walk':
        // A stroll gives way to hunger or tiredness.
        if (p.purpose === 'stroll' && (p.food < HUNGRY || p.rest < TIRED) && (this.state.tick + p.id) % 10 === 0) {
          this.stop(p);
          p.wait = 0;
          return;
        }
        this.walk(p);
        return;
      case 'gather':
        if (--p.wait <= 0) this.finishGather(p);
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
      case 'idle':
        if (p.wait === Infinity) return; // waiting for a path
        if (--p.wait <= 0) this.decide(p);
        return;
    }
  }

  /** Chooses what to do next: the player's order first, then the most pressing need. */
  private decide(p: Person) {
    const o = p.order;
    if (o) {
      if (o.kind === 'rest') return this.sleep(p);
      if (o.kind === 'move' && o.tile !== undefined) return this.goTo(p, o.tile, 'order');
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
    if (p.rest < TIRED) return this.sleep(p);
    const child = this.ageOf(p) < ADULT_AGE;
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
      // Look close first; only the very hungry look far (far searches cost the most). Children stay closer.
      for (const r of child ? (p.food < 20 ? [14, 40] : [14]) : p.food < 20 ? [14, 40, 90] : [14, 40]) {
        const t = this.findFood(p, this.tileOf(p), r);
        if (t >= 0) return this.headFor(p, t);
      }
      // No food anywhere near: wander further and look again.
      return this.stroll(p, 25);
    }
    if (p.carry < CARRY_MAX - 1 && p.food < PECKISH) {
      const t = this.findFood(p, this.tileOf(p), 10);
      if (t >= 0) return this.headFor(p, t);
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

  private stroll(p: Person, radius: number, around?: Person) {
    const goal = this.randomNearby(around ?? p, radius);
    if (goal < 0) p.wait = 20;
    else this.goTo(p, goal, 'stroll');
  }

  private goTo(p: Person, goal: number, purpose: Person['purpose']) {
    p.purpose = purpose;
    p.wait = Infinity; // until the path search answers
    const req = ++this.reqCounter;
    this.latestReq.set(p.id, req);
    this.queue.push({ id: p.id, goal, req });
  }

  /** Heads for a food tile, claiming a share of it. */
  private headFor(p: Person, tile: number) {
    const goal = this.approach(tile);
    if (goal < 0) {
      p.wait = 10;
      return;
    }
    p.target = tile;
    this.touch(tile, () => this.claims.set(tile, (this.claims.get(tile) ?? 0) + 1));
    this.goTo(p, goal, 'food');
  }

  private release(p: Person) {
    const t = p.target;
    if (t === undefined) return;
    this.touch(t, () => {
      const c = (this.claims.get(t) ?? 1) - 1;
      if (c <= 0) this.claims.delete(t);
      else this.claims.set(t, c);
    });
    delete p.target;
  }

  /** Stops whatever they are doing and lets go of any food they had claimed. */
  private stop(p: Person) {
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
    let budget = WALK_SPEED / this.finder.cost(this.tileOf(p));
    while (budget > 0 && r.step < r.tiles.length) {
      const next = r.tiles[r.step];
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
    if (purpose === 'order' && p.order?.kind === 'move') delete p.order;
    p.wait = purpose === 'order' ? 30 : 20 + this.rand.int(50);
  }

  private finishGather(p: Person) {
    const t = p.target;
    this.release(p);
    if (t === undefined) {
      p.task = 'idle';
      return;
    }
    const take = Math.min(this.stock[t], CARRY_MAX - p.carry);
    if (take > 0) {
      this.touch(t, () => (this.stock[t] -= take));
      p.carry += take;
      if (this.stock[t] === 0) this.stockChanges.push(t + 1);
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
            if (t === skip) continue;
            const left = this.stock[t] - (this.claims.get(t) ?? 0);
            if (left <= 0) continue;
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
  private approach(tile: number): number {
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

  private die(p: Person, cause: string) {
    this.stop(p);
    this.unpair(p.id);
    this.deaths.set(p.id, cause);
    this.removeWhere((q) => q === p);
  }

  private tileOf(p: Person) {
    return Math.floor(p.y) * this.size + Math.floor(p.x);
  }

  private randomNearby(p: Person, radius: number): number {
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
      if (i < 0 || i >= this.terrain.length || isWater(this.terrain[i]) || !this.finder.walkable(i)) continue;
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

  /** Removes everyone standing on the given tiles. */
  removeOn(tiles: number[]) {
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
        if (p.pair !== undefined) {
          const q = this.byId.get(p.pair);
          if (q && q.pair === p.id) delete q.pair;
        }
        this.byId.delete(p.id);
        this.routes.delete(p.id);
        this.avoid.delete(p.id);
        this.latestReq.delete(p.id);
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
    if (e.health !== undefined) p.health = Math.max(1, clamp(e.health));
    if (e.food !== undefined) p.food = clamp(e.food);
    if (e.rest !== undefined) p.rest = clamp(e.rest);
    if (e.sex !== undefined) p.sex = e.sex;
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
    };
  }

  snapshot(stepMs: number): Snapshot {
    const people = this.state.people;
    const n = people.length;
    const ids = new Int32Array(n);
    const pos = new Float32Array(n * 2);
    const look = new Uint16Array(n);
    const flags = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const p = people[k];
      ids[k] = p.id;
      pos[k * 2] = p.x;
      pos[k * 2 + 1] = p.y;
      look[k] = p.look;
      const pose = p.task === 'sleep' ? Pose.Sleep : p.task === 'gather' || p.task === 'eat' ? Pose.Work : Pose.Stand;
      const age = (this.state.tick - p.born) / TICKS_PER_YEAR;
      const ageLook = age < 7 ? AgeLook.Young : age < ADULT_AGE ? AgeLook.Child : age >= ELDER_AGE ? AgeLook.Elder : AgeLook.Adult;
      let f = (p.task === 'walk' ? 1 : 0) | (p.sex === 1 ? 4 : 0) | (pose << 3) | (ageLook << 5);
      const r = p.task === 'walk' ? this.routes.get(p.id) : undefined;
      if (r && r.step < r.tiles.length) {
        // Facing left on screen when heading toward smaller (x - y).
        const next = r.tiles[r.step];
        const nx = (next % this.size) + 0.5;
        const ny = Math.floor(next / this.size) + 0.5;
        if (nx - ny < p.x - p.y) f |= 2;
      }
      flags[k] = f;
    }
    const stockChanges = Int32Array.from(this.stockChanges);
    this.stockChanges = [];
    return { tick: this.state.tick, ids, pos, look, flags, stockChanges, stepMs };
  }

  /** A copy of everything that is saved. */
  saveState(): SimState {
    return {
      ...this.state,
      rng: this.rand.s,
      stock: this.stock.slice(),
      toggles: { ...this.toggles },
      people: this.state.people.map((p) => {
        const q: Person = { ...p, wait: Number.isFinite(p.wait) ? Math.min(p.wait, 100) : 0 };
        // Routes and claims are not saved; anyone on the move starts again from standing.
        if (q.task !== 'sleep') q.task = 'idle';
        delete q.purpose;
        delete q.target;
        return q;
      }),
    };
  }
}
