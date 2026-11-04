import { Deposit, isWater } from '../map/terrain';
import { BUILDINGS, BuildingKind, GOODS, footprint, type Good, type JobKind } from './buildings';
import { ADULT_AGE, MONTHS_PER_YEAR, TICKS_PER_MONTH, TICKS_PER_YEAR, type Building, type Person, type Settlement } from './types';
import type { Towns } from './towns';
import type { World } from './world';

// Jobs and production (Stage 3b; SPEC 6 and 8).
//
// From the village stage on, a settlement's adults take jobs as tradesmen at its
// workplaces (farm, woodcutter's lodge, quarry, mine, fishing hut), and children from 8
// take light jobs at farms and fishing huts. Workers make goods where they work and carry
// them to the settlement's store: its storehouse, or its campfire while it has none.
// Farmers tend their field outside winter and harvest it when it is ripe. Builders take
// wood and stone from the store when it has some, and fetch it themselves when it has not.
// Hungry people in a settlement eat from its store before they go foraging.

/** Children this old and older can hold a light job. */
const LIGHT_JOB_AGE = 8;
/** How much growth one adult's step of tending gives a field (a child's gives half). About 2.5 harvests a year with two farmers. */
const TEND_GROWTH = 1 / 180;
const TEND_STEPS = 80;
const HARVEST_STEPS = 50;
const HARVEST_YIELD = 10;
/** Months a field grows in: March to November. */
const GROWING = (month: number) => month >= 2 && month <= 10;
const MINE_STEPS = 60;
const FISH_STEPS = 60;
/** How much a worker carries before taking it to the store. */
const LOAD_TARGET: Record<Good, number> = { food: 4, wood: 6, stone: 4, iron: 4, gold: 4 };
const ORE_PER_TRIP = 2;
/** How far from their workplace gatherers go for trees, stone, ore and fish. */
const JOB_RANGE: Partial<Record<JobKind, number>> = { woodcutter: 20, quarryman: 28, miner: 28, fisher: 14 };
/** How far from the store hungry people will walk to eat from it. */
const STORE_RANGE = 40;
/** Builders carry at most this much from the store at once. */
const FETCH_LOAD = 4;
/** When the store holds this much of what a worker makes, they stop making it for now (food: per person, plus a reserve). */
const STOCK_CAP: Record<Good, number> = { food: 3, wood: 80, stone: 60, iron: 40, gold: 40 };
const FOOD_RESERVE = 30;
const JOB_GOOD: Record<JobKind, Good> = { farmer: 'food', fisher: 'food', woodcutter: 'wood', quarryman: 'stone', miner: 'iron' };

export class Economy {
  private w: World;
  private t: Towns;
  private oreTiles: number[] = [];
  private fishTiles: number[] = [];
  private stoneTiles: number[] = [];

  constructor(w: World, t: Towns) {
    this.w = w;
    this.t = t;
    for (let i = 0; i < w.deposit.length; i++) {
      const d = w.deposit[i];
      if (d === Deposit.Iron || d === Deposit.Gold) this.oreTiles.push(i);
      else if (d === Deposit.Fish) this.fishTiles.push(i);
      else if (d === Deposit.Stone) this.stoneTiles.push(i);
    }
    for (const s of t.settlements) this.stockOf(s);
  }

  stockOf(s: Settlement): Record<Good, number> {
    s.stock ??= {};
    for (const g of GOODS) s.stock[g] ??= 0;
    return s.stock as Record<Good, number>;
  }

  private month() {
    return Math.floor(this.w.state.tick / TICKS_PER_MONTH) % MONTHS_PER_YEAR;
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
      const child = w.ageOf(p) < ADULT_AGE;
      const m = child ? kids : adults;
      m.set(b.id, (m.get(b.id) ?? 0) + 1);
    }
    // Camps have no formal jobs (Caleb: jobs begin at the village stage).
    if (s.stage === 'camp' || !places.length) return;
    for (const p of members) {
      if (p.job !== undefined || p.settleAt !== undefined) continue;
      const age = w.ageOf(p);
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
      const child = this.w.ageOf(p) < ADULT_AGE;
      if (p.job !== undefined) {
        if (child) light++;
        else filled++;
      } else if (!child && s.stage !== 'camp') jobless++;
    }
    return { offered, filled, light, jobless };
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
    // Carrying what they made: take it to the store.
    if (p.load && p.site === undefined) {
      if (p.load.n >= LOAD_TARGET[p.load.kind] || !this.canGather(p, b)) {
        w.goTo(p, this.storeTile(s, w.tileOf(p)), 'deliver');
        return true;
      }
    }
    const job = BUILDINGS[b.kind].job;
    const child = w.ageOf(p) < ADULT_AGE;
    // The store already holds plenty of what they make: other work (building) or rest for now.
    if (this.full(s, JOB_GOOD[job!]) && !(b.output ?? 0)) return false;
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
    const target = this.resourceFor(job!, b);
    if (target < 0) return false;
    p.jobStep = 'gather';
    p.target = target;
    w.goTo(p, job === 'fisher' ? this.t.approach(target) : target, 'job');
    return true;
  }

  /** Whether a settlement's store holds plenty of a good. */
  full(s: Settlement, g: Good) {
    const cap = g === 'food' ? (this.t.peopleOf(s) * STOCK_CAP.food + FOOD_RESERVE) : STOCK_CAP[g];
    return this.stockOf(s)[g] >= cap;
  }

  private canGather(_p: Person, b: Building) {
    const job = BUILDINGS[b.kind].job;
    return job !== 'farmer' && this.resourceFor(job!, b) >= 0;
  }

  /** A random tile of a field. */
  private fieldTile(b: Building) {
    const tiles = this.t.tilesOf(b);
    return tiles[this.w.rand.int(tiles.length)];
  }

  /** The nearest tree, stone, ore or fish to a workplace that still has something to take, or -1. */
  private resourceFor(job: JobKind, b: Building): number {
    const range = JOB_RANGE[job] ?? 20;
    const from = this.t.middleTile(b);
    if (job === 'woodcutter') return this.t.nearestTree(from, range);
    const list = job === 'quarryman' ? this.stoneTiles : job === 'miner' ? this.oreTiles : this.fishTiles;
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
      if (step === 'tend') {
        p.task = 'farm';
        p.wait = TEND_STEPS;
      } else if (step === 'harvest') {
        p.task = 'harvest';
        p.wait = HARVEST_STEPS;
      } else if (step === 'collect') {
        const n = Math.min(LOAD_TARGET.food, b.output ?? 0);
        if (n > 0) {
          b.output = (b.output ?? 0) - n;
          p.load = { kind: 'food', n };
          this.t.buildingsChanged = true;
        }
        p.task = 'idle';
        p.wait = 2;
      } else if (step === 'gather') {
        const job = BUILDINGS[b.kind].job;
        if (job === 'woodcutter') {
          p.task = 'chop';
          p.wait = 40;
        } else if (job === 'quarryman') {
          p.task = 'quarry';
          p.wait = 50;
        } else if (job === 'miner') {
          p.task = 'mine';
          p.wait = MINE_STEPS;
        } else {
          p.task = 'fish';
          p.wait = FISH_STEPS;
        }
      }
      return true;
    }
    if (purpose === 'deliver') {
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (s && p.load) {
        this.stockOf(s)[p.load.kind] += p.load.n;
        this.t.settlementsChanged = true;
      }
      delete p.load;
      p.task = 'idle';
      p.wait = 5;
      return true;
    }
    if (purpose === 'fetch') {
      // A builder at the store, taking wood or stone for their site.
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      const kind: Good = p.jobStep === 'fetch-stone' ? 'stone' : 'wood';
      delete p.jobStep;
      const site = p.site !== undefined ? this.t.byBuildingId(p.site) : undefined;
      if (s && site && site.progress < 1) {
        const need = (kind === 'wood' ? BUILDINGS[site.kind].wood - site.wood : BUILDINGS[site.kind].stone - site.stone) || FETCH_LOAD;
        const n = Math.min(FETCH_LOAD, Math.max(1, need), this.stockOf(s)[kind]);
        if (n > 0) {
          this.stockOf(s)[kind] -= n;
          p.load = { kind, n };
          this.t.settlementsChanged = true;
        } else delete p.site;
      } else delete p.site;
      p.task = 'idle';
      p.wait = 2;
      return true;
    }
    if (purpose === 'store') {
      // Hungry, at the store: take food to eat (and carry a little more).
      const s = p.settlement !== undefined ? this.t.byId(p.settlement) : undefined;
      if (s) {
        const st = this.stockOf(s);
        const n = Math.min(3 - p.carry, st.food);
        if (n > 0) {
          st.food -= n;
          p.carry += n;
          this.t.settlementsChanged = true;
        }
      }
      p.task = p.carry > 0 ? 'eat' : 'idle';
      p.wait = p.carry > 0 ? 10 : 0;
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
        b.growth = Math.min(1, (b.growth ?? 0) + TEND_GROWTH * (w.ageOf(p) < ADULT_AGE ? 0.5 : 1));
        if (this.cropLook(b) !== before) this.t.buildingsChanged = true;
      }
      // Very hungry or tired: stop and see to it.
      if (--p.wait <= 0 || (b.growth ?? 0) >= 1 || p.food < 30 || p.rest < 15) return this.done(p);
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
      return this.done(p);
    }
    if (p.task === 'mine' || p.task === 'fish') {
      if (--p.wait > 0) return true;
      const t = p.target;
      delete p.target;
      if (t !== undefined && w.stock[t] > 0) {
        const kind: Good = p.task === 'fish' ? 'food' : w.deposit[t] === Deposit.Gold ? 'gold' : 'iron';
        const take = Math.min(w.stock[t], p.task === 'fish' ? (w.ageOf(p) < ADULT_AGE ? 1 : 2) : ORE_PER_TRIP);
        w.stock[t] -= take;
        if (w.stock[t] === 0) w.tileEmptied(t);
        if (p.load && p.load.kind === kind) p.load.n += take;
        else p.load = { kind, n: take };
      }
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
   * fishing hut while its food does not keep up with its people, and a woodcutter's lodge,
   * quarry and mine when there are trees, stone and ore near and it has none.
   */
  nextWorkplaces(s: Settlement, people: number, mine: Building[]): { kind: BuildingKind; test: (anchor: number, w: number, d: number) => boolean }[] {
    if (s.stage === 'camp') return [];
    const count = (k: BuildingKind) => mine.filter((b) => b.kind === k).length;
    const farms = count(BuildingKind.Farm);
    const fishing = count(BuildingKind.FishingHut);
    const fed = farms * 16 + fishing * 10;
    const food = this.stockOf(s).food;
    const wantFood = fed < people && food < people * 2;
    const center = s.center;
    const near = (list: number[], r: number) => list.some((t) => this.w.stock[t] > 0 && this.t.dist2(t, center) <= r * r);
    const fishNear = near(this.fishTiles, 26);
    const options: { kind: BuildingKind; test: (anchor: number, w: number, d: number) => boolean }[] = [];
    const foodOption = () => {
      if (wantFood) {
        options.push({ kind: BuildingKind.Farm, test: () => true });
        if (fishNear && fishing < Math.max(1, Math.floor(people / 25))) options.push({ kind: BuildingKind.FishingHut, test: (a, w, d) => this.shoreSpot(a, w, d) && this.nearList(this.fishTiles, a, 14) });
      }
    };
    const goodsOption = () => {
      if (!count(BuildingKind.Woodcutter) && this.t.nearestTree(center, 22) >= 0) options.push({ kind: BuildingKind.Woodcutter, test: (a) => this.t.nearestTree(a, 16) >= 0 });
      if (!count(BuildingKind.Quarry) && near(this.stoneTiles, 30)) options.push({ kind: BuildingKind.Quarry, test: (a) => this.nearList(this.stoneTiles, a, 22) });
      if (!count(BuildingKind.Mine) && near(this.oreTiles, 30) && mine.some((b) => b.kind === BuildingKind.Storehouse)) options.push({ kind: BuildingKind.Mine, test: (a) => this.nearList(this.oreTiles, a, 22) });
    };
    // Focus decides what comes first; balanced puts food first only when food is short.
    if (s.focus === 'goods') {
      goodsOption();
      foodOption();
    } else if (s.focus === 'food' || food < people) {
      foodOption();
      goodsOption();
    } else {
      goodsOption();
      foodOption();
    }
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

  /** A year's food for a settlement's people, for planning. */
  static yearlyFood(people: number) {
    return people * 1.5 * (TICKS_PER_YEAR / 600);
  }
}
