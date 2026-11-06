import { Deposit, Terrain, isWater } from '../map/terrain';
import { BASE_PRICE, BUILDINGS, BuildingKind, GOODS, footprint, type Good, type JobKind } from './buildings';
import { RECIPES } from './military';
import { ADULT_AGE, MONTHS_PER_YEAR, TICKS_PER_MONTH, TICKS_PER_YEAR, type Building, type Person, type Settlement } from './types';
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
const LOAD_TARGET: Record<Good, number> = { food: 4, wood: 6, stone: 4, iron: 4, gold: 4, tools: 2, pottery: 4, clay: 4, spear: 1, sword: 1, bow: 1, crossbow: 1, mail: 1, plate: 1, horse: 1, engine: 1 };
const ORE_PER_TRIP = 2;
/** How far from their workplace gatherers go for trees, stone, ore, fish and clay. */
const JOB_RANGE: Partial<Record<JobKind, number>> = { woodcutter: 20, quarryman: 28, miner: 28, fisher: 14, potter: 25 };
/** How far from the store hungry people will walk to eat from it. */
const STORE_RANGE = 40;
/** Builders carry at most this much from the store at once. */
const FETCH_LOAD = 4;
/** When the store holds this much of what a worker makes, they stop making it for now (food: per person, plus a reserve). */
const STOCK_CAP: Record<Good, number> = { food: 3, wood: 80, stone: 60, iron: 40, gold: 40, tools: 20, pottery: 30, clay: 0, spear: 20, sword: 20, bow: 20, crossbow: 20, mail: 20, plate: 20, horse: 15, engine: 6 };
const FOOD_RESERVE = 30;
const JOB_GOOD: Partial<Record<JobKind, Good>> = { farmer: 'food', fisher: 'food', woodcutter: 'wood', quarryman: 'stone', miner: 'iron', smith: 'tools', potter: 'pottery' };
/** Workers are paid this share of what they bring is worth at the settlement's price; builders a coin per spell of work. */
const WAGE_SHARE = 0.6;
/** Coins a settlement is given when it becomes a village, and for each person it gains past its most so far (standing for coins brought in from outside; Caleb: coins were too sparse). */
const START_PURSE = 50;
const COINS_PER_NEWCOMER = 10;
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
/** Coins a tradesman is paid each month from the treasury besides what they are paid for what they bring (a child in a light job, half); soldiers, officials and traders are paid their own ways (Caleb: coins were too sparse). */
const MONTHLY_WAGE = 2;
const NO_MONTHLY_WAGE = new Set<JobKind>(['soldier', 'official', 'trader']);
/** Officials tax settlements of their nation within this many tiles of their hall, at most twice a year each. */
const TAX_RANGE = 100;
/** Shares of taxes collected that go to the official who carried them and to the ruler (the rest to the nation's treasury). */
const OFFICIAL_SHARE = 0.1;
/** What a scholar is paid for a spell of study. */
const SCHOLAR_WAGE = 2;
/** Ages at which people serve as soldiers, and what a nation's treasury needs for volunteers to enlist. */
const SOLDIER_AGE = [16, 45];
/** A settlement this big on a coast builds a dock, once it knows boatbuilding. */
const DOCK_PEOPLE = 20;
const VOLUNTEER_TREASURY = 12;
const SOLDIER_SHARE = 0.15;
/** Workplaces that call workers from ordinary work when they have open places. */
const CALLING: BuildingKind[] = [BuildingKind.Hall, BuildingKind.Scriptorium, BuildingKind.University];
const RULER_SHARE = 0.1;

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
    // Goods its culture's research needs are wanted more (Caleb after Stage 5: they should reach research).
    return this.baseTarget(s, g) + (this.w.tech?.wanted(s)[g] ?? 0) * 2;
  }

  private baseTarget(s: Settlement, g: Good) {
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
    if (s.stage === 'village') s.coins = (s.coins ?? 0) + START_PURSE;
  }

  /**
   * Once a month: a village or bigger that has more people than ever before gets coins for each
   * of them into its treasury, so the coins in a settlement keep pace with its people.
   */
  newcomersCoins(s: Settlement, people: number) {
    if (s.stage === 'camp' || people <= (s.funded ?? 0)) return;
    s.coins = (s.coins ?? 0) + COINS_PER_NEWCOMER * (people - (s.funded ?? 0));
    s.funded = people;
    this.t.settlementsChanged = true;
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

  /** Once a month for each person: tradesmen are paid a wage; adults with a home pay rent to their settlement; someone with coins to spare buys pottery for their home. */
  monthly(p: Person) {
    if (p.settlement === undefined) return;
    const s = this.t.byId(p.settlement);
    if (!s) return;
    const job = this.jobOf(p);
    if (job && !NO_MONTHLY_WAGE.has(job)) this.pay(s, p, this.ageOf(p) < ADULT_AGE ? MONTHLY_WAGE / 2 : MONTHLY_WAGE);
    if (this.ageOf(p) < ADULT_AGE) return;
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
    // Soldiers (Stage 5): a levy fills the barracks before other work; volunteers enlist only while
    // the nation's treasury can pay them (the conscription policy, 4b).
    const n = s.nation !== undefined ? w.nations.byId.get(s.nation) : undefined;
    const levy = n?.policies.conscription === 'levy';
    const enlist = !!n && (levy || n.coins + (s.coins ?? 0) >= VOLUNTEER_TREASURY);
    // No more than a share of its people serve, so its work goes on.
    let room = Math.floor(members.length * SOLDIER_SHARE) - members.filter((p) => p.soldier || this.jobOf(p) === 'soldier').length;
    for (const p of members) {
      if (p.job !== undefined || p.settleAt !== undefined || p.soldier) continue;
      const age = this.ageOf(p);
      const child = age < ADULT_AGE;
      if (child && age < LIGHT_JOB_AGE) continue;
      const near = p.home !== undefined ? (this.t.byBuildingId(p.home)?.tile ?? w.tileOf(p)) : w.tileOf(p);
      const fit = age >= SOLDIER_AGE[0] && age <= SOLDIER_AGE[1] && enlist;
      let best: Building | null = null;
      let bestD = Infinity;
      for (const b of places) {
        const def = BUILDINGS[b.kind];
        const barracks = b.kind === BuildingKind.Barracks;
        if (barracks && (!fit || room <= 0)) continue;
        const open = child ? def.lightJobs - (kids.get(b.id) ?? 0) : def.jobs - (adults.get(b.id) ?? 0);
        if (open <= 0) continue;
        const d = barracks && levy ? -1 : this.t.dist2(b.tile, near);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (!best) continue;
      p.job = best.id;
      if (best.kind === BuildingKind.Barracks) room--;
      const m = child ? kids : adults;
      m.set(best.id, (m.get(best.id) ?? 0) + 1);
    }
    // A hall, scriptorium or university with open places draws one worker a month from ordinary
    // work (otherwise they stay empty once everyone has a job): first from work whose goods the
    // store has plenty of, food last.
    for (const b of places) {
      if (!CALLING.includes(b.kind) || BUILDINGS[b.kind].jobs - (adults.get(b.id) ?? 0) <= 0) continue;
      let donor: Person | null = null;
      let score = -Infinity;
      for (const p of members) {
        if (p.job === undefined || p.tradeTo !== undefined || p.soldier || this.ageOf(p) < ADULT_AGE) continue;
        const at = this.t.byBuildingId(p.job);
        if (!at || CALLING.includes(at.kind) || at.kind === BuildingKind.Barracks || at.kind === BuildingKind.Market) continue;
        const job = BUILDINGS[at.kind].job;
        const g = job ? JOB_GOOD[job] : undefined;
        const sc = (this.full(s, g) ? 2 : 0) - (g === 'food' ? 1 : 0) + w.rand.next() * 0.5;
        if (sc > score) {
          score = sc;
          donor = p;
        }
      }
      if (!donor) continue;
      const old = donor.job!;
      this.quit(donor);
      adults.set(old, (adults.get(old) ?? 1) - 1);
      donor.job = b.id;
      adults.set(b.id, (adults.get(b.id) ?? 0) + 1);
    }
    // Barracks still short: a levy calls up fit adults from other work; volunteers now and then
    // leave other work to enlist. Officials, scholars and traders on a run stay.
    if (!enlist) return;
    for (const b of places) {
      if (b.kind !== BuildingKind.Barracks) continue;
      let open = Math.min(room, BUILDINGS[b.kind].jobs - (adults.get(b.id) ?? 0));
      if (open <= 0) continue;
      for (const p of members) {
        if (open <= 0) break;
        const age = this.ageOf(p);
        if (p.soldier || p.job === b.id || p.tradeTo !== undefined || p.settleAt !== undefined || age < SOLDIER_AGE[0] || age > SOLDIER_AGE[1]) continue;
        const job = this.jobOf(p);
        if (job === 'official' || job === 'scholar' || job === 'soldier' || w.nations.rulers.has(p.id)) continue;
        if (!levy && w.rand.next() > 0.3) continue;
        if (p.job !== undefined) {
          const old = p.job;
          this.quit(p);
          adults.set(old, (adults.get(old) ?? 1) - 1);
        }
        p.job = b.id;
        adults.set(b.id, (adults.get(b.id) ?? 0) + 1);
        open--;
        room--;
      }
    }
  }

  quit(p: Person) {
    delete p.job;
    delete p.jobStep;
    delete p.tradeTo;
    delete p.making;
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
  /** What a trader carries: half again as much with banking (Stage 4c). */
  private tradeLoad(s: Settlement) {
    return this.w.tech.has(s, 'banking') ? Math.round(TRADE_LOAD * 1.5) : TRADE_LOAD;
  }

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
    if (job === 'official') return this.official(p, b, s);
    if (job === 'scholar') {
      if (this.ageOf(p) < ADULT_AGE) return false;
      p.jobStep = 'study';
      w.goTo(p, this.doorTile(b), 'job');
      return true;
    }
    if (job === 'smith' || job === 'minter' || job === 'potter') return this.make(p, b, s, job);
    if (job === 'armorer' || job === 'groom') return this.makeArms(p, b, s);
    // Hunters and herders: see creatures.ts (Stage 6).
    if (job === 'hunter' || job === 'herder') return this.w.creatures.work(p, b, s);
    // Soldiers' days are the military's (see Military.soldierWork).
    if (job === 'soldier') return false;
    // Carrying what they made: take it to the store.
    if (p.load && p.site === undefined) {
      if (p.load.n >= LOAD_TARGET[p.load.kind] || !this.canGather(b)) {
        w.goTo(p, this.storeTile(s, w.tileOf(p)), 'deliver');
        return true;
      }
    }
    const child = this.ageOf(p) < ADULT_AGE;
    // The store already holds plenty of what they make: other work (building) or rest for now.
    // (Miners: plenty of every ore they could dig.)
    const plenty = job === 'miner' ? this.full(s, 'iron') && (this.full(s, 'gold') || this.oreNear(b, 'gold') < 0) : this.full(s, JOB_GOOD[job]);
    if (plenty && !(b.output ?? 0)) return false;
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

  /** Officials (Caleb: they collect taxes): go to the settlement of their nation most overdue, take its share, and carry it back to the hall. */
  private official(p: Person, b: Building, home: Settlement): boolean {
    const w = this.w;
    if (this.ageOf(p) < ADULT_AGE) return false;
    if (p.taxCoins) {
      w.goTo(p, this.doorTile(b), 'taxHome', true);
      return true;
    }
    const n = home.nation !== undefined ? w.nations.byId.get(home.nation) : undefined;
    if (!n) return false;
    const tick = w.state.tick;
    const taken = new Set<number>();
    for (const q of w.state.people) if (q !== p && q.taxFrom !== undefined) taken.add(q.taxFrom);
    let best: Settlement | null = null;
    let bestDue = 0;
    for (const s of w.nations.settlementsOf(n)) {
      if (taken.has(s.id) || (s.coins ?? 0) < 5) continue;
      const since = tick - (s.taxedAt ?? s.founded);
      if (since < TICKS_PER_YEAR / 2 || this.t.dist2(s.center, b.tile) > TAX_RANGE * TAX_RANGE) continue;
      const due = (Math.min(since, TICKS_PER_YEAR) / TICKS_PER_YEAR) * (s.coins ?? 0);
      if (due > bestDue) {
        bestDue = due;
        best = s;
      }
    }
    if (!best) return false;
    p.taxFrom = best.id;
    w.goTo(p, this.storeTile(best, w.tileOf(p)), 'tax', true);
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

  /**
   * Armorers and grooms (Stage 5: arms made as goods, Caleb): take the makings of whatever their
   * nation's soldiers here lack most from the store, make it at the armory or stable, and carry
   * it back to the store, where soldiers fetch it.
   */
  private makeArms(p: Person, b: Building, s: Settlement): boolean {
    const w = this.w;
    if (this.ageOf(p) < ADULT_AGE) return false;
    if (p.load && p.making) {
      p.jobStep = 'craft';
      w.goTo(p, this.doorTile(b), 'job');
      return true;
    }
    if (p.load) {
      w.goTo(p, this.storeTile(s, w.tileOf(p)), 'deliver');
      return true;
    }
    const g = w.military.nextArms(s, b.kind);
    if (!g) return false;
    p.making = g;
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
      if (dest === home || dest.abandoned || dest.stage === 'camp' || !this.w.nations.canTrade(home, dest)) continue;
      const dist = Math.sqrt(this.t.dist2(dest.center, home.center));
      if (dist > TRADE_RANGE) continue;
      for (const g of TRADE_GOODS) {
        const surplus = Math.floor(hs[g] - this.target(home, g));
        if (surplus < 3) continue;
        const margin = this.price(dest, g) - this.price(home, g);
        if (margin < 0.5) continue;
        const n = Math.min(this.tradeLoad(home), surplus);
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
    if (job === 'woodcutter') return this.t.nearestTree(from, range, b.settlement);
    if (job === 'miner') {
      // The ore the settlement needs more: gold when it is wanted (research, a mint) or short, else iron.
      const s = b.settlement !== undefined ? this.t.byId(b.settlement) : undefined;
      const gold = this.oreNear(b, 'gold');
      const iron = this.oreNear(b, 'iron');
      if (!s) return iron >= 0 ? iron : gold;
      const st = this.stockOf(s);
      const want = this.w.tech?.wanted(s) ?? {};
      const goldFirst = gold >= 0 && ((want.gold ?? 0) > st.gold || this.full(s, 'iron') || st.gold / STOCK_CAP.gold < st.iron / STOCK_CAP.iron);
      return goldFirst ? gold : iron >= 0 ? iron : gold;
    }
    const list = job === 'quarryman' ? this.stoneTiles : job === 'potter' ? this.clayTiles : job === 'fisher' ? this.fishTiles : null;
    if (!list) return -1;
    let best = -1;
    let bestD = range * range;
    const fromLand = this.w.finder.land(from);
    for (const t of list) {
      if (this.w.stock[t] <= 0 || !this.w.finder.reachable(fromLand, t) || (b.settlement !== undefined && !this.t.canWalk(b.settlement, t))) continue;
      const d = this.t.dist2(t, from);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** The nearest iron or gold ore deposit with ore left within a mine's reach, or -1. */
  private oreNear(b: Building, kind: 'iron' | 'gold'): number {
    const range = JOB_RANGE.miner ?? 20;
    const from = this.t.middleTile(b);
    let best = -1;
    let bestD = range * range;
    const fromLand = this.w.finder.land(from);
    for (const t of kind === 'gold' ? this.goldTiles : this.oreTiles) {
      if (this.w.stock[t] <= 0 || (kind === 'iron' && this.w.deposit[t] !== Deposit.Iron) || !this.w.finder.reachable(fromLand, t) || (b.settlement !== undefined && !this.t.canWalk(b.settlement, t))) continue;
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
        const n = Math.min(HARVEST_YIELD + 2, b.output ?? 0);
        if (n > 0) {
          b.output = (b.output ?? 0) - n;
          p.load = { kind: 'food', n };
          this.t.buildingsChanged = true;
        }
        this.done(p);
      } else if (step === 'craft') {
        p.task = 'craft';
        // Guilds make workshops quicker (Stage 4c).
        p.wait = this.steps(p, Math.round(CRAFT_STEPS * (this.w.tech.has(this.t.byId(b.settlement ?? -1), 'guilds') ? 0.8 : 1)));
      } else if (step === 'study') {
        p.task = 'study';
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
      if (step === 'fetch-gear') {
        // A soldier at the store, taking the arms their part in the army calls for.
        if (s) this.w.military.takeGear(p, s);
        return this.done(p);
      }
      if (step === 'fetch-input' && p.making) {
        // An armorer or groom at the store, taking the makings of arms (or a horse).
        const recipe = RECIPES[p.making] ?? {};
        const st = s ? this.stockOf(s) : undefined;
        if (st && Object.entries(recipe).every(([g, n]) => st[g as Good] >= (n ?? 0))) {
          let total = 0;
          for (const [g, n] of Object.entries(recipe)) {
            st[g as Good] -= n ?? 0;
            total += n ?? 0;
          }
          p.load = { kind: recipe.iron ? 'iron' : recipe.wood ? 'wood' : 'food', n: total };
          this.t.settlementsChanged = true;
        } else delete p.making;
        return this.done(p);
      }
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
      if (step === 'fetch-pave') {
        // A builder at the store, taking stone for paving.
        const n = s ? Math.min(4, this.stockOf(s).stone) : 0;
        if (s && n > 0) {
          this.stockOf(s).stone -= n;
          p.load = { kind: 'stone', n };
          this.t.settlementsChanged = true;
        }
        return this.done(p);
      }
      if (step === 'fetch-bridge') {
        // A builder at the store, taking wood for a bridge.
        const n = s ? Math.min(4, this.stockOf(s).wood) : 0;
        if (s && n > 0) {
          this.stockOf(s).wood -= n;
          p.load = { kind: 'wood', n };
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
        // Someone hungry who cannot pay is given a meal (treasuries run dry, and nobody starves beside a full store).
        else if (st.food > 0) n = 1;
        n = Math.max(0, n);
        st.food -= n;
        p.carry += n;
        if (n) this.t.settlementsChanged = true;
      }
      p.task = p.carry > 0 ? 'eat' : 'idle';
      p.wait = p.carry > 0 ? 10 : 0;
      return true;
    }
    if (purpose === 'tax') {
      // An official at a settlement's store: its share for the nation (a tenth or a quarter of its treasury a year).
      const s = p.taxFrom !== undefined ? this.t.byId(p.taxFrom) : undefined;
      delete p.taxFrom;
      if (s && !s.abandoned) {
        const tick = this.w.state.tick;
        const since = Math.min(TICKS_PER_YEAR, tick - (s.taxedAt ?? s.founded));
        const amount = Math.floor((s.coins ?? 0) * this.w.nations.taxRate(s) * (since / TICKS_PER_YEAR));
        if (amount > 0) {
          s.coins = (s.coins ?? 0) - amount;
          p.taxCoins = (p.taxCoins ?? 0) + amount;
        }
        s.taxedAt = tick;
        this.t.settlementsChanged = true;
      }
      p.task = 'idle';
      p.wait = 10;
      return true;
    }
    if (purpose === 'taxHome') {
      // Back at the hall: the taxes go into the nation's treasury; the official and the ruler take their shares.
      const coins = p.taxCoins ?? 0;
      delete p.taxCoins;
      const home = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      const n = home?.nation !== undefined ? this.w.nations.byId.get(home.nation) : undefined;
      if (n && coins > 0) {
        const wage = coins * OFFICIAL_SHARE;
        const ruler = n.ruler !== undefined ? this.w.byId.get(n.ruler) : undefined;
        const stipend = ruler ? coins * RULER_SHARE : 0;
        p.coins = (p.coins ?? 0) + wage;
        if (ruler) ruler.coins = (ruler.coins ?? 0) + stipend;
        n.coins += coins - wage - stipend;
        this.w.nations.changed = true;
      } else if (home) home.coins = (home.coins ?? 0) + coins;
      p.task = 'idle';
      p.wait = 10;
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
            const n = Math.min(home ? this.tradeLoad(home) : TRADE_LOAD, Math.floor(ds[best] - this.target(dest, best)), Math.floor((p.coins ?? 0) / cost));
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
        // Crop rotation makes fields ripen a quarter faster (Stage 4c); so do oxen at the plough,
        // and a drought slows them (Stage 6).
        const rotation = this.w.tech.has(s, 'cropRotation') ? 1.25 : 1;
        const oxen = s ? this.w.creatures.ploughFactor(s, this.t.buildings.filter((o) => o.settlement === s.id && o.kind === BuildingKind.Farm).length) : 1;
        const dry = this.w.weather.growthFactor(b.tile);
        b.growth = Math.min(1, (b.growth ?? 0) + TEND_GROWTH * tool * rotation * oxen * dry * (this.ageOf(p) < ADULT_AGE ? 0.5 : 1));
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
        // The heavy plough gives 12 instead of 10 (Stage 4c).
        b.output = (b.output ?? 0) + (this.w.tech.has(this.t.byId(b.settlement ?? -1), 'heavyPlough') ? HARVEST_YIELD + 2 : HARVEST_YIELD);
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
    if (p.task === 'study') {
      // A scholar's spell of study: research for their culture, and a wage from the treasury.
      if (--p.wait > 0) return true;
      const b = p.job !== undefined ? this.t.byBuildingId(p.job) : undefined;
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (b) this.w.tech.study(p, b.kind);
      if (s) this.pay(s, p, SCHOLAR_WAGE);
      return this.done(p);
    }
    if (p.task === 'craft') {
      if (--p.wait > 0) return true;
      const job = this.jobOf(p);
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (p.load && p.making && (job === 'armorer' || job === 'groom')) {
        p.load = { kind: p.making, n: 1 };
        delete p.making;
      } else if (p.load && job === 'smith' && p.load.kind === 'iron') p.load = { kind: 'tools', n: 1 };
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
    if (p.task === 'trade' || p.task === 'drill') {
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
    // Its campfire serves as the store where there is no stone near to build a storehouse with
    // (otherwise such a settlement could never build its workplaces).
    const hasStore = mine.some((b) => b.kind === BuildingKind.Storehouse) || !this.t.stoneNear(center);
    const options: { kind: BuildingKind; test: (anchor: number, w: number, d: number) => boolean }[] = [];
    const any = () => true;
    const foodOption = () => {
      if (wantFood) {
        options.push({ kind: BuildingKind.Farm, test: any });
        // Game near: a hunter's lodge (Stage 6: animals).
        if (!count(BuildingKind.HuntingLodge) && people >= 15 && this.w.creatures.gameNear(center, 28, false) >= 3) options.push({ kind: BuildingKind.HuntingLodge, test: any });
        if (fishNear && fishing < Math.max(1, Math.floor(people / 25))) options.push({ kind: BuildingKind.FishingHut, test: (a, w, d) => this.shoreSpot(a, w, d) && this.nearList(this.fishTiles, a, 14) });
      }
    };
    // Wild cattle or sheep near: a pasture to tame them, a few as the settlement grows (Stage 6: livestock and work animals).
    const pastureOption = () => {
      if (people >= 20 && count(BuildingKind.Pasture) < Math.min(3, 1 + Math.floor(people / 60)) && this.w.creatures.gameNear(center, 40, true) >= 2) options.push({ kind: BuildingKind.Pasture, test: any });
    };
    const goodsOption = () => {
      if (!count(BuildingKind.Woodcutter) && this.t.nearestTree(center, 22) >= 0) options.push({ kind: BuildingKind.Woodcutter, test: (a) => this.t.nearestTree(a, 16) >= 0 });
      if (!count(BuildingKind.Quarry) && near(this.stoneTiles, 30)) options.push({ kind: BuildingKind.Quarry, test: (a) => this.nearList(this.stoneTiles, a, 22) });
      if (!count(BuildingKind.Mine) && near(this.oreTiles, 30) && hasStore) options.push({ kind: BuildingKind.Mine, test: (a) => this.nearList(this.oreTiles, a, 22) });
      // A mine at gold too, once gold is wanted (research, a mint, a town) and no mine reaches it (Caleb after Stage 5).
      const goldWanted = (this.w.tech?.wanted(s).gold ?? 0) > 0 || s.stage === 'town' || s.stage === 'city' || count(BuildingKind.Mint) > 0;
      const mines = mine.filter((b) => b.kind === BuildingKind.Mine);
      if (goldWanted && hasStore && near(this.goldTiles, 30) && !mines.some((b) => this.oreNear(b, 'gold') >= 0)) options.push({ kind: BuildingKind.Mine, test: (a) => this.nearList(this.goldTiles, a, 8) });
    };
    const tradeOption = () => {
      if (!hasStore) return;
      if (!count(BuildingKind.Smithy) && (st.iron >= 4 || count(BuildingKind.Mine))) options.push({ kind: BuildingKind.Smithy, test: any });
      if (!count(BuildingKind.Pottery) && people >= 20 && near(this.clayTiles, 28)) options.push({ kind: BuildingKind.Pottery, test: (a) => this.nearList(this.clayTiles, a, 22) });
      const neighbor = this.t.settlements.some((o) => o !== s && !o.abandoned && o.stage !== 'camp' && this.t.dist2(o.center, center) <= TRADE_RANGE * TRADE_RANGE);
      // A mercantile culture builds its market sooner (Stage 4a).
      if (!count(BuildingKind.Market) && people >= (traits?.livelihood === 'mercantile' ? 15 : 25) && neighbor) options.push({ kind: BuildingKind.Market, test: any });
      if ((s.stage === 'town' || s.stage === 'city') && !count(BuildingKind.Mint) && (st.gold >= 3 || near(this.goldTiles, 30))) options.push({ kind: BuildingKind.Mint, test: any });
      // Research buildings (Caleb: research has its own building and workers).
      if (!count(BuildingKind.Scriptorium) && people >= 25) options.push({ kind: BuildingKind.Scriptorium, test: any });
      if ((s.stage === 'town' || s.stage === 'city') && !count(BuildingKind.University)) options.push({ kind: BuildingKind.University, test: any });
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
    pastureOption();
    moreOption();
    // A nation's capital, and its towns and cities, build a hall for officials (taxes), first unless food is short.
    if (hasStore && this.w.nations?.wantsHall(s) && !count(BuildingKind.Hall)) {
      const hall = { kind: BuildingKind.Hall, test: any };
      if (food >= people) options.unshift(hall);
      else options.push(hall);
    }
    // A settlement on a coast or lakeside builds a dock, where people board boats across wide water,
    // once its technology has boats (Caleb: boats are researched).
    if (hasStore && people >= DOCK_PEOPLE && !count(BuildingKind.Dock) && food >= people / 2 && this.w.tech.canBuild(s, BuildingKind.Dock) && this.coastal(s)) options.unshift({ kind: BuildingKind.Dock, test: (a, w, d) => this.shoreSpot(a, w, d) && this.deepBeside(a, w, d) });
    // A nation's biggest city builds its castle, where the ruler lives (Caleb), before anything else once fed.
    if (hasStore && this.w.nations?.wantsCastle(s) && !count(BuildingKind.Castle)) {
      const castle = { kind: BuildingKind.Castle, test: any };
      if (food >= people) options.unshift(castle);
      else options.push(castle);
    }
    // A nation's capital and its towns keep barracks for a standing army (Caleb), two in a city; an
    // armory and a stable beside them once its technology allows (SPEC 10: a rule).
    const barracks = count(BuildingKind.Barracks);
    if (hasStore && this.w.toggles.war && this.w.nations?.wantsHall(s) && people >= 30) {
      if (barracks < (s.stage === 'city' ? 2 : 1) && food >= people) options.push({ kind: BuildingKind.Barracks, test: any });
      if (barracks && !count(BuildingKind.Armory)) options.push({ kind: BuildingKind.Armory, test: any });
      if (barracks && !count(BuildingKind.Stable)) options.push({ kind: BuildingKind.Stable, test: any });
    }
    // Only what the settlement's technology allows (Caleb: some buildings are locked behind technology).
    return options.filter((o) => this.w.tech.canBuild(s, o.kind));
  }

  /**
   * Resource tiles a workplace of this kind could stand beside, nearest `from` first, leaving
   * out those another workplace of its kind already works (Caleb: mines and the like stand at
   * their resource, often outside the settlement).
   */
  /** Iron and gold ore deposits. */
  oreList() {
    return this.oreTiles;
  }

  resourceSpots(kind: BuildingKind, from: number, range: number): number[] {
    if (kind === BuildingKind.Woodcutter) {
      const t = this.t.nearestTree(from, range);
      return t >= 0 ? [t] : [];
    }
    const list = kind === BuildingKind.Mine ? this.oreTiles : kind === BuildingKind.Quarry ? this.stoneTiles : kind === BuildingKind.FishingHut ? this.fishTiles : null;
    if (!list) return [];
    const taken = this.t.buildings.filter((b) => b.kind === kind).map((b) => this.t.middleTile(b));
    return list
      .filter((t) => this.w.stock[t] > 0 && this.t.dist2(t, from) <= range * range && !taken.some((m) => this.t.dist2(m, t) < 64))
      .sort((a, b) => this.t.dist2(a, from) - this.t.dist2(b, from))
      .slice(0, 8);
  }

  private nearList(list: number[], from: number, r: number) {
    return list.some((t) => this.w.stock[t] > 0 && this.t.dist2(t, from) <= r * r);
  }

  /** Whether a footprint has a tile beside water. */
  /** Whether a settlement's land has a shore with deep water near it (a coast or lake, not a river). */
  /** Whether a settlement lies on a coast or lakeside with deep water near (for boats). */
  isCoastal(s: Settlement): boolean {
    return this.coastal(s);
  }

  private coastal(s: Settlement): boolean {
    // Looked at again once a year (land grows slowly).
    const year = Math.floor(this.w.state.tick / TICKS_PER_YEAR);
    const hit = this.coastCache.get(s.id);
    if (hit && hit.year === year) return hit.coastal;
    const coastal = this.findCoast(s);
    this.coastCache.set(s.id, { year, coastal });
    return coastal;
  }

  private coastCache = new Map<number, { year: number; coastal: boolean }>();

  private findCoast(s: Settlement): boolean {
    const w = this.w;
    const size = w.size;
    const cx = s.center % size;
    const cy = Math.floor(s.center / size);
    for (let dy = -24; dy <= 24; dy++) {
      for (let dx = -24; dx <= 24; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
        const t = y * size + x;
        if (this.t.territory[t] !== s.id) continue;
        if (!(isWater(w.terrain[t + 1]) || isWater(w.terrain[t - 1]) || isWater(w.terrain[t + size]) || isWater(w.terrain[t - size]))) continue;
        if (this.deepNear(x, y, 1, 1)) return true;
      }
    }
    return false;
  }

  /** Whether deep water lies within a few tiles of a footprint (a dock reaches the open water). */
  private deepBeside(anchor: number, fw: number, fd: number): boolean {
    return this.deepNear(anchor % this.w.size, Math.floor(anchor / this.w.size), fw, fd);
  }

  private deepNear(ax: number, ay: number, fw: number, fd: number): boolean {
    const w = this.w;
    const size = w.size;
    const r = 4;
    for (let y = ay - r; y < ay + fd + r; y++) {
      for (let x = ax - r; x < ax + fw + r; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (w.terrain[y * size + x] === Terrain.DeepWater) return true;
      }
    }
    return false;
  }

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
