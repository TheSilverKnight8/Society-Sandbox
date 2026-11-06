import { Terrain, isWater, Deposit } from '../map/terrain';
import { BUILDINGS, BuildingKind } from './buildings';
import { ADULT_AGE, TICKS_PER_MONTH, type Building, type DisasterKind, type EffectKind, type Nation, type Person, type WorldDisasters } from './types';
import { Sky } from './weather';
import type { World } from './world';

// Disasters (Stage 6; SPEC 3: they never reshape the land; SPEC 10: they hit individuals,
// buildings and resources, may be sim-triggered (a rule) or set going by the player (SPEC 4)).
//
// Fire spreads from building to building, faster in drought and slower in rain, and through
// forest; townspeople come to put out fires in their settlement. Floods cover low land beside
// rivers and lakes for a while: crops are lost, berries washed away, some of a flooded store
// spoiled, and walking is slow. Earthquakes bring buildings down and hurt people near them. A
// plague starts in a settlement and spreads person to person (see weather.ts). Locusts drift
// over the land eating crops and berries. Droughts and storms come with the weather (weather.ts);
// a dragon now and then (creatures.ts). Each is written in the record and is a major event for
// the nations it strikes (SPEC 7).

/** Chance each month (sim-triggered events) of each disaster somewhere on the map. */
const MONTHLY: Partial<Record<DisasterKind, number>> = { flood: 0.01, earthquake: 0.004, locusts: 0.008, dragon: 0.002 };
/** Chance each month that fire breaks out in a settlement with at least this many buildings, and that a plague breaks out in one with at least this many people. */
const FIRE_CHANCE = 0.004;
const FIRE_BUILDINGS = 8;
const PLAGUE_CHANCE = 0.0015;
const PLAGUE_PEOPLE = 60;
/** Floods mostly come in spring. */
const SPRING_FLOODS = 3;
/** How near (tiles) and how likely (each look, every 5 steps) fire leaps from a burning building to one near it. */
const LEAP = 2;
const LEAP_CHANCE = 0.005;
/** Work it takes to put out a building's fire (one person's step each), and how many come to fight one fire at most. */
const DOUSE_NEED = 90;
const DOUSERS = 5;
/** How far (tiles) townspeople come from to fight a fire. */
const DOUSE_RANGE = 18;
/** Steps a fire burns before the building is lost (see Military.step), when lit by lightning or a spreading fire. */
const BURN = 300;
/** Steps a forest tile burns, the chance each look (every 10 steps) that fire spreads to trees beside it, and most tiles burning at once. */
const FOREST_BURN = 60;
const FOREST_SPREAD = 0.18;
const MAX_BURNING = 800;
/** Health lost each look by someone standing in a forest fire. */
const FIRE_HURT = 6;
/** A flood's reach (tiles out from the water) and months. */
const FLOOD_REACH = [3, 6];
const FLOOD_MONTHS = [1, 3];
/** Walking speed on flooded land. */
const FLOOD_WALK = 0.55;
/** Share of a flooded store's food and wood spoiled. */
const FLOOD_SPOIL = 0.3;
/** An earthquake's reach (tiles), and the chance a building at its middle falls (less further out). */
const QUAKE_R = [10, 16];
const QUAKE_FALL = 0.5;
const QUAKE_HURT = 45;
/** A swarm's size (tiles), months, and drift (tiles a step). */
const SWARM_R = [5, 9];
const SWARM_MONTHS = [2, 3];
const SWARM_SPEED = 0.06;
/** How many fall sick when a plague starts in a settlement. */
const PLAGUE_START = 3;

export class Disasters {
  private w: World;
  readonly st: WorldDisasters;
  /** Flooded tiles, and forest tiles on fire. */
  private flooded = new Set<number>();
  private burningSet = new Set<number>();
  /** The disasters' drawing changed since the app last heard. */
  changed = true;
  /** An earthquake struck since the last snapshot (its middle tile). */
  quake: number | undefined;

  constructor(w: World) {
    this.w = w;
    w.state.disasters ??= { floods: [], swarms: [], burning: [] };
    this.st = w.state.disasters;
    for (const f of this.st.floods) for (const t of f.tiles) this.flooded.add(t);
    for (let k = 0; k < this.st.burning.length; k += 2) this.burningSet.add(this.st.burning[k]);
  }

  // ---------------------------------------------------------------- every step

  step() {
    const w = this.w;
    const tick = w.state.tick;
    if (tick % 5 === 0) this.buildingFires();
    if (tick % 10 === 0 && this.st.burning.length) this.forestFires();
    if (tick % 25 === 12) this.drift();
    if (tick % TICKS_PER_MONTH === 37 && w.toggles.events) this.monthly();
  }

  /** Fires leap between buildings; townspeople come to put them out; rain helps. */
  private buildingFires() {
    const w = this.w;
    const T = w.towns;
    const burning = T.buildings.filter((b) => b.fire !== undefined);
    if (!burning.length) return;
    // Who is already on their way to each fire (counted once).
    const coming = new Map<number, number>();
    for (const p of w.state.people) if (p.fireAt !== undefined) coming.set(p.fireAt, (coming.get(p.fireAt) ?? 0) + 1);
    for (const b of burning) {
      const t = b.tile;
      const sky = w.weather.skyAt(t);
      // Rain and snow damp a fire down.
      if (sky === Sky.Rain || sky === Sky.Storm || sky === Sky.Snow) b.douse = (b.douse ?? 0) + 4;
      if ((b.douse ?? 0) >= DOUSE_NEED) {
        this.putOut(b);
        continue;
      }
      // Leaping to a building near it.
      const dry = w.weather.dryAt(t);
      const chance = LEAP_CHANCE * (dry ? 2.5 : 1) * (sky === Sky.Rain || sky === Sky.Storm ? 0.3 : 1);
      for (const o of this.near(b, LEAP)) {
        if (o.fire === undefined && o.progress >= 1 && o.kind !== BuildingKind.Campfire && w.rand.next() < chance) this.ignite(o);
      }
      // Townspeople come to fight it (not while enemies are on their land).
      if (b.settlement !== undefined && !w.military.underAttack.has(b.settlement)) this.callDousers(b, coming.get(b.id) ?? 0);
    }
  }

  /** Buildings within some tiles of a building (footprint to footprint, roughly). */
  private near(b: Building, r: number): Building[] {
    const T = this.w.towns;
    const out: Building[] = [];
    const size = this.w.size;
    const bx = b.tile % size;
    const by = Math.floor(b.tile / size);
    const span = 6 + r;
    for (const o of T.buildings) {
      if (o === b) continue;
      const ox = o.tile % size;
      const oy = Math.floor(o.tile / size);
      if (Math.abs(ox - bx) <= span && Math.abs(oy - by) <= span) {
        // Nearest tiles of the two.
        let close = false;
        for (const t of T.tilesOf(o)) {
          const tx = t % size;
          const ty = Math.floor(t / size);
          for (const u of T.tilesOf(b)) if (Math.max(Math.abs(tx - (u % size)), Math.abs(ty - Math.floor(u / size))) <= r) {
            close = true;
            break;
          }
          if (close) break;
        }
        if (close) out.push(o);
      }
    }
    return out;
  }

  /** Sets a building alight (lightning, a spreading fire, or the player). */
  ignite(b: Building, steps = BURN) {
    if (b.fire !== undefined || b.kind === BuildingKind.Campfire) return;
    b.fire = steps;
    b.douse = 0;
    this.w.towns.buildingsChanged = true;
    // Anyone asleep inside wakes and comes out.
    for (const p of this.w.state.people) {
      if (p.home === b.id && p.indoors) {
        this.w.stop(p);
        delete p.indoors;
      }
    }
  }

  private putOut(b: Building) {
    delete b.fire;
    delete b.douse;
    this.w.towns.buildingsChanged = true;
  }

  /** Grown-ups of a building's settlement nearby go to put out its fire. */
  private callDousers(b: Building, coming: number) {
    const w = this.w;
    if (coming >= DOUSERS) return;
    const door = w.towns.economy.doorTile(b);
    const dx = (door % w.size) + 0.5;
    const dy = Math.floor(door / w.size) + 0.5;
    // People near it (from the animals' grid of people, refreshed every few steps).
    w.creatures.peopleNear(dx, dy, DOUSE_RANGE, (p) => {
      if (coming >= DOUSERS) return;
      if (p.settlement !== b.settlement || p.fireAt !== undefined || p.criminal || p.soldier || p.task === 'sleep' || p.task === 'fight' || p.task === 'douse' || p.task === 'hunt') return;
      if (w.ageOf(p) < ADULT_AGE || p.health < 30) return;
      w.stop(p);
      p.fireAt = b.id;
      w.goTo(p, door, 'douse');
      coming++;
    });
  }

  /** Someone has come to a fire: they set to putting it out. */
  arrive(p: Person, purpose: Person['purpose']): boolean {
    if (purpose !== 'douse') return false;
    const b = p.fireAt !== undefined ? this.w.towns.byBuildingId(p.fireAt) : undefined;
    if (!b || b.fire === undefined) {
      delete p.fireAt;
      p.task = 'idle';
      p.wait = 5;
      return true;
    }
    p.task = 'douse';
    p.wait = 60;
    return true;
  }

  /** A step of putting out a fire. */
  douse(p: Person) {
    const b = p.fireAt !== undefined ? this.w.towns.byBuildingId(p.fireAt) : undefined;
    if (!b || b.fire === undefined || --p.wait <= 0) {
      delete p.fireAt;
      p.task = 'idle';
      p.wait = 5;
      return;
    }
    b.douse = (b.douse ?? 0) + 1;
    if (b.douse >= DOUSE_NEED) this.putOut(b);
  }

  /** Someone gave up putting out a fire (stopped for something else). */
  dropDouse(p: Person) {
    delete p.fireAt;
  }

  /** Forest fires burn trees down and spread to trees beside them; people in them are hurt. */
  private forestFires() {
    const w = this.w;
    const T = w.towns;
    const size = w.size;
    const list = this.st.burning;
    const next: number[] = [];
    const lit: number[] = [];
    for (let k = 0; k < list.length; k += 2) {
      const t = list[k];
      const left = list[k + 1] - 10;
      const sky = w.weather.skyAt(t);
      const wet = sky === Sky.Rain || sky === Sky.Storm || sky === Sky.Snow;
      if (left <= 0 || wet) {
        this.burningSet.delete(t);
        T.burnTrees(t);
        continue;
      }
      next.push(t, left);
      const chance = FOREST_SPREAD * (w.weather.dryAt(t) ? 2 : 1);
      const x = t % size;
      const y = Math.floor(t / size);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const n = ny * size + nx;
          if (this.burningSet.has(n) || w.rand.next() >= chance) continue;
          if (T.trees[n] > 0) lit.push(n);
          else {
            const b = T.buildingAt(n);
            if (b && b.progress >= 1) this.ignite(b);
          }
        }
      }
    }
    this.st.burning = next;
    for (const t of lit) this.burnForest(t);
    // People caught in it are hurt.
    if (this.burningSet.size) {
      for (const p of w.state.people) {
        if (!this.burningSet.has(w.tileOf(p))) continue;
        p.health -= FIRE_HURT;
        if (p.health <= 0) w.kill(p, 'fire');
      }
    }
    this.changed = true;
  }

  /** Sets trees on a tile alight. */
  burnForest(t: number) {
    if (this.burningSet.has(t) || this.burningSet.size >= MAX_BURNING || this.w.towns.trees[t] <= 0) return;
    this.burningSet.add(t);
    this.st.burning.push(t, FOREST_BURN + this.w.rand.int(40));
    this.changed = true;
  }

  /** Floods recede; swarms drift and eat. */
  private drift() {
    const w = this.w;
    const tick = w.state.tick;
    const floods = this.st.floods.filter((f) => f.until > tick);
    if (floods.length !== this.st.floods.length) {
      this.st.floods = floods;
      this.flooded.clear();
      for (const f of floods) for (const t of f.tiles) this.flooded.add(t);
      this.changed = true;
    }
    if (!this.st.swarms.length) return;
    this.st.swarms = this.st.swarms.filter((s) => s.until > tick);
    for (const s of this.st.swarms) {
      s.x += s.vx * 25;
      s.y += s.vy * 25;
      this.eatCrops(s.x, s.y, s.r);
    }
    this.changed = true;
  }

  /** Locusts eat the crops on farms and the berries under them. */
  private eatCrops(x: number, y: number, r: number) {
    const w = this.w;
    const T = w.towns;
    let ate = false;
    for (const b of T.buildings) {
      if (b.kind !== BuildingKind.Farm || !(b.growth ?? 0)) continue;
      const bx = (b.tile % w.size) + 1;
      const by = Math.floor(b.tile / w.size) + 1;
      if ((bx - x) ** 2 + (by - y) ** 2 > r * r) continue;
      b.growth = 0;
      ate = true;
    }
    if (ate) T.buildingsChanged = true;
    this.overTiles(x, y, r, (t) => {
      if (w.deposit[t] === Deposit.Berries) w.spoilFood(t, 1);
    });
  }

  private overTiles(x: number, y: number, r: number, f: (t: number, d2: number) => void) {
    const size = this.w.size;
    for (let ty = Math.max(0, Math.floor(y - r)); ty <= Math.min(size - 1, Math.ceil(y + r)); ty++) {
      for (let tx = Math.max(0, Math.floor(x - r)); tx <= Math.min(size - 1, Math.ceil(x + r)); tx++) {
        const d2 = (tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2;
        if (d2 <= r * r) f(ty * size + tx, d2);
      }
    }
  }

  /** Sim-triggered disasters (SPEC 10: a rule). */
  private monthly() {
    const w = this.w;
    const season = w.weather.season();
    // Fire and plague, settlement by settlement.
    const T = w.towns;
    const built = new Map<number, Building[]>();
    for (const b of T.buildings) {
      if (b.settlement === undefined || b.progress < 1 || b.kind === BuildingKind.Campfire) continue;
      const l = built.get(b.settlement);
      if (l) l.push(b);
      else built.set(b.settlement, [b]);
    }
    for (const s of T.settlements) {
      if (s.abandoned) continue;
      const mine = built.get(s.id) ?? [];
      if (mine.length >= FIRE_BUILDINGS && w.rand.next() < FIRE_CHANCE) this.trigger('fire', mine[w.rand.int(mine.length)].tile);
      if (T.peopleOf(s) >= PLAGUE_PEOPLE && w.rand.next() < PLAGUE_CHANCE) this.trigger('plague', s.center);
    }
    for (const [kind, chance] of Object.entries(MONTHLY) as [DisasterKind, number][]) {
      const c = kind === 'flood' && season === 0 ? chance * SPRING_FLOODS : kind === 'locusts' && (season === 3 || season === 0) ? 0 : chance;
      if (w.rand.next() >= c) continue;
      const tile = this.pickSpot(kind);
      if (tile >= 0) this.trigger(kind, tile);
    }
  }

  /** Where a sim-triggered disaster strikes: a settlement for fire, plague and earthquakes; land by water for floods; anywhere on land for the rest. */
  private pickSpot(kind: DisasterKind): number {
    const w = this.w;
    const alive = w.towns.settlements.filter((s) => !s.abandoned && w.towns.peopleOf(s) > 0);
    if (kind === 'fire') {
      const homes = w.towns.buildings.filter((b) => b.progress >= 1 && b.kind !== BuildingKind.Campfire && b.settlement !== undefined);
      return homes.length ? homes[w.rand.int(homes.length)].tile : -1;
    }
    if (kind === 'plague') {
      const big = alive.filter((s) => w.towns.peopleOf(s) >= 30);
      return big.length ? big[w.rand.int(big.length)].center : -1;
    }
    if (kind === 'earthquake' || kind === 'flood') {
      // Near people, so it is felt (a quake in an empty wild is not much of an event).
      if (alive.length && w.rand.next() < 0.7) {
        const s = alive[w.rand.int(alive.length)];
        if (kind === 'earthquake') return s.center;
        const shore = this.waterNear(s.center, 30);
        if (shore >= 0) return shore;
      }
      return kind === 'flood' ? -1 : this.randomLand();
    }
    return this.randomLand();
  }

  /** A water tile within some tiles of a tile (nearest first, roughly), or -1. */
  private waterNear(tile: number, r: number): number {
    const w = this.w;
    const size = w.size;
    const x0 = tile % size;
    const y0 = Math.floor(tile / size);
    for (let d = 1; d <= r; d++) {
      for (let k = 0; k < 8 * d; k++) {
        const a = (k / (8 * d)) * Math.PI * 2;
        const x = Math.round(x0 + Math.cos(a) * d);
        const y = Math.round(y0 + Math.sin(a) * d);
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const t = y * size + x;
        if (isWater(w.terrain[t])) return t;
      }
    }
    return -1;
  }

  /** A random tile of land (not water or mountain), or -1. */
  randomLand(): number {
    const w = this.w;
    for (let k = 0; k < 60; k++) {
      const t = w.rand.int(w.size * w.size);
      const ter = w.terrain[t];
      if (!isWater(ter) && ter !== Terrain.Mountain && ter !== Terrain.Snow) return t;
    }
    return -1;
  }

  // ---------------------------------------------------------------- disasters

  /** Sets a disaster going at a tile (the sim, or the player: SPEC 4). */
  trigger(kind: DisasterKind, tile: number) {
    const w = this.w;
    if (!Number.isInteger(tile) || tile < 0 || tile >= w.size * w.size) return;
    switch (kind) {
      case 'fire':
        return this.startFire(tile);
      case 'flood':
        return this.flood(tile);
      case 'earthquake':
        return this.earthquake(tile);
      case 'plague':
        return this.plague(tile);
      case 'locusts':
        return this.locusts(tile);
      case 'drought':
        return w.weather.drought(tile);
      case 'storm': {
        const x = (tile % w.size) + 0.5;
        const y = Math.floor(tile / w.size) + 0.5;
        w.weather.addFront('storm', x, y, 14, 2 * TICKS_PER_MONTH, true);
        w.weather.refresh();
        w.record.add('disaster', `A great storm broke${this.nearName(tile)}.`, tile);
        this.strikes(tile, 20);
        return;
      }
      case 'dragon':
        return w.creatures.dragon(tile);
    }
  }

  /** Lightning from a storm: a building or trees struck may catch fire. */
  lightning(tile: number) {
    const w = this.w;
    const b = w.towns.buildingAt(tile);
    if (b && b.progress >= 1 && b.kind !== BuildingKind.Campfire && b.fire === undefined && w.rand.next() < 0.5) {
      this.ignite(b);
      w.record.add('disaster', `Lightning set ${BUILDINGS[b.kind].name.toLowerCase()} alight${this.inName(b.settlement)}.`, tile);
      this.strikes(tile, 10);
    } else if (w.towns.trees[tile] > 0 && w.rand.next() < (w.weather.dryAt(tile) ? 0.3 : 0.08)) {
      // Trees catch more easily in a drought.
      this.burnForest(tile);
      w.record.add('disaster', `Lightning started a forest fire${this.nearName(tile)}.`, tile);
    }
  }

  private startFire(tile: number) {
    const w = this.w;
    let b = w.towns.buildingAt(tile);
    if (b && b.kind === BuildingKind.Campfire) b = undefined;
    if (!b) {
      // Trees here: a forest fire.
      if (w.towns.trees[tile] > 0) {
        this.burnForest(tile);
        w.record.add('disaster', `A forest fire broke out${this.nearName(tile)}.`, tile);
        return;
      }
      // Else the nearest building within a few tiles.
      let best: Building | undefined;
      let bestD = 4 * 4;
      for (const o of w.towns.buildings) {
        const d = w.towns.dist2(o.tile, tile);
        if (d < bestD && o.progress >= 1 && o.kind !== BuildingKind.Campfire) {
          bestD = d;
          best = o;
        }
      }
      b = best;
    }
    if (!b || b.kind === BuildingKind.Campfire) return;
    this.ignite(b);
    w.record.add('disaster', `Fire broke out in ${BUILDINGS[b.kind].name.toLowerCase()}${this.inName(b.settlement)}.`, b.tile);
    this.strikes(b.tile, 10);
  }

  /** Water rises over low land beside the water nearest a tile. */
  private flood(tile: number) {
    const w = this.w;
    const size = w.size;
    const start = isWater(w.terrain[tile]) ? tile : this.waterNear(tile, 30);
    if (start < 0) return;
    const reach = FLOOD_REACH[0] + w.rand.int(FLOOD_REACH[1] - FLOOD_REACH[0] + 1);
    const level = w.elevation[start];
    // Land within `reach` tiles of the water around the start, and not much higher than it.
    const sx = start % size;
    const sy = Math.floor(start / size);
    const R = 18;
    const dist = new Map<number, number>();
    const queue: number[] = [];
    for (let y = Math.max(0, sy - R); y <= Math.min(size - 1, sy + R); y++) {
      for (let x = Math.max(0, sx - R); x <= Math.min(size - 1, sx + R); x++) {
        const t = y * size + x;
        if (isWater(w.terrain[t])) {
          dist.set(t, 0);
          queue.push(t);
        }
      }
    }
    const tiles: number[] = [];
    for (let k = 0; k < queue.length; k++) {
      const t = queue[k];
      const d = dist.get(t)!;
      if (d >= reach) continue;
      const x = t % size;
      const y = Math.floor(t / size);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < sx - R || ny < sy - R || nx > sx + R || ny > sy + R || nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const n = ny * size + nx;
        if (dist.has(n) || w.terrain[n] === Terrain.Mountain || w.elevation[n] > level + 3) continue;
        dist.set(n, d + 1);
        queue.push(n);
        tiles.push(n);
      }
    }
    if (!tiles.length) return;
    const months = FLOOD_MONTHS[0] + w.rand.int(FLOOD_MONTHS[1] - FLOOD_MONTHS[0] + 1);
    this.st.floods.push({ x: sx + 0.5, y: sy + 0.5, r: R, until: w.state.tick + months * TICKS_PER_MONTH, tiles });
    for (const t of tiles) this.flooded.add(t);
    // Crops, berries and stores under the water.
    const T = w.towns;
    const hit = new Set<Building>();
    for (const t of tiles) {
      const b = T.buildingAt(t);
      if (b) hit.add(b);
      if (w.deposit[t] === Deposit.Berries) w.spoilFood(t, 99);
    }
    for (const b of hit) {
      if (b.kind === BuildingKind.Farm) b.growth = 0;
      if (b.kind === BuildingKind.Storehouse && b.settlement !== undefined) {
        const s = T.byId(b.settlement);
        if (s) {
          const st = T.economy.stockOf(s);
          st.food = Math.floor(st.food * (1 - FLOOD_SPOIL));
          st.wood = Math.floor(st.wood * (1 - FLOOD_SPOIL));
        }
      }
    }
    T.buildingsChanged = true;
    T.settlementsChanged = true;
    this.changed = true;
    w.record.add('disaster', `A flood covered the land${this.nearName(start)}.`, start);
    this.strikes(start, 25);
  }

  /** Whether a tile is under floodwater, and how fast someone walks there. */
  floodedAt(t: number) {
    return this.flooded.has(t);
  }

  walkFactor(t: number) {
    return this.flooded.size && this.flooded.has(t) ? FLOOD_WALK : 1;
  }

  /** The ground shakes: buildings near the middle fall, and people near them are hurt. */
  private earthquake(tile: number) {
    const w = this.w;
    const T = w.towns;
    const size = w.size;
    const r = QUAKE_R[0] + w.rand.next() * (QUAKE_R[1] - QUAKE_R[0]);
    const x = (tile % size) + 0.5;
    const y = Math.floor(tile / size) + 0.5;
    let fell = 0;
    for (const b of T.buildings.slice()) {
      if (b.kind === BuildingKind.Campfire) continue;
      const bx = (b.tile % size) + 1;
      const by = Math.floor(b.tile / size) + 1;
      const d = Math.hypot(bx - x, by - y);
      if (d > r) continue;
      // Stone stands better than timber; a castle best.
      const sturdy = b.kind === BuildingKind.Castle ? 0.25 : BUILDINGS[b.kind].stone > BUILDINGS[b.kind].wood ? 0.6 : 1;
      if (w.rand.next() < QUAKE_FALL * (1 - d / r) * sturdy) {
        T.destroy(b);
        fell++;
      }
    }
    let died = 0;
    for (const p of w.state.people.slice()) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > r || !w.byId.has(p.id)) continue;
      // Worse indoors, where things fall on them.
      p.health -= QUAKE_HURT * (1 - d / r) * (p.indoors ? 1.4 : 1) * (0.5 + w.rand.next());
      if (p.health <= 0) {
        w.kill(p, 'earthquake');
        died++;
      }
    }
    this.quake = tile;
    w.record.add('disaster', `An earthquake struck${this.nearName(tile)}: ${fell} building${fell === 1 ? '' : 's'} fell and ${died} ${died === 1 ? 'person' : 'people'} died.`, tile);
    this.strikes(tile, r + 10);
  }

  /** A sickness breaks out among the people at or nearest a tile (spreading, see weather.ts). */
  private plague(tile: number) {
    const w = this.w;
    const x = (tile % w.size) + 0.5;
    const y = Math.floor(tile / w.size) + 0.5;
    let near = w.state.people.filter((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= 9);
    if (!near.length) {
      // The nearest settlement's people.
      let best = -1;
      let bestD = 40 * 40;
      for (const s of w.towns.settlements) {
        if (s.abandoned) continue;
        const d = w.towns.dist2(s.center, tile);
        if (d < bestD) {
          bestD = d;
          best = s.id;
        }
      }
      near = best >= 0 ? w.state.people.filter((p) => p.settlement === best) : [];
    }
    if (!near.length) return;
    let n = 0;
    for (let k = 0; k < near.length * 3 && n < PLAGUE_START; k++) if (w.weather.sicken(near[w.rand.int(near.length)], true)) n++;
    const at = near[0];
    w.record.add('disaster', `A plague broke out${this.inName(at.settlement) || this.nearName(w.tileOf(at))}.`, w.tileOf(at));
    this.strikes(w.tileOf(at), 15);
  }

  /** A swarm of locusts comes down at a tile and drifts. */
  private locusts(tile: number) {
    const w = this.w;
    const a = w.rand.next() * Math.PI * 2;
    const r = SWARM_R[0] + w.rand.next() * (SWARM_R[1] - SWARM_R[0]);
    const months = SWARM_MONTHS[0] + w.rand.int(SWARM_MONTHS[1] - SWARM_MONTHS[0] + 1);
    const x = (tile % w.size) + 0.5;
    const y = Math.floor(tile / w.size) + 0.5;
    this.st.swarms.push({ x, y, vx: Math.cos(a) * SWARM_SPEED, vy: Math.sin(a) * SWARM_SPEED, r, until: w.state.tick + months * TICKS_PER_MONTH });
    this.eatCrops(x, y, r);
    this.changed = true;
    w.record.add('disaster', `A swarm of locusts came down${this.nearName(tile)}.`, tile);
    this.strikes(tile, 25);
  }

  // ---------------------------------------------------------------- effects (the player)

  /** Sets an effect going over some tiles (SPEC 4: effects are status effects and weather). */
  effect(kind: EffectKind, tiles: number[]) {
    const w = this.w;
    if (kind === 'rain' || kind === 'snow' || kind === 'fog' || kind === 'clear') return w.weather.setWeather(kind, tiles);
    const set = new Set(tiles);
    for (const p of w.state.people) {
      if (!set.has(w.tileOf(p))) continue;
      if (kind === 'sicken') w.weather.sicken(p, true);
      else {
        w.weather.recover(p);
        p.health = 100;
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  /** " near <settlement>" for the nearest settlement within 40 tiles, else "". */
  nearName(tile: number): string {
    const T = this.w.towns;
    let best: string | undefined;
    let bestD = 40 * 40;
    for (const s of T.settlements) {
      if (s.abandoned) continue;
      const d = T.dist2(s.center, tile);
      if (d < bestD) {
        bestD = d;
        best = s.name;
      }
    }
    if (best && bestD < 6 * 6) return ` at ${best}`;
    return best ? ` near ${best}` : '';
  }

  private inName(id: number | undefined): string {
    const name = this.w.towns.settlementName(id);
    return name ? ` in ${name}` : '';
  }

  /** A disaster is a major event for the nations whose settlements it strikes (SPEC 7). */
  strikes(tile: number, r: number) {
    const T = this.w.towns;
    const hit = new Set<Nation>();
    for (const s of T.settlements) {
      if (s.abandoned || s.nation === undefined || T.dist2(s.center, tile) > r * r) continue;
      const n = this.w.nations.byId.get(s.nation);
      if (n && n.destroyed === undefined) hit.add(n);
    }
    if (hit.size) this.w.nations.majorEvents([...hit]);
  }

  /** What the app draws. */
  view() {
    const burning: number[] = [];
    for (let k = 0; k < this.st.burning.length; k += 2) burning.push(this.st.burning[k]);
    return { flooded: [...this.flooded], swarms: this.st.swarms.map((s) => ({ x: s.x, y: s.y, r: s.r })), burning };
  }
}
