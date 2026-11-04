import { Deposit, isWater } from '../map/terrain';
import { BASE_PRICE, BUILDINGS, BuildingKind, GOODS, footprint, type Good, type JobKind } from './buildings';
import { ADULT_AGE, MONTHS_PER_YEAR, TICKS_PER_MONTH, type Building, type Person, type Settlement } from './types';
import type { Towns } from './towns';
import type { World } from './world';

// Jobs, production, coins and trade (Stages 3b and 3c; SPEC 6 and 8).
//
// From the village stage on, a settlement's adults take jobs as tradesmen at its
// workplaces, and children from 8 take light jobs at farms and fishing huts. Workers make
// goods and carry them to the settlement's store (its storehouse, or its campfire while it
// has none), and are paid in coins from its treasury for what they bring (Caleb: coins;
// goods have prices; people are paid for work). Each settlement sets its own prices: a
// good costs more the scarcer it is there. People buy food from the store, and pottery
// for their homes; the very hungry are given food when they cannot pay. Blacksmiths make
// tools from iron ore (tools make workers quicker and wear out), potters dig clay and fire
// pottery, and a town's mint strikes coins from gold ore. Traders take what their
// settlement has too much of to whichever settlement within reach pays most, bring back
// what home lacks, and keep the difference. A person's coins and household goods are
// their wealth, passed to their pair and children when they die (SPEC 6).

/** Children this old and older can hold a light job. */
const LIGHT_JOB_AGE = 8;
/** How much growth one adult's step of tending gives a field (a child's gives half). About 2.5 harvests a year with two farmers. */
const TEND_GROWTH = 1 / 180;
/** How long a farmer stays in the field each time (they leave early when the field is ripe, or when very hungry or tired). */
const TEND_STEPS = 200;
const HARVEST_STEPS = 50;
const HARVEST_YIELD = 10;
/** Months a field grows in: March to November. */
const GROWING = (month: number) => month >= 2 && month <= 10;
const MINE_STEPS = 60;
const FISH_STEPS = 60;
const DIG_STEPS = 50;
const CRAFT_STEPS = 100;
/** How much a worker carries before taking it to the store. */
const LOAD_TARGET: Record<Good, number> = { food: 4, wood: 6, stone: 4, iron: 4, gold: 4, tools: 2, pottery: 4, clay: 4 };
const ORE_PER_TRIP = 2;
/** How far from their workplace gatherers go for trees, stone, ore, fish and clay. */
const JOB_RANGE: Partial<Record<JobKind, number>> = { woodcutter: 20, quarryman: 28, miner: 28, fisher: 14, potter: 25 };
/** How far from the store hungry people will walk to eat from it. */
const STORE_RANGE = 40;
/** Builders carry at most this much from the store at once. */
const FETCH_LOAD = 4;
/** When the store holds this much of what a worker makes, they stop making it for now (food: per person, plus a reserve). */
const STOCK_CAP: Record<Good, number> = { food: 3, wood: 80, stone: 60, iron: 40, gold: 40, tools: 20, pottery: 30, clay: 0 };
const FOOD_RESERVE = 30;
const JOB_GOOD: Partial<Record<JobKind, Good>> = { farmer: 'food', fisher: 'food', woodcutter: 'wood', quarryman: 'stone', miner: 'iron', smith: 'tools', potter: 'pottery' };
/** Workers are paid this share of what they bring is worth at the settlement's price; builders a coin per spell of work. */
const WAGE_SHARE = 0.6;
/** Coins a settlement is given when it becomes a village (standing for coins brought in from outside), plus some per person. */
const START_PURSE = 50;
const START_PURSE_PER_PERSON = 3;
/** Coins a mint strikes from one gold ore, and what the minter is paid for it. */
const COINS_PER_GOLD = 12;
const MINTER_WAGE = 2;
/** Inputs a workshop takes for one go, and what it gives. */
const SMITH_IRON = 2;
/** Chance a worker wears out one of the store's tools when they finish a piece of work; tools make work this much quicker. */
const TOOL_WEAR = 1 / 30;
const TOOL_SPEED = 1.5;
/** Traders go to settlements within this many tiles, and carry at most this much. */
const TRADE_RANGE = 90;
const TRADE_LOAD = 10;
/** Goods traders deal in. */
const TRADE_GOODS: Good[] = ['food', 'wood', 'stone', 'iron', 'gold', 'tools', 'pottery'];
/** Most household goods one person keeps. */
const MAX_GOODS = 6;
/** Coins an adult with a home pays their settlement each month. */
const RENT = 1;

export class Economy {
  private w: World;
  private t: Towns;
  private oreTiles: number[] = [];
  private goldTiles: number[] = [];
  private fishTiles: number[] = [];
  private stoneTiles: number[] = [];
  private clayTiles: number[] = [];

  constructor(w: World, t: Towns) {
    this.w = w;
    this.t = t;
    for (let i = 0; i < w.deposit.length; i++) {
      const d = w.deposit[i];
      if (d === Deposit.Iron || d === Deposit.Gold) this.oreTiles.push(i);
      if (d === Deposit.Gold) this.goldTiles.push(i);
      else if (d === Deposit.Fish) this.fishTiles.push(i);
      else if (d === Deposit.Stone) this.stoneTiles.push(i);
      else if (d === Deposit.Clay) this.clayTiles.push(i);
    }
    for (const s of t.settlements) this.stockOf(s);
  }

  stockOf(s: Settlement): Record<Good, number> {
    s.stock ??= {};
    for (const g of GOODS) s.stock[g] ??= 0;
    s.stock.clay ??= 0;
    s.coins ??= 0;
    return s.stock as Record<Good, number>;
  }

  private month() {
    return Math.floor(this.w.state.tick / TICKS_PER_MONTH) % MONTHS_PER_YEAR;
  }

  private ageOf(p: Person) {
    return this.w.ageOf(p);
  }

  // ---------------------------------------------------------------- coins and prices

  /** How much of a good a settlement wants to keep; prices rise below this and fall above it. */
  private target(s: Settlement, g: Good) {
    const people = Math.max(1, this.t.peopleOf(s));
    switch (g) {
      case 'food':
        return people * 2 + 10;
      case 'wood':
        return 40;
      case 'stone':
        return 30;
      case 'iron':
        return 16;
      case 'gold':
        return 8;
      case 'tools':
        return Math.max(4, Math.round(people / 4));
      case 'pottery':
        return Math.max(4, Math.round(people / 2));
      default:
        return 10;
    }
  }

  /** What a good costs in a settlement now: its usual price, up to three times higher when scarce, down to half when plentiful. */
  price(s: Settlement, g: Good) {
    const stock = this.stockOf(s)[g];
    const k = Math.max(0.5, Math.min(3, this.target(s, g) / (stock + 1)));
    return Math.round(BASE_PRICE[g] * k * 10) / 10;
  }

  prices(s: Settlement): Record<Good, number> {
    const out = {} as Record<Good, number>;
    for (const g of GOODS) out[g] = this.price(s, g);
    out.clay = BASE_PRICE.clay;
    return out;
  }

  /** Pays someone from a settlement's treasury, as much of `amount` as it holds. */
  pay(s: Settlement, p: Person, amount: number) {
    const n = Math.min(amount, s.coins ?? 0);
    if (n <= 0) return;
    s.coins = (s.coins ?? 0) - n;
    p.coins = (p.coins ?? 0) + n;
  }

  /** A person pays a settlement, as much of `amount` as they have. Returns what they paid. */
  private charge(p: Person, s: Settlement, amount: number) {
    const n = Math.min(amount, p.coins ?? 0);
    if (n <= 0) return 0;
    p.coins = (p.coins ?? 0) - n;
    s.coins = (s.coins ?? 0) + n;
    return n;
  }

  /** A settlement has just moved up a stage. */
  onStage(s: Settlement) {
    this.stockOf(s);
    if (s.stage === 'village') s.coins = (s.coins ?? 0) + START_PURSE + START_PURSE_PER_PERSON * this.t.peopleOf(s);
  }

  /** Wealth: coins plus household goods at their usual price. */
  wealthOf(p: Person) {
    return (p.coins ?? 0) + (p.goods ?? 0) * BASE_PRICE.pottery;
  }

  /** On death, coins and household goods pass to the pair, or else the children, or else the settlement (SPEC 6). */
  inherit(p: Person) {
    const coins = p.coins ?? 0;
    const goods = p.goods ?? 0;
    if (!coins && !goods) return;
    const w = this.w;
    // SPEC 6: passed to their pair and children, in equal shares.
    const pair = p.pair !== undefined ? w.byId.get(p.pair) : undefined;
    const heirs = w.state.people.filter((q) => q !== p && (q === pair || q.mother === p.id || q.father === p.id));
    if (heirs.length) {
      for (const h of heirs) h.coins = (h.coins ?? 0) + coins / heirs.length;
      heirs.forEach((h, k) => (h.goods = (h.goods ?? 0) + Math.floor(goods / heirs.length) + (k < goods % heirs.length ? 1 : 0)));
    } else if (p.settlement !== undefined) {
      const s = this.t.byId(p.settlement);
      if (s) {
        s.coins = (s.coins ?? 0) + coins;
        this.stockOf(s).pottery += goods;
      }
    }
    p.coins = 0;
    p.goods = 0;
  }

  /** Once a month for each person: adults with a home pay rent to their settlement; someone with coins to spare buys pottery for their home. */
  monthly(p: Person) {
    if (p.settlement === undefined || this.ageOf(p) < ADULT_AGE) return;
    const s = this.t.byId(p.settlement);
    if (!s) return;
    if (p.home !== undefined) this.charge(p, s, RENT);
    if ((p.goods ?? 0) >= MAX_GOODS) return;
    const st = this.stockOf(s);
    if (st.pottery <= 0) return;
    const cost = this.price(s, 'pottery');
    if ((p.coins ?? 0) < cost + 15) return;
    this.charge(p, s, cost);
    st.pottery--;
    p.goods = (p.goods ?? 0) + 1;
    this.t.settlementsChanged = true;
  }

  // ---------------------------------------------------------------- places

  /** The tile in front of a building's door (on its front-left side), where people go in and out. */
  doorTile(b: Building): number {
    const size = this.w.size;
    const { w, d } = footprint(b.kind, b.rot);
    const x0 = b.tile % size;
    const y0 = (b.tile - x0) / size;
    const x = x0 + Math.floor(w / 2);
    const y = y0 + d;
    if (y < size) {
      const t = y * size + x;
      if (!isWater(this.w.terrain[t]) && !this.t.buildingAt(t)) return t;
    }
    return b.tile;
  }

  /** Where a settlement keeps its goods: the storehouse nearest `near`, or its campfire. */
  storeTile(s: Settlement, near: number): number {
    let best = -1;
    let bestD = Infinity;
    for (const b of this.t.buildings) {
      if (b.settlement !== s.id || b.kind !== BuildingKind.Storehouse || b.progress < 1) continue;
      const d = this.t.dist2(b.tile, near);
      if (d < bestD) {
        bestD = d;
        best = this.doorTile(b);
      }
    }
    return best >= 0 ? best : s.center;
  }

  /** For a hungry person: their settlement's store, if it has food and is not too far. */
  foodStore(p: Person): number {
    if (p.settlement === undefined) return -1;
    const s = this.t.byId(p.settlement);
    if (!s || this.stockOf(s).food <= 0) return -1;
    // With no coins, only the very hungry go (to be given food).
    if ((p.coins ?? 0) < this.price(s, 'food') && p.food >= 25) return -1;
    const here = this.w.tileOf(p);
    const t = this.storeTile(s, here);
    return this.t.dist2(t, here) <= STORE_RANGE * STORE_RANGE ? t : -1;
  }

  // ---------------------------------------------------------------- jobs

  /** Once a month for a settlement: checks who works where, and gives open jobs to people without one. */
  assignJobs(s: Settlement) {
    const w = this.w;
    const places = this.t.buildings.filter((b) => b.settlement === s.id && b.progress >= 1 && BUILDINGS[b.kind].jobs > 0);
    const adults = new Map<number, number>();
    const kids = new Map<number, number>();
    const members = w.state.people.filter((p) => p.settlement === s.id);
    for (const p of members) {
      if (p.job === undefined) continue;
      const b = this.t.byBuildingId(p.job);
      if (!b || b.settlement !== s.id || b.progress < 1 || s.stage === 'camp') {
        this.quit(p);
        continue;
      }
      const child = this.ageOf(p) < ADULT_AGE;
      const m = child ? kids : adults;
      // A child who has come of age in a light job keeps it only if an adult place is open there.
      const n = m.get(b.id) ?? 0;
      if (n >= (child ? BUILDINGS[b.kind].lightJobs : BUILDINGS[b.kind].jobs) && p.tradeTo === undefined) {
        this.quit(p);
        continue;
      }
      m.set(b.id, n + 1);
    }
    // Camps have no formal jobs (Caleb: jobs begin at the village stage).
    if (s.stage === 'camp' || !places.length) return;
    for (const p of members) {
      if (p.job !== undefined || p.settleAt !== undefined) continue;
      const age = this.ageOf(p);
      const child = age < ADULT_AGE;
      if (child && age < LIGHT_JOB_AGE) continue;
      const near = p.home !== undefined ? (this.t.byBuildingId(p.home)?.tile ?? w.tileOf(p)) : w.tileOf(p);
      let best: Building | null = null;
      let bestD = Infinity;
      for (const b of places) {
        const def = BUILDINGS[b.kind];
        const open = child ? def.lightJobs - (kids.get(b.id) ?? 0) : def.jobs - (adults.get(b.id) ?? 0);
        if (open <= 0) continue;
        const d = this.t.dist2(b.tile, near);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (!best) continue;
      p.job = best.id;
      const m = child ? kids : adults;
      m.set(best.id, (m.get(best.id) ?? 0) + 1);
    }
  }

  quit(p: Person) {
    delete p.job;
    delete p.jobStep;
    delete p.tradeTo;
  }

  jobOf(p: Person): JobKind | undefined {
    if (p.job === undefined) return undefined;
    const b = this.t.byBuildingId(p.job);
    return b ? BUILDINGS[b.kind].job : undefined;
  }

  /** Jobs filled and offered in a settlement, adults with no job (in a village or bigger), and children in light jobs. */
  jobCounts(s: Settlement) {
    let offered = 0;
    let filled = 0;
    let light = 0;
    let jobless = 0;
    for (const b of this.t.buildings) if (b.settlement === s.id && b.progress >= 1) offered += BUILDINGS[b.kind].jobs;
    for (const p of this.w.state.people) {
      if (p.settlement !== s.id) continue;
      const child = this.ageOf(p) < ADULT_AGE;
      if (p.job !== undefined) {
        if (child) light++;
        else filled++;
      } else if (!child && s.stage !== 'camp') jobless++;
    }
    return { offered, filled, light, jobless };
  }

  /** Whether a settlement's store holds plenty of a good. */
  full(s: Settlement, g: Good | undefined) {
    if (!g) return false;
    const cap = g === 'food' ? this.t.peopleOf(s) * STOCK_CAP.food + FOOD_RESERVE : STOCK_CAP[g];
    return this.stockOf(s)[g] >= cap;
  }

  private hasTools(s: Settlement) {
    return this.stockOf(s).tools > 0;
  }

  /** A worker finished a piece of work: now and then they wear out one of the store's tools. */
  private wear(p: Person) {
    const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
    if (!s || !this.hasTools(s) || this.w.rand.next() > TOOL_WEAR) return;
    this.stockOf(s).tools--;
    this.t.settlementsChanged = true;
  }

  /** Steps for a piece of work: quicker with tools in the store. */
  private steps(p: Person, n: number) {
    const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
    return s && this.hasTools(s) ? Math.round(n / TOOL_SPEED) : n;
  }

  // ---------------------------------------------------------------- doing the job

  /** A person with a job and nothing more pressing works at it. Returns true if they did. */
  work(p: Person): boolean {
    const w = this.w;
    if (p.job === undefined) return false;
    const b = this.t.byBuildingId(p.job);
    if (!b || b.progress < 1) {
      this.quit(p);
      return false;
    }
    const s = b.settlement !== undefined ? this.t.byId(b.settlement) : undefined;
    if (!s) return false;
    const job = BUILDINGS[b.kind].job!;
    if (job === 'trader') return this.trade(p, b, s);
    if (job === 'smith' || job === 'minter' || job === 'potter') return this.make(p, b, s, job);
    // Carrying what they made: take it to the store.
    if (p.load && p.site === undefined) {
      if (p.load.n >= LOAD_TARGET[p.load.kind] || !this.canGather(b)) {
        w.goTo(p, this.storeTile(s, w.tileOf(p)), 'deliver');
        return true;
      }
    }
    const child = this.ageOf(p) < ADULT_AGE;
    // The store already holds plenty of what they make: other work (building) or rest for now.
    if (this.full(s, JOB_GOOD[job]) && !(b.output ?? 0)) return false;
    if (job === 'farmer') {
      if ((b.output ?? 0) > 0 && !child) {
        p.jobStep = 'collect';
        w.goTo(p, b.tile, 'job');
        return true;
      }
      if ((b.growth ?? 0) >= 1 && !child) {
        p.jobStep = 'harvest';
        w.goTo(p, this.fieldTile(b), 'job');
        return true;
      }
      if (!GROWING(this.month())) return false;
      p.jobStep = 'tend';
      w.goTo(p, this.fieldTile(b), 'job');
      return true;
    }
    const target = this.resourceFor(job, b);
    if (target < 0) return false;
    p.jobStep = 'gather';
    p.target = target;
    w.goTo(p, job === 'fisher' ? this.t.approach(target) : target, 'job');
    return true;
  }

  /** Workshops: blacksmiths fetch iron ore from the store; potters dig clay; minters fetch gold ore. Then they make their goods at the workshop. */
  private make(p: Person, b: Building, s: Settlement, job: JobKind): boolean {
    const w = this.w;
    const product: Good | null = job === 'smith' ? 'tools' : job === 'potter' ? 'pottery' : null;
    const input: Good = job === 'smith' ? 'iron' : job === 'potter' ? 'clay' : 'gold';
    if (p.load && p.load.kind === product) {
      w.goTo(p, this.storeTile(s, w.tileOf(p)), 'deliver');
      return true;
    }
    if (p.load && p.load.kind === input) {
      // A potter digs a full load before going to the wheel.
      if (job === 'potter' && p.load.n < LOAD_TARGET.clay && this.resourceFor('potter', b) >= 0) return this.digClay(p, b);
      p.jobStep = 'craft';
      w.goTo(p, this.doorTile(b), 'job');
      return true;
    }
    if (product && this.full(s, product)) return false;
    if (job === 'potter') return this.digClay(p, b);
    const need = job === 'smith' ? SMITH_IRON : 1;
    if (this.stockOf(s)[input] < need) return false;
    p.jobStep = 'fetch-input';
    w.goTo(p, this.storeTile(s, w.tileOf(p)), 'fetch');
    return true;
  }

  private digClay(p: Person, b: Building) {
    const t = this.resourceFor('potter', b);
    if (t < 0) return false;
    p.jobStep = 'gather';
    p.target = t;
    this.w.goTo(p, t, 'job');
    return true;
  }

  /** Traders: take surplus to the settlement within reach that pays most, and bring back what home lacks. */
  private trade(p: Person, b: Building, home: Settlement): boolean {
    const w = this.w;
    if (this.ageOf(p) < ADULT_AGE) return false;
    if (p.load && p.tradeTo !== undefined) {
      const dest = this.t.byId(p.tradeTo);
      if (dest && !dest.abandoned) {
        w.goTo(p, this.storeTile(dest, w.tileOf(p)), 'trade', true);
        return true;
      }
      delete p.tradeTo;
    }
    if (p.load) {
      w.goTo(p, this.storeTile(home, w.tileOf(p)), 'tradeHome', true);
      return true;
    }
    // Plan a run: the best margin for the load, against the distance.
    const hs = this.stockOf(home);
    let best: { dest: Settlement; g: Good; n: number } | null = null;
    let bestScore = 0;
    for (const dest of this.t.settlements) {
      if (dest === home || dest.abandoned || dest.stage === 'camp') continue;
      const dist = Math.sqrt(this.t.dist2(dest.center, home.center));
      if (dist > TRADE_RANGE) continue;
      for (const g of TRADE_GOODS) {
        const surplus = Math.floor(hs[g] - this.target(home, g));
        if (surplus < 3) continue;
        const margin = this.price(dest, g) - this.price(home, g);
        if (margin < 0.5) continue;
        const n = Math.min(TRADE_LOAD, surplus);
        const score = (margin * n) / (dist + 20);
        if (score > bestScore) {
          bestScore = score;
          best = { dest, g, n };
        }
      }
    }
    if (!best) return false;
    hs[best.g] -= best.n;
    p.load = { kind: best.g, n: best.n };
    // Provisions for the road, from the store.
    const food = Math.min(3 - p.carry, Math.floor(hs.food));
    if (food > 0) {
      hs.food -= food;
      p.carry += food;
    }
    p.tradeTo = best.dest.id;
    // What the trader owes home for the goods, paid when they come back.
    p.tradeOwed = best.n * this.price(home, best.g);
    this.t.settlementsChanged = true;
    w.goTo(p, this.storeTile(best.dest, w.tileOf(p)), 'trade', true);
    void b;
    return true;
  }

  private canGather(b: Building) {
    const job = BUILDINGS[b.kind].job;
    return job !== 'farmer' && job !== undefined && this.resourceFor(job, b) >= 0;
  }

  /** A random tile of a field. */
  private fieldTile(b: Building) {
    const tiles = this.t.tilesOf(b);
    return tiles[this.w.rand.int(tiles.length)];
  }

  /** The nearest tree, stone, ore, fish or clay to a workplace that still has something to take, or -1. */
  private resourceFor(job: JobKind, b: Building): number {
    const range = JOB_RANGE[job] ?? 20;
    const from = this.t.middleTile(b);
    if (job === 'woodcutter') return this.t.nearestTree(from, range);
    const list = job === 'quarryman' ? this.stoneTiles : job === 'miner' ? this.oreTiles : job === 'potter' ? this.clayTiles : job === 'fisher' ? this.fishTiles : null;
    if (!list) return -1;
    let best = -1;
    let bestD = range * range;
    for (const t of list) {
      if (this.w.stock[t] <= 0) continue;
      const d = this.t.dist2(t, from);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** Arriving somewhere for a job reason. Returns true if it was one. */
  arrive(p: Person, purpose: string | undefined): boolean {
    if (purpose === 'job') {
      const b = p.job !== undefined ? this.t.byBuildingId(p.job) : undefined;
      const step = p.jobStep;
      delete p.jobStep;
      if (!b) return true;
      const job = BUILDINGS[b.kind].job;
      if (step === 'tend') {
        p.task = 'farm';
        p.wait = TEND_STEPS;
      } else if (step === 'harvest') {
        p.task = 'harvest';
        p.wait = this.steps(p, HARVEST_STEPS);
      } else if (step === 'collect') {
        // A farmer carries a whole harvest's sheaves at once.
        const n = Math.min(HARVEST_YIELD, b.output ?? 0);
        if (n > 0) {
          b.output = (b.output ?? 0) - n;
          p.load = { kind: 'food', n };
          this.t.buildingsChanged = true;
        }
        this.done(p);
      } else if (step === 'craft') {
        p.task = 'craft';
        p.wait = this.steps(p, CRAFT_STEPS);
      } else if (step === 'gather') {
        if (job === 'woodcutter') {
          p.task = 'chop';
          p.wait = this.steps(p, 40);
        } else if (job === 'quarryman') {
          p.task = 'quarry';
          p.wait = this.steps(p, 50);
        } else if (job === 'miner') {
          p.task = 'mine';
          p.wait = this.steps(p, MINE_STEPS);
        } else if (job === 'potter') {
          p.task = 'dig';
          p.wait = this.steps(p, DIG_STEPS);
        } else {
          p.task = 'fish';
          p.wait = this.steps(p, FISH_STEPS);
        }
      }
      return true;
    }
    if (purpose === 'deliver') {
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (s && p.load) {
        this.stockOf(s)[p.load.kind] += p.load.n;
        // Paid for what they bring, at what it is worth here.
        if (p.job !== undefined) this.pay(s, p, p.load.n * this.price(s, p.load.kind) * WAGE_SHARE);
        this.t.settlementsChanged = true;
      }
      delete p.load;
      p.task = 'idle';
      p.wait = 5;
      return true;
    }
    if (purpose === 'fetch') {
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      const step = p.jobStep;
      delete p.jobStep;
      if (step === 'fetch-input') {
        // A blacksmith or minter at the store, taking ore for the workshop.
        const job = this.jobOf(p);
        const kind: Good = job === 'smith' ? 'iron' : 'gold';
        const need = job === 'smith' ? SMITH_IRON : 1;
        if (s && this.stockOf(s)[kind] >= need) {
          this.stockOf(s)[kind] -= need;
          p.load = { kind, n: need };
          this.t.settlementsChanged = true;
        }
        return this.done(p);
      }
      if (step === 'fetch-fence') {
        // A builder at the store, taking wood for the town's fence.
        const n = s ? Math.min(4, this.stockOf(s).wood) : 0;
        if (s && n > 0) {
          this.stockOf(s).wood -= n;
          p.load = { kind: 'wood', n };
          this.t.settlementsChanged = true;
        }
        return this.done(p);
      }
      // A builder at the store, taking wood, stone or tools for their site.
      const kind: Good = step === 'fetch-stone' ? 'stone' : step === 'fetch-tools' ? 'tools' : 'wood';
      const site = p.site !== undefined ? this.t.byBuildingId(p.site) : undefined;
      if (s && site && site.progress < 1) {
        const def = BUILDINGS[site.kind];
        const need = kind === 'wood' ? def.wood - site.wood : kind === 'stone' ? def.stone - site.stone : (def.tools ?? 0) - (site.tools ?? 0);
        const n = Math.min(FETCH_LOAD, Math.max(1, need), this.stockOf(s)[kind]);
        if (n > 0) {
          this.stockOf(s)[kind] -= n;
          p.load = { kind, n };
          this.t.settlementsChanged = true;
        } else delete p.site;
      } else delete p.site;
      return this.done(p);
    }
    if (purpose === 'store') {
      // Hungry, at the store: buy food to eat (and a little to carry); given one if very hungry and unable to pay.
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (s) {
        const st = this.stockOf(s);
        const cost = this.price(s, 'food');
        let n = Math.min(3 - p.carry, st.food, Math.floor((p.coins ?? 0) / cost));
        if (n > 0) this.charge(p, s, n * cost);
        else if (p.food < 25 && st.food > 0) n = 1;
        n = Math.max(0, n);
        st.food -= n;
        p.carry += n;
        if (n) this.t.settlementsChanged = true;
      }
      p.task = p.carry > 0 ? 'eat' : 'idle';
      p.wait = p.carry > 0 ? 10 : 0;
      return true;
    }
    if (purpose === 'trade') {
      // A trader at another settlement's store: sell the load there, and buy something home lacks.
      const dest = p.tradeTo !== undefined ? this.t.byId(p.tradeTo) : undefined;
      const home = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      delete p.tradeTo;
      if (dest && p.load) {
        const g = p.load.kind;
        const ds = this.stockOf(dest);
        this.pay(dest, p, p.load.n * this.price(dest, g));
        ds[g] += p.load.n;
        delete p.load;
        if (home) {
          let best: Good | null = null;
          let bestMargin = 0.5;
          for (const g2 of TRADE_GOODS) {
            if (ds[g2] - this.target(dest, g2) < 3) continue;
            const m = this.price(home, g2) - this.price(dest, g2);
            if (m > bestMargin) {
              bestMargin = m;
              best = g2;
            }
          }
          if (best) {
            const cost = this.price(dest, best);
            const n = Math.min(TRADE_LOAD, Math.floor(ds[best] - this.target(dest, best)), Math.floor((p.coins ?? 0) / cost));
            if (n > 0) {
              this.charge(p, dest, n * cost);
              ds[best] -= n;
              p.load = { kind: best, n };
            }
          }
        }
        this.t.settlementsChanged = true;
      }
      p.task = 'trade';
      p.wait = 40;
      return true;
    }
    if (purpose === 'tradeHome') {
      // Back home: sell what they brought to the store, and pay home for what they took out.
      const home = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (home) {
        if (p.load) {
          this.stockOf(home)[p.load.kind] += p.load.n;
          this.pay(home, p, p.load.n * this.price(home, p.load.kind));
          delete p.load;
        }
        if (p.tradeOwed !== undefined) this.charge(p, home, p.tradeOwed);
        delete p.tradeOwed;
        this.t.settlementsChanged = true;
      }
      p.task = 'trade';
      p.wait = 30;
      return true;
    }
    return false;
  }

  /** Job tasks, step by step. Returns true if the person is doing one. */
  tick(p: Person): boolean {
    const w = this.w;
    if (p.task === 'farm') {
      const b = p.job !== undefined ? this.t.byBuildingId(p.job) : undefined;
      if (!b) return this.done(p);
      if (GROWING(this.month()) && (b.growth ?? 0) < 1) {
        const before = this.cropLook(b);
        const s = b.settlement !== undefined ? this.t.byId(b.settlement) : undefined;
        const tool = s && this.hasTools(s) ? TOOL_SPEED : 1;
        b.growth = Math.min(1, (b.growth ?? 0) + TEND_GROWTH * tool * (this.ageOf(p) < ADULT_AGE ? 0.5 : 1));
        if (this.cropLook(b) !== before) this.t.buildingsChanged = true;
      }
      // Very hungry or tired: stop and see to it.
      if (--p.wait <= 0 || (b.growth ?? 0) >= 1 || p.food < 20 || p.rest < 10) {
        this.wear(p);
        return this.done(p);
      }
      return true;
    }
    if (p.task === 'harvest') {
      if (--p.wait > 0) return true;
      const b = p.job !== undefined ? this.t.byBuildingId(p.job) : undefined;
      if (b && (b.growth ?? 0) >= 1) {
        b.growth = 0;
        b.output = (b.output ?? 0) + HARVEST_YIELD;
        this.t.buildingsChanged = true;
      }
      this.wear(p);
      return this.done(p);
    }
    if (p.task === 'mine' || p.task === 'fish' || p.task === 'dig') {
      if (--p.wait > 0) return true;
      const t = p.target;
      delete p.target;
      if (t !== undefined && w.stock[t] > 0) {
        const kind: Good = p.task === 'fish' ? 'food' : p.task === 'dig' ? 'clay' : w.deposit[t] === Deposit.Gold ? 'gold' : 'iron';
        const take = Math.min(w.stock[t], p.task === 'fish' ? (this.ageOf(p) < ADULT_AGE ? 1 : 2) : ORE_PER_TRIP);
        w.stock[t] -= take;
        if (w.stock[t] === 0) w.tileEmptied(t);
        if (p.load && p.load.kind === kind) p.load.n += take;
        else p.load = { kind, n: take };
      }
      this.wear(p);
      return this.done(p);
    }
    if (p.task === 'craft') {
      if (--p.wait > 0) return true;
      const job = this.jobOf(p);
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (p.load && job === 'smith' && p.load.kind === 'iron') p.load = { kind: 'tools', n: 1 };
      else if (p.load && job === 'potter' && p.load.kind === 'clay') p.load = { kind: 'pottery', n: p.load.n };
      else if (p.load && job === 'minter' && p.load.kind === 'gold') {
        // The mint is the settlement's: the coins go straight into its treasury.
        if (s) {
          s.coins = (s.coins ?? 0) + COINS_PER_GOLD * p.load.n;
          this.pay(s, p, MINTER_WAGE * p.load.n);
          this.t.settlementsChanged = true;
        }
        delete p.load;
      }
      this.wear(p);
      return this.done(p);
    }
    if (p.task === 'trade') {
      if (--p.wait > 0) return true;
      return this.done(p);
    }
    return false;
  }

  private done(p: Person) {
    p.task = 'idle';
    p.wait = 2;
    return true;
  }

  /** A farm's look for drawing: 0 bare, 1 shoots, 2 green, 3 ripe; plus 4 with sheaves waiting. */
  cropLook(b: Building) {
    const g = b.growth ?? 0;
    const crop = g >= 1 ? 3 : g >= 0.55 ? 2 : g >= 0.15 ? 1 : 0;
    return crop + ((b.output ?? 0) > 0 ? 4 : 0);
  }

  /** Someone carrying goods with no job to take them for (they lost it on the way): to the store with them. */
  deliver(p: Person): boolean {
    if (!p.load || p.site !== undefined) return false;
    const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
    if (!s) {
      delete p.load;
      return false;
    }
    this.w.goTo(p, this.storeTile(s, this.w.tileOf(p)), 'deliver');
    return true;
  }

  // ---------------------------------------------------------------- what a village builds

  /**
   * The workplaces a settlement (village or bigger) should build next, best first: farms or a
   * fishing hut while its food does not keep up with its people; a woodcutter's lodge,
   * quarry and mine when there are trees, stone and ore near and it has none; then a
   * market, smithy and pottery as it grows, and a mint once it is a town.
   */
  nextWorkplaces(s: Settlement, people: number, mine: Building[]): { kind: BuildingKind; test: (anchor: number, w: number, d: number) => boolean }[] {
    if (s.stage === 'camp') return [];
    const count = (k: BuildingKind) => mine.filter((b) => b.kind === k).length;
    const farms = count(BuildingKind.Farm);
    const fishing = count(BuildingKind.FishingHut);
    // What its farms and fishing huts feed, reckoned low (farmers also build, and nothing grows in winter), with a margin.
    // An agrarian culture reckons lower still, so it keeps more fields (Stage 4a).
    const traits = this.w.cultures?.traitsOf(s);
    const fed = farms * (traits?.livelihood === 'agrarian' ? 10 : 12) + fishing * 8;
    const st = this.stockOf(s);
    const food = st.food;
    const wantFood = (fed < people * 1.2 && food < people * 2) || food < people;
    const center = s.center;
    const near = (list: number[], r: number) => list.some((t) => this.w.stock[t] > 0 && this.t.dist2(t, center) <= r * r);
    const fishNear = near(this.fishTiles, 26);
    const hasStore = mine.some((b) => b.kind === BuildingKind.Storehouse);
    const options: { kind: BuildingKind; test: (anchor: number, w: number, d: number) => boolean }[] = [];
    const any = () => true;
    const foodOption = () => {
      if (wantFood) {
        options.push({ kind: BuildingKind.Farm, test: any });
        if (fishNear && fishing < Math.max(1, Math.floor(people / 25))) options.push({ kind: BuildingKind.FishingHut, test: (a, w, d) => this.shoreSpot(a, w, d) && this.nearList(this.fishTiles, a, 14) });
      }
    };
    const goodsOption = () => {
      if (!count(BuildingKind.Woodcutter) && this.t.nearestTree(center, 22) >= 0) options.push({ kind: BuildingKind.Woodcutter, test: (a) => this.t.nearestTree(a, 16) >= 0 });
      if (!count(BuildingKind.Quarry) && near(this.stoneTiles, 30)) options.push({ kind: BuildingKind.Quarry, test: (a) => this.nearList(this.stoneTiles, a, 22) });
      if (!count(BuildingKind.Mine) && near(this.oreTiles, 30) && hasStore) options.push({ kind: BuildingKind.Mine, test: (a) => this.nearList(this.oreTiles, a, 22) });
    };
    const tradeOption = () => {
      if (!hasStore) return;
      if (!count(BuildingKind.Smithy) && (st.iron >= 4 || count(BuildingKind.Mine))) options.push({ kind: BuildingKind.Smithy, test: any });
      if (!count(BuildingKind.Pottery) && people >= 20 && near(this.clayTiles, 28)) options.push({ kind: BuildingKind.Pottery, test: (a) => this.nearList(this.clayTiles, a, 22) });
      const neighbor = this.t.settlements.some((o) => o !== s && !o.abandoned && o.stage !== 'camp' && this.t.dist2(o.center, center) <= TRADE_RANGE * TRADE_RANGE);
      // A mercantile culture builds its market sooner (Stage 4a).
      if (!count(BuildingKind.Market) && people >= (traits?.livelihood === 'mercantile' ? 15 : 25) && neighbor) options.push({ kind: BuildingKind.Market, test: any });
      if ((s.stage === 'town' || s.stage === 'city') && !count(BuildingKind.Mint) && (st.gold >= 3 || near(this.goldTiles, 30))) options.push({ kind: BuildingKind.Mint, test: any });
    };
    // When many adults have no work, a growing settlement adds more of the workplaces it already has.
    const coming = mine.reduce((n, b) => n + (b.progress < 1 ? BUILDINGS[b.kind].jobs : 0), 0);
    const spare = this.jobCounts(s).jobless - coming;
    const moreOption = () => {
      if (spare < 4) return;
      const cap = 1 + Math.floor(people / 40);
      const workshopCap = 1 + Math.floor(people / 80);
      const more = (k: BuildingKind, max: number) => count(k) > 0 && count(k) < max;
      if (more(BuildingKind.Woodcutter, cap) && this.t.nearestTree(center, 22) >= 0) options.push({ kind: BuildingKind.Woodcutter, test: (a) => this.t.nearestTree(a, 16) >= 0 });
      if (more(BuildingKind.Quarry, cap) && near(this.stoneTiles, 30)) options.push({ kind: BuildingKind.Quarry, test: (a) => this.nearList(this.stoneTiles, a, 22) });
      if (more(BuildingKind.Mine, cap) && near(this.oreTiles, 30)) options.push({ kind: BuildingKind.Mine, test: (a) => this.nearList(this.oreTiles, a, 22) });
      if (more(BuildingKind.Smithy, workshopCap)) options.push({ kind: BuildingKind.Smithy, test: any });
      if (more(BuildingKind.Pottery, workshopCap) && near(this.clayTiles, 28)) options.push({ kind: BuildingKind.Pottery, test: (a) => this.nearList(this.clayTiles, a, 22) });
      if (!wantFood && !this.full(s, 'food')) options.push({ kind: BuildingKind.Farm, test: any });
    };
    // Focus decides what comes first; balanced puts food first only when food is short.
    if (s.focus === 'goods') {
      goodsOption();
      tradeOption();
      foodOption();
    } else if (s.focus === 'food' || food < people) {
      foodOption();
      goodsOption();
      tradeOption();
    } else {
      goodsOption();
      foodOption();
      tradeOption();
    }
    moreOption();
    return options;
  }

  private nearList(list: number[], from: number, r: number) {
    return list.some((t) => this.w.stock[t] > 0 && this.t.dist2(t, from) <= r * r);
  }

  /** Whether a footprint has a tile beside water. */
  shoreSpot(anchor: number, fw: number, fd: number) {
    const size = this.w.size;
    const x0 = anchor % size;
    const y0 = (anchor - x0) / size;
    for (let y = y0 - 1; y <= y0 + fd; y++) {
      for (let x = x0 - 1; x <= x0 + fw; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const inside = x >= x0 && x < x0 + fw && y >= y0 && y < y0 + fd;
        if (!inside && isWater(this.w.terrain[y * size + x])) return true;
      }
    }
    return false;
  }
}
