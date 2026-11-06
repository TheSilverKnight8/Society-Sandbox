import { Terrain, isWater } from '../map/terrain';
import { BUILDINGS, BuildingKind } from './buildings';
import { ARMOR, WEAPONS } from './military';
import { ADULT_AGE, CREATURE_KINDS, TICKS_PER_MONTH, TICKS_PER_YEAR, type Building, type Creature, type CreatureDetails, type CreatureKind, type Person, type Settlement } from './types';
import type { World } from './world';

// Animals (Stage 6; SPEC 11: mobs and beasts alongside humans, an occasional dragon; Caleb:
// they can be hunted, tamed as livestock and work animals, or fought).
//
// Deer, wild boar, wolves, bears, aurochs and wild sheep live on the land that suits them, in
// numbers the land can hold, and breed back when hunted. They wander (in straight lines, with no
// path search, so they cost little); deer and sheep run from people; boar and aurochs fight back
// when struck. Wolves and bears hunt other animals, and people out on their own when hungry (and
// bears anyone who comes too close); people fight back, and townspeople and soldiers come to
// drive off a beast on their land. Hunters from a hunter's lodge hunt game for its meat.
// Herders at a pasture tame aurochs (as cattle) and wild sheep: the herd breeds, gives food,
// and cattle pull ploughs (fields ripen faster). A dragon now and then flies out of the
// mountains, burns a settlement, and flies home after some months unless it is slain.

interface KindDef {
  name: string;
  /** Name while wild, if different (aurochs are tamed as cattle). */
  wildName?: string;
  health: number;
  /** Tiles a step. */
  speed: number;
  damage: number;
  every: number;
  reach: number;
  /** shy: runs from people; bold: fights back when struck; hunter: hunts animals, and people when hungry. */
  temper: 'shy' | 'bold' | 'hunter';
  /** Food from one, when hunted or slaughtered. */
  meat: number;
  /** Terrain it lives on, and how many tiles of it per animal. */
  habitat: number[];
  per: number;
  /** How many together when they appear. */
  group: [number, number];
  tame?: boolean;
  /** Whether it crosses mountains. */
  climbs?: boolean;
}

export const CREATURES: Record<CreatureKind, KindDef> = {
  deer: { name: 'Deer', health: 40, speed: 0.13, damage: 4, every: 15, reach: 1, temper: 'shy', meat: 6, habitat: [Terrain.Forest, Terrain.Grassland], per: 900, group: [2, 5] },
  boar: { name: 'Wild boar', health: 60, speed: 0.11, damage: 9, every: 15, reach: 1, temper: 'bold', meat: 6, habitat: [Terrain.Forest, Terrain.Swamp], per: 1600, group: [1, 3] },
  wolf: { name: 'Wolf', health: 50, speed: 0.15, damage: 8, every: 12, reach: 1, temper: 'hunter', meat: 0, habitat: [Terrain.Forest, Terrain.Hills, Terrain.Snow], per: 2500, group: [3, 5], climbs: true },
  bear: { name: 'Bear', health: 130, speed: 0.1, damage: 16, every: 18, reach: 1.1, temper: 'hunter', meat: 10, habitat: [Terrain.Forest, Terrain.Hills, Terrain.Mountain], per: 5000, group: [1, 1], climbs: true },
  cattle: { name: 'Cattle', wildName: 'Aurochs', health: 90, speed: 0.09, damage: 10, every: 18, reach: 1.1, temper: 'bold', meat: 10, habitat: [Terrain.Grassland], per: 2500, group: [3, 6], tame: true },
  sheep: { name: 'Sheep', wildName: 'Wild sheep', health: 30, speed: 0.11, damage: 0, every: 20, reach: 1, temper: 'shy', meat: 4, habitat: [Terrain.Hills, Terrain.Grassland, Terrain.Mountain], per: 2000, group: [3, 6], tame: true, climbs: true },
  dragon: { name: 'Dragon', health: 700, speed: 0.2, damage: 40, every: 25, reach: 2.5, temper: 'hunter', meat: 0, habitat: [], per: 0, group: [1, 1] },
};

/** Wild animals of a kind are kept to this many times what the land holds. */
const CAP = 1.5;
/** Chance each month that a wild animal under the cap has a young one. */
const BREED = 0.06;
/** How far (tiles) a shy animal notices people, and how long it runs. */
const SHY_RANGE = 4;
const FLEE_STEPS = 30;
/** Predators' hunger rises each step; past this they hunt. */
const HUNGER_RATE = 0.02;
const HUNGRY = 60;
/** How far (tiles) a predator looks for prey, and for a person on their own. */
const PREY_SIGHT = 12;
const PERSON_SIGHT = 7;
/** A bear attacks anyone this close (tiles). */
const BEAR_TEMPER = 2.5;
/** How far (tiles) from their lodge or pasture hunters and herders go. */
const GAME_RANGE = 30;
/** A hunter's blow, and a townsperson's against a beast. */
const HUNTER_BLOW = { damage: 16, range: 1.4, every: 14 };
/** How far (tiles) townspeople and soldiers come from to drive off a beast on their land, and how many come. */
const DEFEND_RANGE = 10;
const DEFENDERS = 4;
const DRAGON_DEFENDERS = 10;
/** Most animals in a pasture; chance each month the herd has young; food each gives a month. */
const PEN_MAX = 6;
const PEN_BREED = 0.2;
const PEN_FOOD: Partial<Record<CreatureKind, number>> = { cattle: 2, sheep: 1 };
/** Chance a herder tames an animal they have reached, at each try. */
const TAME_CHANCE = 0.35;
/** A dragon stays this many months before flying home, and burns something this often (steps). */
const DRAGON_MONTHS = [4, 8];
const DRAGON_BREATH = 40;
const DRAGON_BURN_HURT = 30;

export class Creatures {
  private w: World;
  list: Creature[];
  byId = new Map<number, Creature>();
  /** People by cell of 8 tiles, and wild animals by cell, rebuilt every 10 steps. */
  private people = new Map<number, Person[]>();
  private animals = new Map<number, Creature[]>();
  /** Which way each animal last faced (true: left). */
  private facing = new Map<number, boolean>();
  /** How many tiles of each kind's land the map has. */
  private room = new Map<CreatureKind, number>();
  /** Tame cattle per settlement, counted monthly (work animals). */
  private oxen = new Map<number, number>();

  constructor(w: World) {
    this.w = w;
    const st = w.state;
    st.nextCreatureId ??= 1;
    const fresh = !st.creatures;
    st.creatures ??= [];
    this.list = st.creatures;
    for (const c of this.list) this.byId.set(c.id, c);
    this.measureLand();
    if (fresh) this.populate();
  }

  // ---------------------------------------------------------------- the land

  private measureLand() {
    const count = new Map<number, number>();
    for (const t of this.w.terrain) count.set(t, (count.get(t) ?? 0) + 1);
    for (const k of CREATURE_KINDS) this.room.set(k, CREATURES[k].habitat.reduce((a, t) => a + (count.get(t) ?? 0), 0));
  }

  /** How many wild animals of a kind the land holds. */
  private holds(k: CreatureKind) {
    const d = CREATURES[k];
    return d.per ? Math.floor((this.room.get(k) ?? 0) / d.per) : 0;
  }

  /** The animals the land holds, in groups, when a world starts (or an older run opens). */
  private populate() {
    const w = this.w;
    for (const k of CREATURE_KINDS) {
      const d = CREATURES[k];
      let left = this.holds(k);
      for (let tries = 0; left > 0 && tries < 400; tries++) {
        const t = w.rand.int(w.size * w.size);
        if (!d.habitat.includes(w.terrain[t]) || w.towns.territory[t] !== 0 || !this.canStand(k, t)) continue;
        const n = Math.min(left, d.group[0] + w.rand.int(d.group[1] - d.group[0] + 1));
        for (let i = 0; i < n; i++) this.spawn(k, (t % w.size) + 0.3 + w.rand.next() * 0.4 + (i % 2), Math.floor(t / w.size) + 0.3 + w.rand.next() * 0.4 + Math.floor(i / 2) * 0.5, true);
        left -= n;
      }
    }
  }

  private spawn(kind: CreatureKind, x: number, y: number, grown: boolean): Creature {
    const w = this.w;
    const c: Creature = {
      id: w.state.nextCreatureId!++,
      kind,
      x,
      y,
      health: CREATURES[kind].health,
      born: w.state.tick - (grown ? Math.floor((1 + w.rand.next() * 4) * TICKS_PER_YEAR) : 0),
      wait: w.rand.int(40),
    };
    if (CREATURES[kind].temper === 'hunter') c.hunger = w.rand.int(50);
    this.list.push(c);
    this.byId.set(c.id, c);
    return c;
  }

  private remove(c: Creature) {
    this.byId.delete(c.id);
    this.facing.delete(c.id);
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    for (const p of this.w.state.people) {
      if (p.prey === c.id) delete p.prey;
      if (p.herding === c.id) delete p.herding;
    }
  }

  /** Whether an animal of a kind can stand on a tile. */
  private canStand(kind: CreatureKind, t: number) {
    const w = this.w;
    if (kind === 'dragon') return true;
    const ter = w.terrain[t];
    if (isWater(ter) && !w.finder.walkable(t)) return false;
    if ((ter === Terrain.Mountain || ter === Terrain.Snow) && !CREATURES[kind].climbs) return false;
    return w.finder.walkable(t);
  }

  // ---------------------------------------------------------------- every step

  step() {
    const w = this.w;
    const tick = w.state.tick;
    if (tick % 10 === 0) {
      this.buildGrids();
      this.defend();
    }
    if (tick % TICKS_PER_MONTH === 41) this.monthly();
    for (const c of this.list.slice()) if (this.byId.has(c.id)) this.update(c);
  }

  private cell(x: number, y: number) {
    return Math.floor(y / 8) * 1024 + Math.floor(x / 8);
  }

  private buildGrids() {
    this.people.clear();
    this.animals.clear();
    for (const p of this.w.state.people) {
      if (p.indoors) continue;
      const k = this.cell(p.x, p.y);
      const l = this.people.get(k);
      if (l) l.push(p);
      else this.people.set(k, [p]);
    }
    for (const c of this.list) {
      if (c.tame !== undefined) continue;
      const k = this.cell(c.x, c.y);
      const l = this.animals.get(k);
      if (l) l.push(c);
      else this.animals.set(k, [c]);
    }
  }

  /** People within some tiles of a point (from the grid, so as of the last few steps). */
  peopleNear(x: number, y: number, r: number, f: (p: Person, d2: number) => void) {
    const cx = Math.floor(x / 8);
    const cy = Math.floor(y / 8);
    const g = Math.ceil(r / 8);
    for (let gy = cy - g; gy <= cy + g; gy++) {
      for (let gx = cx - g; gx <= cx + g; gx++) {
        for (const p of this.people.get(gy * 1024 + gx) ?? []) {
          const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d2 <= r * r && this.w.byId.has(p.id)) f(p, d2);
        }
      }
    }
  }

  private animalsNear(x: number, y: number, r: number, f: (c: Creature, d2: number) => void) {
    const cx = Math.floor(x / 8);
    const cy = Math.floor(y / 8);
    const g = Math.ceil(r / 8);
    for (let gy = cy - g; gy <= cy + g; gy++) {
      for (let gx = cx - g; gx <= cx + g; gx++) {
        for (const c of this.animals.get(gy * 1024 + gx) ?? []) {
          const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
          if (d2 <= r * r && this.byId.has(c.id)) f(c, d2);
        }
      }
    }
  }

  private update(c: Creature) {
    const w = this.w;
    const d = CREATURES[c.kind];
    if (c.cooldown) c.cooldown--;
    if (c.kind === 'dragon') return this.dragonStep(c);
    if (d.temper === 'hunter') c.hunger = Math.min(100, (c.hunger ?? 0) + HUNGER_RATE);
    // Following a herder to the pasture.
    if (c.follow !== undefined) {
      const p = w.byId.get(c.follow);
      if (!p || p.herding !== c.id) {
        delete c.follow;
        if (c.pen === undefined || !w.towns.byBuildingId(c.pen)) this.goWild(c);
      } else if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 > 1.4) this.moveToward(c, p.x, p.y, d.speed * 1.2, true);
      return;
    }
    // Fighting someone, or chasing prey.
    if (c.foe !== undefined) return this.attackPerson(c);
    if (c.chase !== undefined) return this.chasePrey(c);
    if (c.flee !== undefined) {
      if (--c.flee <= 0) delete c.flee;
      else if (c.tx !== undefined && c.ty !== undefined) this.moveToward(c, c.tx, c.ty, d.speed * 1.3, false);
      return;
    }
    if ((w.state.tick + c.id) % 10 === 0 && c.tame === undefined) this.look(c);
    if (c.tx !== undefined && c.ty !== undefined && (c.tx - c.x) ** 2 + (c.ty - c.y) ** 2 > 0.04) {
      if (!this.moveToward(c, c.tx, c.ty, d.speed * 0.6, false)) {
        delete c.tx;
        delete c.ty;
      }
      return;
    }
    if (--c.wait > 0) return;
    this.decide(c);
  }

  /** Every few steps: a shy animal runs from people near; a predator looks for something to hunt; a bear goes for anyone too close. */
  private look(c: Creature) {
    const d = CREATURES[c.kind];
    if (d.temper === 'shy') {
      let near: Person | null = null;
      this.peopleNear(c.x, c.y, SHY_RANGE, (p) => (near = p));
      if (near) this.fleeFrom(c, (near as Person).x, (near as Person).y);
      return;
    }
    if (d.temper !== 'hunter') return;
    if (c.kind === 'bear') {
      let close: Person | null = null;
      this.peopleNear(c.x, c.y, BEAR_TEMPER, (p) => {
        if (!close) close = p;
      });
      if (close) {
        c.foe = (close as Person).id;
        return;
      }
    }
    if ((c.hunger ?? 0) < HUNGRY) return;
    // Prey first: deer, sheep, the young of others; else a person on their own, outside any settlement's land.
    let prey: Creature | null = null;
    let best = Infinity;
    this.animalsNear(c.x, c.y, PREY_SIGHT, (o, d2) => {
      if (o === c || o.kind === c.kind || CREATURES[o.kind].temper === 'hunter' || o.kind === 'cattle' || d2 >= best) return;
      prey = o;
      best = d2;
    });
    if (prey) {
      c.chase = (prey as Creature).id;
      return;
    }
    if ((c.hunger ?? 0) < 85 && !this.w.weather.winter()) return;
    const w = this.w;
    let victim: Person | null = null;
    let vd = Infinity;
    this.peopleNear(c.x, c.y, PERSON_SIGHT, (p, d2) => {
      if (d2 >= vd || w.towns.territory[w.tileOf(p)] !== 0 || p.task === 'sleep' && p.indoors) return;
      victim = p;
      vd = d2;
    });
    if (victim) c.foe = (victim as Person).id;
  }

  /** Picks where to wander next. */
  private decide(c: Creature) {
    const w = this.w;
    c.wait = 30 + w.rand.int(60);
    // A tame animal keeps to its pasture.
    if (c.pen !== undefined) {
      const b = w.towns.byBuildingId(c.pen);
      if (!b) return this.goWild(c);
      const tiles = w.towns.tilesOf(b);
      const t = tiles[w.rand.int(tiles.length)];
      c.tx = (t % w.size) + 0.2 + w.rand.next() * 0.6;
      c.ty = Math.floor(t / w.size) + 0.2 + w.rand.next() * 0.6;
      return;
    }
    if (c.tame !== undefined) return this.goWild(c);
    for (let k = 0; k < 6; k++) {
      const a = w.rand.next() * Math.PI * 2;
      const r = 2 + w.rand.next() * 6;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
      const t = Math.floor(y) * w.size + Math.floor(x);
      if (!this.canStand(c.kind, t)) continue;
      // Wild animals keep out of settlements, mostly (predators less so).
      if (w.towns.territory[t] !== 0 && w.rand.next() < (CREATURES[c.kind].temper === 'hunter' ? 0.6 : 0.9)) continue;
      c.tx = x;
      c.ty = y;
      return;
    }
  }

  /** Moves straight toward a point. Returns false when the way is blocked. */
  private moveToward(c: Creature, x: number, y: number, speed: number, anyGround: boolean): boolean {
    const w = this.w;
    const dx = x - c.x;
    const dy = y - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return true;
    const step = Math.min(speed, d);
    const nx = c.x + (dx / d) * step;
    const ny = c.y + (dy / d) * step;
    if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) return false;
    const t = Math.floor(ny) * w.size + Math.floor(nx);
    if (!anyGround && !this.canStand(c.kind, t)) return false;
    if (anyGround && c.kind !== 'dragon' && !w.finder.walkable(t)) return false;
    this.facing.set(c.id, dx - dy < 0);
    c.x = nx;
    c.y = ny;
    return true;
  }

  private fleeFrom(c: Creature, x: number, y: number) {
    const dx = c.x - x;
    const dy = c.y - y;
    const d = Math.hypot(dx, dy) || 1;
    c.tx = c.x + (dx / d) * 8;
    c.ty = c.y + (dy / d) * 8;
    c.flee = FLEE_STEPS;
    delete c.foe;
  }

  private goWild(c: Creature) {
    delete c.tame;
    delete c.pen;
    delete c.follow;
  }

  /** A predator (or a beast struck) goes for a person. */
  private attackPerson(c: Creature) {
    const w = this.w;
    const d = CREATURES[c.kind];
    const p = c.foe !== undefined ? w.byId.get(c.foe) : undefined;
    if (!p || p.indoors || (p.x - c.x) ** 2 + (p.y - c.y) ** 2 > 15 * 15) {
      delete c.foe;
      return;
    }
    const dist = Math.hypot(p.x - c.x, p.y - c.y);
    if (dist > d.reach) {
      if (!this.moveToward(c, p.x, p.y, d.speed, c.kind === 'dragon')) delete c.foe;
      return;
    }
    if (c.cooldown) return;
    c.cooldown = d.every;
    let dmg = d.damage * (0.75 + w.rand.next() * 0.5);
    if (p.armor) dmg *= 1 - ARMOR[p.armor].guard;
    p.health -= dmg;
    w.military.strike(c.x, c.y, p.x, p.y, 0);
    // Grown-ups fight back; others run.
    if (p.health > 0 && p.prey === undefined && w.ageOf(p) >= ADULT_AGE && p.health > 30) this.engage(p, c);
    else if (p.health > 0 && p.prey === undefined && p.task !== 'walk') this.runFrom(p, c);
    if (p.health <= 0) {
      this.w.military.fallAt(p);
      this.killPerson(p, c);
      delete c.foe;
      if (d.temper === 'hunter') c.hunger = Math.max(0, (c.hunger ?? 0) - 50);
    }
  }

  private killPerson(p: Person, c: Creature) {
    const w = this.w;
    const tile = w.tileOf(p);
    const name = (CREATURES[c.kind].wildName ?? CREATURES[c.kind].name).toLowerCase();
    w.kill(p, c.kind === 'dragon' ? 'the dragon' : `a ${name}`);
    w.record.add('creature', `${c.kind === 'dragon' ? 'The dragon' : `A ${name}`} killed someone${w.disasters.nearName(tile)}.`, tile);
  }

  /** Someone runs from a beast: home if they have one, else away from it. */
  private runFrom(p: Person, c: Creature) {
    const w = this.w;
    const bed = w.towns.bed(p);
    if (bed >= 0) return w.goTo(p, bed, 'home');
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const x = Math.floor(p.x + (dx / d) * 8);
    const y = Math.floor(p.y + (dy / d) * 8);
    if (x >= 0 && y >= 0 && x < w.size && y < w.size) w.goTo(p, y * w.size + x, 'stroll');
  }

  /** A predator runs down an animal. */
  private chasePrey(c: Creature) {
    const d = CREATURES[c.kind];
    const o = c.chase !== undefined ? this.byId.get(c.chase) : undefined;
    if (!o || (o.x - c.x) ** 2 + (o.y - c.y) ** 2 > 20 * 20) {
      delete c.chase;
      return;
    }
    if (o.flee === undefined && CREATURES[o.kind].temper === 'shy') this.fleeFrom(o, c.x, c.y);
    if (Math.hypot(o.x - c.x, o.y - c.y) > d.reach) {
      if (!this.moveToward(c, o.x, o.y, d.speed, false)) delete c.chase;
      return;
    }
    if (c.cooldown) return;
    c.cooldown = d.every;
    o.health -= d.damage * (0.75 + this.w.rand.next() * 0.5);
    if (o.health <= 0) {
      this.remove(o);
      delete c.chase;
      c.hunger = 0;
    }
  }

  /** Once a month: wild animals breed back under what the land holds; herds breed and give food; work animals are counted. */
  private monthly() {
    const w = this.w;
    const wild = new Map<CreatureKind, Creature[]>();
    for (const c of this.list) {
      if (c.tame !== undefined || c.kind === 'dragon') continue;
      const l = wild.get(c.kind);
      if (l) l.push(c);
      else wild.set(c.kind, [c]);
    }
    for (const k of CREATURE_KINDS) {
      const have = wild.get(k) ?? [];
      const cap = Math.ceil(this.holds(k) * CAP);
      if (!have.length || have.length >= cap) continue;
      // In spring most of all.
      const chance = BREED * (w.weather.season() === 0 ? 3 : w.weather.winter() ? 0 : 1);
      for (const c of have) {
        if (have.length >= cap) break;
        if (w.state.tick - c.born < TICKS_PER_YEAR || w.rand.next() >= chance) continue;
        have.push(this.spawn(k, c.x + (w.rand.next() - 0.5) * 0.6, c.y + (w.rand.next() - 0.5) * 0.6, false));
      }
    }
    // Pastures: young, and food for the herder to carry.
    this.oxen.clear();
    for (const b of w.towns.buildings) {
      if (b.kind !== BuildingKind.Pasture || b.progress < 1) continue;
      const herd = this.list.filter((c) => c.pen === b.id);
      for (const c of herd) {
        b.output = Math.min(24, (b.output ?? 0) + (PEN_FOOD[c.kind] ?? 0));
        if (c.kind === 'cattle' && b.settlement !== undefined) this.oxen.set(b.settlement, (this.oxen.get(b.settlement) ?? 0) + 1);
      }
      if (herd.length >= 2 && herd.length < PEN_MAX && w.rand.next() < PEN_BREED) {
        const mother = herd[w.rand.int(herd.length)];
        const young = this.spawn(mother.kind, mother.x, mother.y, false);
        young.tame = mother.tame;
        young.pen = b.id;
      }
    }
    // Animals of pastures that are gone go wild again.
    for (const c of this.list) if (c.pen !== undefined && !w.towns.byBuildingId(c.pen)) this.goWild(c);
  }

  // ---------------------------------------------------------------- people and animals

  /** Someone sets about a beast or game (a hunter, a townsperson defending their land, a soldier, or someone attacked). */
  engage(p: Person, c: Creature) {
    if (p.prey === c.id) return;
    this.w.stop(p);
    p.prey = c.id;
    p.task = 'hunt';
    p.wait = 0;
  }

  /** A step of fighting or hunting an animal. */
  hunt(p: Person) {
    const w = this.w;
    const c = p.prey !== undefined ? this.byId.get(p.prey) : undefined;
    if (!c || (c.x - p.x) ** 2 + (c.y - p.y) ** 2 > 25 * 25 || (p.health < 25 && !w.military.onCampaign(p))) {
      delete p.prey;
      w.stop(p);
      p.wait = 5;
      return;
    }
    const hunter = w.towns.economy.jobOf(p) === 'hunter';
    const weapon = p.weapon ? WEAPONS[p.weapon] : hunter ? HUNTER_BLOW : WEAPONS.none;
    const reach = weapon.range + (c.kind === 'dragon' ? 1.5 : 0);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d > reach) {
      // Closing in, straight; round by a path when something is in the way.
      const speed = 0.15 / w.finder.cost(w.tileOf(p));
      const nx = p.x + ((c.x - p.x) / d) * Math.min(speed, d);
      const ny = p.y + ((c.y - p.y) / d) * Math.min(speed, d);
      const t = Math.floor(ny) * w.size + Math.floor(nx);
      if (w.finder.walkable(t)) {
        p.x = nx;
        p.y = ny;
      } else {
        w.goTo(p, w.tileOf(c), 'hunt');
      }
      return;
    }
    if (p.cooldown) {
      p.cooldown--;
      return;
    }
    p.cooldown = weapon.every;
    const dmg = weapon.damage * (p.soldier ? 1.5 : 1) * (0.75 + w.rand.next() * 0.5);
    c.health -= dmg;
    w.military.strike(p.x, p.y, c.x, c.y, p.weapon === 'bow' ? 1 : p.weapon === 'crossbow' ? 2 : 0);
    const temper = CREATURES[c.kind].temper;
    if (temper === 'shy') this.fleeFrom(c, p.x, p.y);
    else if (c.foe === undefined) c.foe = p.id;
    if (c.health <= 0) this.slain(c, p, hunter);
  }

  /** An animal killed by someone: game's meat for a hunter (or a hungry person); a dragon's slayer is remembered. */
  private slain(c: Creature, p: Person, hunter: boolean) {
    const w = this.w;
    const d = CREATURES[c.kind];
    const tile = w.tileOf(c);
    this.remove(c);
    delete p.prey;
    w.stop(p);
    p.wait = 5;
    if (c.kind === 'dragon') {
      w.nations.makeUnique(p, 'dragon');
      w.record.add('creature', `${p.unique?.name ?? 'Someone'} slew the dragon${w.disasters.nearName(tile)}.`, tile);
      return;
    }
    if (c.kind === 'wolf' || c.kind === 'bear') w.record.add('creature', `A ${d.name.toLowerCase()} was killed${w.disasters.nearName(tile)}.`, tile);
    if (!d.meat) return;
    if (hunter) p.load = { kind: 'food', n: (p.load?.kind === 'food' ? p.load.n : 0) + d.meat };
    else p.carry = Math.min(3, p.carry + Math.min(3, d.meat));
  }

  /** Townspeople and soldiers near a beast on their land come to drive it off (every few steps). */
  private callDefenders(c: Creature) {
    const w = this.w;
    const own = w.towns.territory[Math.floor(c.y) * w.size + Math.floor(c.x)];
    let coming = 0;
    for (const p of w.state.people) if (p.prey === c.id) coming++;
    const most = c.kind === 'dragon' ? DRAGON_DEFENDERS : DEFENDERS;
    if (coming >= most) return;
    this.peopleNear(c.x, c.y, c.kind === 'dragon' ? DEFEND_RANGE * 2 : DEFEND_RANGE, (p) => {
      if (coming >= most || p.prey !== undefined || p.criminal || p.task === 'fight' || p.task === 'sleep') return;
      const soldier = !!p.soldier;
      if (!soldier && (own === 0 || p.settlement !== own || w.ageOf(p) < ADULT_AGE || w.ageOf(p) >= 60 || p.health < 50)) return;
      this.engage(p, c);
      coming++;
    });
  }

  // ---------------------------------------------------------------- hunters and herders

  /** A hunter's or herder's work. Returns true if they did something. */
  work(p: Person, b: Building, s: Settlement): boolean {
    const w = this.w;
    const E = w.towns.economy;
    if (p.load) {
      w.goTo(p, E.storeTile(s, w.tileOf(p)), 'deliver');
      return true;
    }
    const job = BUILDINGS[b.kind].job;
    const child = w.ageOf(p) < ADULT_AGE;
    if (job === 'hunter') {
      if (child || E.full(s, 'food')) return false;
      const game = this.nearest(b, (c) => c.tame === undefined && (c.kind === 'deer' || c.kind === 'boar' || ((c.kind === 'sheep' || c.kind === 'cattle') && !this.pastureNear(b))));
      if (!game) return false;
      p.prey = game.id;
      w.goTo(p, w.tileOf(game), 'hunt');
      return true;
    }
    // A herder: food from the pasture to carry; an animal to slaughter when the store is short; an animal to tame.
    const herd = this.list.filter((c) => c.pen === b.id);
    if ((b.output ?? 0) >= 4 || ((b.output ?? 0) > 0 && child)) {
      p.jobStep = 'pasture';
      w.goTo(p, E.doorTile(b), 'herd');
      return true;
    }
    if (!child && herd.length >= 3 && E.stockOf(s).food < w.towns.peopleOf(s)) {
      const c = herd[0];
      this.remove(c);
      p.load = { kind: 'food', n: CREATURES[c.kind].meat };
      w.goTo(p, E.storeTile(s, w.tileOf(p)), 'deliver');
      return true;
    }
    if (child || herd.length >= PEN_MAX) return false;
    const wild = this.nearest(b, (c) => c.tame === undefined && CREATURES[c.kind].tame === true && c.flee === undefined);
    if (!wild) return false;
    p.herding = wild.id;
    p.jobStep = 'tame';
    w.goTo(p, w.tileOf(wild), 'herd');
    return true;
  }

  private pastureNear(b: Building) {
    return this.w.towns.buildings.some((o) => o.kind === BuildingKind.Pasture && o.settlement === b.settlement);
  }

  /** The nearest wild animal to a workplace that passes a test, within range. */
  private nearest(b: Building, test: (c: Creature) => boolean): Creature | null {
    const w = this.w;
    const bx = (b.tile % w.size) + 1;
    const by = Math.floor(b.tile / w.size) + 1;
    const taken = new Set<number>();
    for (const p of w.state.people) {
      if (p.prey !== undefined) taken.add(p.prey);
      if (p.herding !== undefined) taken.add(p.herding);
    }
    let best: Creature | null = null;
    let bestD = GAME_RANGE * GAME_RANGE;
    for (const c of this.list) {
      if (taken.has(c.id) || !test(c)) continue;
      const d = (c.x - bx) ** 2 + (c.y - by) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Someone has got where they were going to hunt or herd. */
  arrive(p: Person, purpose: Person['purpose']): boolean {
    const w = this.w;
    if (purpose === 'hunt') {
      const c = p.prey !== undefined ? this.byId.get(p.prey) : undefined;
      if (!c) {
        p.wait = 5;
        return true;
      }
      p.task = 'hunt';
      return true;
    }
    if (purpose !== 'herd') return false;
    const b = p.job !== undefined ? w.towns.byBuildingId(p.job) : undefined;
    if (p.jobStep === 'pasture') {
      // Taking the pasture's food for the store.
      delete p.jobStep;
      if (b && (b.output ?? 0) > 0) {
        p.load = { kind: 'food', n: Math.floor(b.output!) };
        b.output = 0;
      }
      p.wait = 5;
      return true;
    }
    const c = p.herding !== undefined ? this.byId.get(p.herding) : undefined;
    if (!c || !b) {
      delete p.herding;
      p.wait = 5;
      return true;
    }
    if (c.follow === p.id) {
      // Back at the pasture: the animal is penned.
      delete c.follow;
      delete p.herding;
      delete p.jobStep;
      c.wait = 0;
      p.wait = 10;
      return true;
    }
    if (Math.hypot(c.x - p.x, c.y - p.y) > 2.5) {
      // It wandered off: after it again.
      w.goTo(p, w.tileOf(c), 'herd');
      return true;
    }
    p.task = 'herd';
    p.wait = 30;
    return true;
  }

  /** A step of a herder coaxing an animal: when the time is up, it is tamed (or not) and led home. */
  herd(p: Person) {
    const w = this.w;
    if (--p.wait > 0) return;
    const c = p.herding !== undefined ? this.byId.get(p.herding) : undefined;
    const b = p.job !== undefined ? w.towns.byBuildingId(p.job) : undefined;
    p.task = 'idle';
    p.wait = 5;
    if (!c || !b || c.tame !== undefined) {
      delete p.herding;
      return;
    }
    if (w.rand.next() >= TAME_CHANCE) {
      // It shied off this time.
      this.fleeFrom(c, p.x, p.y);
      delete p.herding;
      return;
    }
    c.tame = b.settlement;
    c.pen = b.id;
    c.follow = p.id;
    delete c.flee;
    delete c.tx;
    delete c.ty;
    w.goTo(p, w.towns.economy.doorTile(b), 'herd');
  }

  /** Work animals: fields ripen faster with tame cattle to pull the plough (a quarter faster with one ox a field). */
  ploughFactor(s: Settlement, farms: number): number {
    const oxen = this.oxen.get(s.id) ?? 0;
    return 1 + 0.25 * Math.min(1, oxen / Math.max(1, farms));
  }

  /** Wild game near a tile (for a settlement deciding to build a hunter's lodge or a pasture). */
  gameNear(tile: number, r: number, tame: boolean): number {
    const w = this.w;
    const x = (tile % w.size) + 0.5;
    const y = Math.floor(tile / w.size) + 0.5;
    let n = 0;
    for (const c of this.list) {
      if (c.tame !== undefined || (c.x - x) ** 2 + (c.y - y) ** 2 > r * r) continue;
      const d = CREATURES[c.kind];
      if (tame ? d.tame : c.kind === 'deer' || c.kind === 'boar') n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- the dragon

  /** A dragon flies out of the mountains near a tile (a disaster: sim-triggered or the player's). */
  dragon(tile: number) {
    const w = this.w;
    const size = w.size;
    // Its lair: the nearest mountain or snow within 40 tiles, else where it was called.
    let lair = tile;
    let best = Infinity;
    const x0 = tile % size;
    const y0 = Math.floor(tile / size);
    for (let k = 0; k < 400; k++) {
      const x = x0 + w.rand.int(81) - 40;
      const y = y0 + w.rand.int(81) - 40;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const t = y * size + x;
      if (w.terrain[t] !== Terrain.Mountain && w.terrain[t] !== Terrain.Snow) continue;
      const d = (x - x0) ** 2 + (y - y0) ** 2;
      if (d < best) {
        best = d;
        lair = t;
      }
    }
    const c = this.spawn('dragon', (lair % size) + 0.5, Math.floor(lair / size) + 0.5, true);
    c.lair = lair;
    c.leaveAt = w.state.tick + (DRAGON_MONTHS[0] + w.rand.int(DRAGON_MONTHS[1] - DRAGON_MONTHS[0] + 1)) * TICKS_PER_MONTH;
    w.record.add('creature', `A dragon came out of the mountains${w.disasters.nearName(lair)}.`, lair);
    w.disasters.strikes(lair, 60);
  }

  private dragonStep(c: Creature) {
    const w = this.w;
    const d = CREATURES.dragon;
    const tick = w.state.tick;
    // Time to go home: it flies back to its lair and is gone.
    if (c.leaveAt !== undefined && tick >= c.leaveAt) {
      const lx = (c.lair! % w.size) + 0.5;
      const ly = Math.floor(c.lair! / w.size) + 0.5;
      if ((lx - c.x) ** 2 + (ly - c.y) ** 2 < 1) {
        this.remove(c);
        w.record.add('creature', `The dragon flew back into the mountains.`, c.lair);
      } else this.moveToward(c, lx, ly, d.speed, true);
      return;
    }
    if ((tick + c.id) % 10 === 0) this.callDefenders(c);
    if (c.foe !== undefined) return this.attackPerson(c);
    // Over a settlement: it burns what is below it, now and then.
    if ((tick + c.id) % DRAGON_BREATH === 0) this.breathe(c);
    if (c.tx === undefined || c.ty === undefined || (c.tx - c.x) ** 2 + (c.ty - c.y) ** 2 < 0.25) {
      // Somewhere to go: a building of the nearest settlement, or around its lair.
      const target = this.dragonTarget(c);
      c.tx = target[0];
      c.ty = target[1];
    }
    this.moveToward(c, c.tx, c.ty, d.speed, true);
  }

  private dragonTarget(c: Creature): [number, number] {
    const w = this.w;
    let best: Settlement | null = null;
    let bestD = 90 * 90;
    for (const s of w.towns.settlements) {
      if (s.abandoned) continue;
      const sx = (s.center % w.size) + 0.5;
      const sy = Math.floor(s.center / w.size) + 0.5;
      const dd = (sx - c.x) ** 2 + (sy - c.y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = s;
      }
    }
    if (best) {
      const mine = w.towns.buildings.filter((b) => b.settlement === best!.id);
      const b = mine.length ? mine[w.rand.int(mine.length)] : null;
      const t = b ? b.tile : best.center;
      return [(t % w.size) + 0.5 + w.rand.next(), Math.floor(t / w.size) + 0.5 + w.rand.next()];
    }
    const a = w.rand.next() * Math.PI * 2;
    return [(c.lair! % w.size) + Math.cos(a) * 15, Math.floor(c.lair! / w.size) + Math.sin(a) * 15];
  }

  /** The dragon's fire: a building under it catches, people under it are burned, and livestock taken. */
  private breathe(c: Creature) {
    const w = this.w;
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.floor(c.x) + dx;
        const y = Math.floor(c.y) + dy;
        if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
        const t = y * w.size + x;
        const b = w.towns.buildingAt(t);
        if (b && b.progress >= 1 && b.fire === undefined && b.kind !== BuildingKind.Campfire) {
          w.disasters.ignite(b);
          hit = true;
          break;
        }
        if (w.towns.trees[t] > 0 && w.rand.next() < 0.3) w.disasters.burnForest(t);
      }
    }
    w.military.strike(c.x, c.y, c.x + 0.5, c.y + 0.8, 4);
    this.peopleNear(c.x, c.y, 2, (p) => {
      p.health -= DRAGON_BURN_HURT * (0.5 + w.rand.next());
      if (p.health <= 0) this.killPerson(p, c);
    });
    for (const o of this.list.slice()) if (o.pen !== undefined && (o.x - c.x) ** 2 + (o.y - c.y) ** 2 < 4) this.remove(o);
  }

  // ---------------------------------------------------------------- the player

  /** Places animals of a kind on the tiles given (SPEC 4: placing units). Returns how many. */
  place(tiles: number[], kind: CreatureKind): number {
    const w = this.w;
    if (!CREATURE_KINDS.includes(kind)) return 0;
    if (kind === 'dragon') {
      if (tiles.length) this.dragon(tiles[0]);
      return tiles.length ? 1 : 0;
    }
    let n = 0;
    for (const t of tiles) {
      if (!Number.isInteger(t) || t < 0 || t >= w.size * w.size || !this.canStand(kind, t)) continue;
      this.spawn(kind, (t % w.size) + 0.3 + w.rand.next() * 0.4, Math.floor(t / w.size) + 0.3 + w.rand.next() * 0.4, true);
      n++;
    }
    return n;
  }

  /** Removes the animals on the given tiles. */
  removeOn(tiles: number[]) {
    const set = new Set(tiles);
    const w = this.w;
    for (const c of this.list.slice()) if (set.has(Math.floor(c.y) * w.size + Math.floor(c.x))) this.remove(c);
  }

  /** Someone gone: animals following or fighting them stop. */
  onGone(p: Person) {
    for (const c of this.list) {
      if (c.follow === p.id) delete c.follow;
      if (c.foe === p.id) delete c.foe;
    }
  }

  /** Beasts on settlements' land call out defenders; checked every few steps from step(). */
  private defend() {
    const w = this.w;
    for (const c of this.list) {
      if (c.kind === 'dragon' || c.tame !== undefined) continue;
      const temper = CREATURES[c.kind].temper;
      if (temper !== 'hunter' && c.foe === undefined) continue;
      if (w.towns.territory[Math.floor(c.y) * w.size + Math.floor(c.x)] === 0 && c.foe === undefined) continue;
      this.callDefenders(c);
    }
  }

  // ---------------------------------------------------------------- reading

  details(id: number): CreatureDetails | null {
    const c = this.byId.get(id);
    if (!c) return null;
    const w = this.w;
    const d = CREATURES[c.kind];
    const doing =
      c.kind === 'dragon'
        ? c.leaveAt !== undefined && w.state.tick >= c.leaveAt
          ? 'Flying home'
          : c.foe !== undefined
            ? 'Fighting'
            : 'Burning what it finds'
        : c.follow !== undefined
          ? 'Following its herder'
          : c.pen !== undefined
            ? 'Grazing in its pasture'
            : c.foe !== undefined
              ? 'Fighting'
              : c.chase !== undefined
                ? 'Hunting'
                : c.flee !== undefined
                  ? 'Running'
                  : d.temper === 'hunter' && (c.hunger ?? 0) >= HUNGRY
                    ? 'Hungry, on the prowl'
                    : 'Roaming';
    return {
      id: c.id,
      kind: c.kind,
      health: Math.max(0, Math.round((c.health / d.health) * 100)),
      ageYears: Math.floor((w.state.tick - c.born) / TICKS_PER_YEAR),
      tame: c.tame !== undefined ? w.towns.settlementName(c.tame) : undefined,
      doing,
    };
  }

  /** For drawing: ID, x, y, kind, flags per animal. */
  snapshot(): Float32Array {
    const out = new Float32Array(this.list.length * 5);
    const tick = this.w.state.tick;
    let k = 0;
    for (const c of this.list) {
      const moving = (c.tx !== undefined && c.ty !== undefined && (c.tx - c.x) ** 2 + (c.ty - c.y) ** 2 > 0.04) || c.follow !== undefined || c.flee !== undefined || c.chase !== undefined || c.kind === 'dragon';
      const young = tick - c.born < TICKS_PER_YEAR;
      const flags = (moving ? 1 : 0) | (this.facing.get(c.id) ? 2 : 0) | (c.tame !== undefined ? 4 : 0) | (young ? 8 : 0) | (c.foe !== undefined || c.chase !== undefined ? 16 : 0);
      out[k++] = c.id;
      out[k++] = c.x;
      out[k++] = c.y;
      out[k++] = CREATURE_KINDS.indexOf(c.kind);
      out[k++] = flags;
    }
    return out;
  }

  /** A copy for saving. */
  save(): Creature[] {
    return this.list.map((c) => ({ ...c }));
  }
}
