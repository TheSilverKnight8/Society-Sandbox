import { isWater } from '../map/terrain';
import { randomLook } from './look';
import { BuildingKind, type Good } from './buildings';
import { ADULT_AGE, TICKS_PER_MONTH, TICKS_PER_YEAR, type Building, type Person } from './types';
import type { World } from './world';

// Criminals (Stage 6; SPEC 6: criminals have no job, do not live in settlements, and only enter
// them to steal or kill; SPEC 10: criminals entering settlements is a rule; Caleb: they come from
// the people, from bandit camps, and can be placed by the player).
//
// A grown-up with no job, no coins and no home (or going hungry) may turn to crime and leave
// their settlement. Bands of bandits now and then set up camp in the wilds near settlements, and
// criminals gather at the nearest camp. A band raids a settlement near it now and then: most
// raids are to steal (coins from the treasury, food and goods from the store), some to kill.
// Raiders are fought by the townspeople on their own land and by soldiers (the same fights as
// war: see military.ts), and head back to camp with what they took.

/** Chance each month that a grown-up in hardship, in a settlement of at least so many people, turns to crime. */
const HARDSHIP = 0.006;
const HARDSHIP_PEOPLE = 40;
/** Chance each month that a band raids a settlement within this many tiles of its camp, and how many go. */
const RAID_CHANCE = 0.12;
const RAID_RANGE = 60;
const RAIDERS = 5;
/** Share of raids that are to kill. */
const KILL_SHARE = 0.25;
/** A raid is given up after this long. */
const RAID_MONTHS = 3;
/** What raiders take: a share of the treasury (at most so many coins each), food, and up to so much of a good. */
const STEAL_SHARE = 0.3;
const STEAL_COINS = 40;
const STEAL_GOODS = 4;
const LOOT: Good[] = ['gold', 'tools', 'iron', 'pottery', 'wood'];
/** Chance each year (sim-triggered events) that a new band sets up camp near a settlement of at least so many people (not in a run's first years), and how many it has. */
const BAND_CHANCE = 0.1;
const BAND_NEAR = 60;
const BAND_AFTER_YEARS = 5;
const BAND = [4, 7];
/** How far from a camp (tiles) its band keeps, and how far criminals look for a camp to join. */
const CAMP_RANGE = 6;
const JOIN_RANGE = 70;

export class Crime {
  private w: World;
  /** Criminals on a raid now (counted every few steps). */
  raiders: Person[] = [];

  constructor(w: World) {
    this.w = w;
  }

  step() {
    const w = this.w;
    const tick = w.state.tick;
    if (tick % 5 === 0) this.raiders = w.state.people.filter((p) => p.criminal && p.raid);
    if (tick % TICKS_PER_MONTH === 43) this.raids();
    if (tick % TICKS_PER_YEAR === 300 && tick > BAND_AFTER_YEARS * TICKS_PER_YEAR && w.toggles.criminals && w.toggles.events && w.rand.next() < BAND_CHANCE) this.newBand();
  }

  camps(): Building[] {
    return this.w.towns.buildings.filter((b) => b.kind === BuildingKind.BanditCamp);
  }

  /** Once a month for a settled grown-up: hardship may turn them to crime. */
  monthly(p: Person) {
    const w = this.w;
    if (!w.toggles.criminals || p.settlement === undefined || p.criminal || p.job !== undefined || p.soldier || p.unique) return;
    const age = w.ageOf(p);
    if (age < 18 || age > 45 || (p.coins ?? 0) >= 1) return;
    if (p.home !== undefined && p.food >= 30) return;
    const s = w.towns.byId(p.settlement);
    if (!s || s.stage === 'camp' || w.towns.peopleOf(s) < HARDSHIP_PEOPLE || w.rand.next() >= HARDSHIP) return;
    const name = s.name;
    w.towns.outcast(p);
    this.becomeCriminal(p);
    w.record.add('crime', `Someone from ${name} turned to crime.`, w.tileOf(p));
  }

  /** Someone becomes a criminal, and joins the nearest camp if there is one. */
  private becomeCriminal(p: Person) {
    p.criminal = true;
    delete p.order;
    const camp = this.nearestCamp(this.w.tileOf(p), JOIN_RANGE);
    if (camp) p.band = camp.id;
  }

  private nearestCamp(tile: number, r: number): Building | null {
    let best: Building | null = null;
    let bestD = r * r;
    for (const b of this.camps()) {
      const d = this.w.towns.dist2(b.tile, tile);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** A new band sets up camp in the wilds near a settlement. */
  private newBand() {
    const w = this.w;
    const T = w.towns;
    const alive = T.settlements.filter((s) => !s.abandoned && T.peopleOf(s) >= BAND_NEAR);
    if (!alive.length) return;
    const s = alive[w.rand.int(alive.length)];
    const camp = this.campSpot(s.center, 25, 45);
    if (!camp) return;
    const n = BAND[0] + w.rand.int(BAND[1] - BAND[0] + 1);
    this.spawnBand(camp, n);
    w.record.add('crime', `A band of ${n} bandits set up camp${w.disasters.nearName(camp.tile)}.`, camp.tile);
  }

  /** A camp on free land between some distances from a tile, away from any settlement's land. */
  private campSpot(from: number, r0: number, r1: number): Building | null {
    const w = this.w;
    const size = w.size;
    const fx = from % size;
    const fy = Math.floor(from / size);
    for (let k = 0; k < 40; k++) {
      const a = w.rand.next() * Math.PI * 2;
      const r = r0 + w.rand.next() * (r1 - r0);
      const x = Math.round(fx + Math.cos(a) * r);
      const y = Math.round(fy + Math.sin(a) * r);
      if (x < 2 || y < 2 || x >= size - 3 || y >= size - 3) continue;
      const t = y * size + x;
      if (w.finder.land(t) !== w.finder.land(from) || w.towns.territory[t] !== 0) continue;
      // Not right against anyone's land.
      let clear = true;
      for (let dy = -4; dy <= 4 && clear; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < size && yy < size && w.towns.territory[yy * size + xx] !== 0) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const camp = w.towns.addCamp(t);
      if (camp) return camp;
    }
    return null;
  }

  private spawnBand(camp: Building, n: number) {
    const w = this.w;
    const size = w.size;
    for (let i = 0; i < n; i++) {
      const t = camp.tile + (i % 3) - 1 + (Math.floor(i / 3) + 2) * size;
      const x = t % size;
      const y = Math.floor(t / size);
      if (t < 0 || t >= size * size || isWater(w.terrain[t]) || !w.finder.walkable(t)) continue;
      const age = 18 + w.rand.next() * 20;
      const p: Person = {
        id: w.state.nextId++,
        sex: w.rand.next() < 0.8 ? 1 : 0,
        born: w.state.tick - Math.floor(age * TICKS_PER_YEAR),
        health: 100,
        look: randomLook(w.rand.next),
        x: x + 0.3 + w.rand.next() * 0.4,
        y: y + 0.3 + w.rand.next() * 0.4,
        task: 'idle',
        wait: 10 + w.rand.int(30),
        food: 80,
        rest: 80,
        carry: 2,
        criminal: true,
        band: camp.id,
      };
      w.addPerson(p);
    }
  }

  /** Once a month: bands raid a settlement near their camp (when the rule is on); camps with no band left are gone. */
  private raids() {
    const w = this.w;
    const T = w.towns;
    const tick = w.state.tick;
    const bands = new Map<number, Person[]>();
    for (const p of w.state.people) {
      if (!p.criminal) continue;
      // A criminal with no camp joins one when there is one near.
      if (p.band === undefined || !T.byBuildingId(p.band)) {
        const camp = this.nearestCamp(w.tileOf(p), JOIN_RANGE);
        if (camp) p.band = camp.id;
        else delete p.band;
      }
      if (p.band === undefined) continue;
      const l = bands.get(p.band);
      if (l) l.push(p);
      else bands.set(p.band, [p]);
    }
    for (const camp of this.camps()) {
      const band = bands.get(camp.id);
      if (!band || !band.length) {
        T.destroy(camp);
        continue;
      }
      if (!w.toggles.criminals || band.some((p) => p.raid) || band.length < 2 || w.rand.next() >= RAID_CHANCE) continue;
      // The nearest settlement worth raiding.
      let target = -1;
      let bestD = RAID_RANGE * RAID_RANGE;
      for (const s of T.settlements) {
        if (s.abandoned || T.peopleOf(s) < 8) continue;
        const d = T.dist2(s.center, camp.tile);
        if (d < bestD) {
          bestD = d;
          target = s.id;
        }
      }
      if (target < 0) continue;
      const s = T.byId(target)!;
      const kill = w.rand.next() < KILL_SHARE;
      const fit = band.filter((p) => w.ageOf(p) >= ADULT_AGE && p.health > 50 && p.food > 30).slice(0, RAIDERS);
      if (fit.length < 2) continue;
      const store = T.economy.storeTile(s, camp.tile);
      for (const p of fit) {
        w.stop(p);
        p.raid = { settlement: s.id, kill, until: tick + RAID_MONTHS * TICKS_PER_MONTH };
        w.goTo(p, store, 'raid');
      }
    }
  }

  /** A criminal's own doings when their needs are met. Returns true if they did something. */
  decide(p: Person): boolean {
    const w = this.w;
    const T = w.towns;
    const r = p.raid;
    if (r) {
      const s = T.byId(r.settlement);
      if (!s || s.abandoned || w.state.tick > r.until) r.done = true;
      if (r.done) return this.homeward(p);
      if (r.kill) {
        // Someone of the settlement to kill, near where they are.
        let victim: Person | null = null;
        let bestD = Infinity;
        w.creatures.peopleNear(p.x, p.y, 12, (q, d2) => {
          if (q.settlement !== r.settlement || q.criminal || d2 >= bestD) return;
          victim = q;
          bestD = d2;
        });
        if (victim) {
          p.foe = (victim as Person).id;
          w.goTo(p, w.tileOf(victim as Person), 'chase');
          return true;
        }
      }
      w.goTo(p, T.economy.storeTile(s!, w.tileOf(p)), 'raid');
      return true;
    }
    // Keeping near their camp, or roaming.
    const camp = p.band !== undefined ? T.byBuildingId(p.band) : undefined;
    if (camp) {
      const cx = (camp.tile % w.size) + 1;
      const cy = Math.floor(camp.tile / w.size) + 1;
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 > CAMP_RANGE * CAMP_RANGE) {
        w.goTo(p, camp.tile + 2 * w.size, 'camp');
        return true;
      }
    }
    return false;
  }

  /** A raid done: back to camp with what they took (still fair game for the townspeople on the way). */
  private homeward(p: Person): boolean {
    const w = this.w;
    const camp = p.band !== undefined ? w.towns.byBuildingId(p.band) : undefined;
    if (!camp) {
      delete p.raid;
      return false;
    }
    w.goTo(p, camp.tile + 2 * w.size, 'camp');
    return true;
  }

  /** A criminal has got where they were going. */
  arrive(p: Person, purpose: Person['purpose']): boolean {
    const w = this.w;
    if (purpose === 'camp') {
      if (p.raid?.done) delete p.raid;
      p.wait = 20 + w.rand.int(40);
      return true;
    }
    if (purpose !== 'raid' || !p.raid) return false;
    const r = p.raid;
    const s = w.towns.byId(r.settlement);
    if (!s || r.done) {
      r.done = true;
      p.wait = 0;
      return true;
    }
    // At the store: what they can carry off.
    const st = w.towns.economy.stockOf(s);
    const coins = Math.min(STEAL_COINS, Math.floor((s.coins ?? 0) * STEAL_SHARE));
    s.coins = (s.coins ?? 0) - coins;
    p.coins = (p.coins ?? 0) + coins;
    const food = Math.min(3 - p.carry, Math.floor(st.food));
    if (food > 0) {
      st.food -= food;
      p.carry += food;
    }
    let took = '';
    if (!p.load) {
      for (const g of LOOT) {
        const n = Math.min(STEAL_GOODS, Math.floor(st[g]));
        if (n <= 0) continue;
        st[g] -= n;
        p.load = { kind: g, n };
        took = g === 'iron' ? 'iron ore' : g === 'gold' ? 'gold ore' : g;
        break;
      }
    }
    w.towns.settlementsChanged = true;
    if (coins > 0 || took) w.record.add('crime', `Bandits robbed ${s.name}${coins > 0 ? ` of ${coins} coins` : ''}${took ? `${coins > 0 ? ' and' : ' of'} ${took}` : ''}.`, w.tileOf(p));
    if (!r.kill) r.done = true;
    p.wait = 0;
    return true;
  }

  /** Someone was killed by bandits (from the fight). */
  murdered(victim: Person) {
    const name = this.w.towns.settlementName(victim.settlement);
    this.w.record.add('crime', `Bandits killed someone${name ? ` in ${name}` : this.w.disasters.nearName(this.w.tileOf(victim))}.`, this.w.tileOf(victim));
  }

  /** A bandit camp placed by the player (SPEC 4), with a band of its own. */
  placeCamp(tile: number) {
    const w = this.w;
    const size = w.size;
    // The camp is placed by its middle, like other buildings.
    const camp = w.towns.addCamp(tile - 1 - size);
    if (!camp) return;
    const n = BAND[0] + w.rand.int(BAND[1] - BAND[0] + 1);
    this.spawnBand(camp, n);
    w.record.add('crime', `A band of ${n} bandits set up camp${w.disasters.nearName(camp.tile)}.`, camp.tile);
  }

  /** Places criminals on the tiles given (SPEC 4: placing units); they join the nearest camp, or set one up if there are several. */
  place(tiles: number[]): number {
    const w = this.w;
    const placed = w.place(tiles);
    const fresh = w.state.people.slice(w.state.people.length - placed);
    for (const p of fresh) p.criminal = true;
    if (!fresh.length) return 0;
    let camp = this.nearestCamp(w.tileOf(fresh[0]), JOIN_RANGE);
    if (!camp && fresh.length >= 3) {
      const t = w.tileOf(fresh[0]);
      camp = w.towns.territory[t] === 0 ? w.towns.addCamp(t + 2) ?? this.campSpot(t, 3, 12) : this.campSpot(t, 6, 20);
    }
    for (const p of fresh) if (camp) p.band = camp.id;
    return fresh.length;
  }

  /** Whether one of the pair is a criminal at odds with the other (for fights: see Military.hostile). */
  outlaws(p: Person, q: Person): boolean {
    if (!!p.criminal === !!q.criminal) return false;
    const c = p.criminal ? p : q;
    const o = p.criminal ? q : p;
    return !!c.raid || !!o.soldier;
  }

  /** Whether someone is a criminal on a raid. */
  raiding(p: Person) {
    return !!p.criminal && !!p.raid;
  }
}
