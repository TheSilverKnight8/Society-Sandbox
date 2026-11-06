import { ARMS, BASE_PRICE, BUILDINGS, BuildingKind, GOODS, type Good } from './buildings';
import { GOOD_TECH } from './tech';
import { ADULT_AGE, TICKS_PER_YEAR, Wall, TileField, type Armor, type Army, type Nation, type Person, type PersonDetails, type Settlement, type SoldierKind, type War, type Weapon } from './types';
import type { World } from './world';

// Military and war (Stage 5; SPEC 6, 9 and 10).
//
// Nations keep standing armies (Caleb): soldiers hold jobs at barracks and are paid from the
// nation's treasury, by the conscription policy (a levy fills the barracks first and pays
// little; volunteers are paid more and serve only while the treasury can pay). Each barracks
// has an army commanded by a unique leader (SPEC 9), succeeded when they fall (SPEC 10).
// Soldiers' arms are goods (Caleb): armorers make spears, swords, bows, crossbows, mail, plate
// and catapults from iron ore and wood, grooms raise horses, and soldiers fetch what their
// part in the army calls for from the store; technology opens the better kinds.
//
// Fights are settled between individuals by their stats and equipment (SPEC 9; SPEC 10: always
// on). Townspeople fight enemies who come onto their land (Caleb: regular citizens fight if the
// fight comes to them). Nations at rivalry may go to war (SPEC 10: a rule); armies then march on
// enemy settlements, break gates and fences that bar the way, fight what defends them, and take
// a settlement once nobody is left to defend it: it changes hands, its treasury and store are
// plundered, and buildings may be burned (Caleb: conquest, plunder, destruction). Wars end in
// peace once a side is worn out or after long enough, the more worn-out side paying tribute
// (Caleb).

export const WEAPONS: Record<Weapon | 'none', { name: string; damage: number; range: number; every: number }> = {
  none: { name: 'Bare hands or tools', damage: 4, range: 1.1, every: 10 },
  spear: { name: 'Spear', damage: 9, range: 1.5, every: 10 },
  sword: { name: 'Sword', damage: 12, range: 1.1, every: 10 },
  bow: { name: 'Bow', damage: 7, range: 7, every: 14 },
  crossbow: { name: 'Crossbow', damage: 11, range: 8, every: 18 },
};
/** Share of each blow armor turns aside. */
export const ARMOR: Record<Armor, { name: string; guard: number }> = { mail: { name: 'Mail', guard: 0.35 }, plate: { name: 'Plate', guard: 0.55 } };
/** Horses carry a rider this much faster and make their melee blows this much harder; catapults are slow and strike hard at range. */
const HORSE_SPEED = 1.6;
/** Soldiers strike this much harder than townspeople (drill). */
const TRAINED = 1.5;
const HORSE_CHARGE = 1.25;
const ENGINE = { damage: 12, range: 9, every: 30, speed: 0.6, walls: 4 };
/** What each kind of arms takes to make (at the armory, or the stable for horses). */
export const RECIPES: Partial<Record<Good, Partial<Record<Good, number>>>> = {
  spear: { iron: 1, wood: 1 },
  sword: { iron: 2 },
  bow: { wood: 2 },
  crossbow: { iron: 2, wood: 1 },
  mail: { iron: 3 },
  plate: { iron: 5 },
  engine: { wood: 10, iron: 2 },
  horse: { food: 4 },
};
/** Steps between looks for an enemy; how far soldiers see one, and how far townspeople come out to fight. */
const LOOK_EVERY = 10;
const SIGHT = 9;
const DEFEND_SIGHT = 6;
/** Townspeople this badly hurt leave the fight. */
const FLEE_HEALTH = 35;
const WALK_SPEED = 0.15;
/** How much a fence and a gate can take before they break. */
const WALL_HEALTH = { fence: 40, gate: 80 };
/** Monthly pay for a soldier from the nation's treasury, by conscription. */
const PAY = { levy: 0.5, volunteers: 1 };
/** Chance a year that a nation at rivalry with a neighbour declares war (doubled for martial cultures). */
const WAR_CHANCE = 0.12;
/** An army needs this many soldiers to march on a settlement; it goes home this long after taking one. */
const MARCH_MIN = 5;
const HOLD_AFTER_TAKING = TICKS_PER_YEAR;
/** Shares carried off from a settlement that falls: of its treasury, and of its store. */
const PLUNDER = { coins: 0.4, goods: 0.3 };
/** Food a soldier takes from the store before marching out. */
const PROVISIONS = 3;
/** Steps a burning building burns before it is gone. */
const BURN_STEPS = 300;

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

export class Military {
  private w: World;
  armies: Army[];
  byId = new Map<number, Army>();
  /** People who might fight now (soldiers, and grown-ups in settlements at war), by cell, rebuilt every few steps. */
  private grid = new Map<number, Person[]>();
  /** Whether any war is on, and whether any fight could happen (a war, or bandits raiding): nothing here runs otherwise. */
  private atWar = false;
  private active = false;
  /** Settlements with enemy soldiers on their land. */
  underAttack = new Set<number>();
  /** Fences and gates that have been struck: how much they have left. */
  private wallHealth = new Map<number, number>();
  changed = true;
  /** Blows (from x, from y, to x, to y, kind) and the fallen (x, y, look, gear, sex) since the last snapshot. */
  private shots: number[] = [];
  private falls: number[] = [];
  /** Someone has fallen since the views were last refreshed. */
  private fell = false;

  constructor(w: World) {
    this.w = w;
    const st = w.state;
    st.armies ??= [];
    st.nextArmyId ??= 1;
    this.armies = st.armies;
    for (const a of this.armies) this.byId.set(a.id, a);
  }

  private get nations() {
    return this.w.nations;
  }

  // ---------------------------------------------------------------- who is who

  /** The nation someone fights for: a soldier's army's, or their settlement's. */
  nationOf(p: Person): number | undefined {
    if (p.soldier && p.army !== undefined) return this.byId.get(p.army)?.nation;
    const s = p.settlement !== undefined ? this.w.towns.byId(p.settlement) : undefined;
    return s?.nation;
  }

  atWarWith(a: number | undefined, b: number | undefined) {
    return a !== undefined && b !== undefined && a !== b && this.nations.relation(a, b) === 'war';
  }

  hostile(p: Person, q: Person) {
    // Bandits on a raid, and soldiers against any bandit (Stage 6: criminals).
    if (p.criminal || q.criminal) return this.w.crime.outlaws(p, q);
    return this.atWarWith(this.nationOf(p), this.nationOf(q));
  }

  /** A soldier's kind, from their arms. */
  kindOf(p: Person): SoldierKind {
    if (p.engine) return 'artillery';
    if (p.horse) return 'cavalry';
    if (p.weapon === 'bow' || p.weapon === 'crossbow') return 'archer';
    return 'infantry';
  }

  /** The kind each soldier of an army should be: archers, cavalry and artillery in shares, as the nation's technology allows. */
  private roleOf(p: Person, army: Army): SoldierKind {
    const n = this.nations.byId.get(army.nation);
    const techs = new Set(n?.techs ?? []);
    const k = p.id % 20;
    if (techs.has('engineering') && k === 0) return 'artillery';
    if (techs.has('horsemanship') && k >= 1 && k <= 5) return 'cavalry';
    if (techs.has('archery') && k >= 6 && k <= 11) return 'archer';
    return 'infantry';
  }

  /** What a soldier of this kind should carry, best first, as the nation's technology allows. */
  private wants(kind: SoldierKind, techs: Set<string>): { weapon?: Weapon[]; armor: Armor[]; horse: boolean; engine: boolean } {
    const armor: Armor[] = [...(techs.has('plate') ? (['plate'] as Armor[]) : []), ...(techs.has('mail') ? (['mail'] as Armor[]) : [])];
    const melee: Weapon[] = techs.has('ironWorking') ? ['sword', 'spear'] : [];
    const ranged: Weapon[] = [...(techs.has('crossbows') ? (['crossbow'] as Weapon[]) : []), ...(techs.has('archery') ? (['bow'] as Weapon[]) : [])];
    if (kind === 'archer') return { weapon: ranged, armor: armor.filter((a) => a === 'mail'), horse: false, engine: false };
    if (kind === 'cavalry') return { weapon: melee, armor, horse: true, engine: false };
    if (kind === 'artillery') return { weapon: melee.slice(1), armor: [], horse: false, engine: true };
    return { weapon: melee, armor, horse: false, engine: false };
  }

  // ---------------------------------------------------------------- every step

  /** Every step: the grid of who might fight, fires burning down. */
  step() {
    const w = this.w;
    const tick = w.state.tick;
    if (tick % 25 === 0 && this.fell) {
      this.fell = false;
      this.changed = true;
    }
    if (tick % 5 === 0) {
      this.atWar = this.nations.relations.some((r) => r.kind === 'war');
      const raiders = w.crime.raiders;
      this.active = this.atWar || raiders.length > 0;
      this.grid.clear();
      this.underAttack.clear();
      if (this.active) {
        const warring = new Set<number>();
        for (const r of this.nations.relations) if (r.kind === 'war') warring.add(r.a).add(r.b);
        // Settlements with bandits on their land.
        const raided = new Set<number>();
        for (const r of raiders) {
          const own = w.towns.territory[w.tileOf(r)];
          if (own) raided.add(own);
        }
        for (const s of raided) this.underAttack.add(s);
        for (const p of w.state.people) {
          if (w.ageOf(p) < ADULT_AGE) continue;
          const n = this.nationOf(p);
          const inWar = n !== undefined && warring.has(n);
          const inRaid = raiders.length > 0 && (p.criminal ? !!p.raid : !!p.soldier || (p.settlement !== undefined && raided.has(p.settlement)));
          if (!inWar && !inRaid) continue;
          const cell = this.cell(p.x, p.y);
          const list = this.grid.get(cell);
          if (list) list.push(p);
          else this.grid.set(cell, [p]);
          if (p.soldier && inWar) {
            const own = w.towns.territory[w.tileOf(p)];
            const s = own ? w.towns.byId(own) : undefined;
            if (s && this.atWarWith(n, s.nation)) this.underAttack.add(s.id);
          }
        }
      }
    }
    // Burning buildings burn down.
    for (const b of w.towns.buildings) {
      if (b.fire === undefined) continue;
      if (--b.fire <= 0) {
        delete b.fire;
        w.towns.destroy(b);
      }
    }
  }

  private cell(x: number, y: number) {
    return Math.floor(y / 8) * 1024 + Math.floor(x / 8);
  }

  /** The nearest enemy within a distance, from the grid. */
  private nearestFoe(p: Person, range: number): Person | null {
    const cx = Math.floor(p.x / 8);
    const cy = Math.floor(p.y / 8);
    const r = Math.ceil(range / 8);
    let best: Person | null = null;
    let bestD = range * range;
    for (let gy = cy - r; gy <= cy + r; gy++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        for (const q of this.grid.get(gy * 1024 + gx) ?? []) {
          if (q === p || !this.w.byId.has(q.id) || q.indoors || !this.hostile(p, q)) continue;
          // Soldiers do not chase townspeople who are not fighting (bandits on a raid are fair game).
          if (!q.soldier && q.task !== 'fight' && !(q.criminal && q.raid)) continue;
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
    }
    return best;
  }

  /** Whether enemies are near someone (SPEC 6: their safety need). */
  danger(p: Person): boolean {
    if (!this.active) return false;
    const cx = Math.floor(p.x / 8);
    const cy = Math.floor(p.y / 8);
    for (let gy = cy - 2; gy <= cy + 2; gy++) {
      for (let gx = cx - 2; gx <= cx + 2; gx++) {
        for (const q of this.grid.get(gy * 1024 + gx) ?? []) if ((q.soldier || (q.criminal && q.raid)) && this.hostile(p, q) && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 100) return true;
      }
    }
    return false;
  }

  /**
   * A person's part in a fight this step: soldiers fight enemies they see; grown-ups fight
   * enemy soldiers on their own settlement's land. Returns true when they are fighting (and do
   * nothing else this step).
   */
  fight(p: Person): boolean {
    const w = this.w;
    if (p.cooldown) p.cooldown--;
    if (p.siegeTile !== undefined) return this.siege(p);
    if (!this.active) {
      if (p.task === 'fight') this.stand(p);
      return false;
    }
    // Someone the player ordered to attack fights like a soldier on the way (SPEC 4); so do bandits on a raid.
    const soldier = !!p.soldier || p.order?.kind === 'attack' || (!!p.criminal && !!p.raid);
    if (!soldier) {
      // Townspeople only fight on their own land, when enemy soldiers are there.
      if (p.settlement === undefined || !this.underAttack.has(p.settlement) || w.ageOf(p) < ADULT_AGE || w.ageOf(p) >= 60 || p.task === 'sleep') {
        if (p.task === 'fight') this.stand(p);
        return false;
      }
      // Badly hurt, they stop and go home (indoors, out of the fight).
      if (p.health < FLEE_HEALTH) {
        if (p.task === 'fight') {
          this.stand(p);
          const bed = w.towns.bed(p);
          if (bed >= 0) w.goTo(p, bed, 'home');
        }
        return false;
      }
    }
    let foe = p.foe !== undefined ? w.byId.get(p.foe) : undefined;
    const sight = soldier ? SIGHT : DEFEND_SIGHT;
    if (foe && ((foe.x - p.x) ** 2 + (foe.y - p.y) ** 2 > (sight * 1.5) ** 2 || !this.hostile(p, foe) || foe.indoors)) foe = undefined;
    if (!foe && (w.state.tick + p.id) % LOOK_EVERY === 0) {
      foe = this.nearestFoe(p, sight) ?? undefined;
      if (!soldier && foe) {
        // Only an enemy soldier standing on this settlement's land.
        const own = w.towns.territory[w.tileOf(foe)];
        if (own !== p.settlement) foe = undefined;
      }
    }
    if (!foe) {
      delete p.foe;
      if (p.task === 'fight') this.stand(p);
      return false;
    }
    p.foe = foe.id;
    const weapon = p.engine ? null : WEAPONS[p.weapon ?? 'none'];
    const range = p.engine ? ENGINE.range : weapon!.range + (p.horse ? 0.3 : 0);
    const d = Math.hypot(foe.x - p.x, foe.y - p.y);
    if (p.task === 'sleep') delete p.indoors;
    if (d > range) {
      // On the way round something by a path: let the walk go on.
      if (p.purpose === 'chase' && (p.task === 'walk' || (p.task === 'idle' && p.wait === Infinity))) return false;
      if (!this.approach(p, foe)) {
        w.stop(p);
        w.goTo(p, w.tileOf(foe), 'chase');
      }
      return true;
    }
    p.task = 'fight';
    if (p.cooldown) return true;
    // A blow: weapon (or catapult), horse, experience and luck, less the foe's armor.
    let dmg = p.engine ? ENGINE.damage : weapon!.damage;
    if (p.horse && !p.engine && weapon!.range < 2) dmg *= HORSE_CHARGE;
    dmg *= 1 + Math.min(0.3, (p.kills ?? 0) * 0.02);
    // Soldiers are drilled (a levy less so); townspeople fight with what they have.
    const n = this.nationOf(p);
    if (p.soldier) dmg *= n !== undefined && this.nations.byId.get(n)?.policies.conscription === 'levy' ? TRAINED * 0.85 : TRAINED;
    dmg *= 0.75 + w.rand.next() * 0.5;
    if (foe.armor) dmg *= 1 - ARMOR[foe.armor].guard;
    foe.health -= dmg;
    p.cooldown = p.engine ? ENGINE.every : weapon!.every;
    this.blow(p, foe.x, foe.y);
    if (foe.health <= 0) {
      p.kills = (p.kills ?? 0) + 1;
      this.fallen(foe, p);
      this.falls.push(foe.x, foe.y, foe.look, this.gearOf(foe), foe.sex);
      if (p.criminal) {
        w.crime.murdered(foe);
        if (p.raid) p.raid.done = true;
      }
      w.kill(foe, p.criminal ? 'bandits' : 'battle');
      delete p.foe;
    }
    return true;
  }

  /** A blow struck, for the app to draw: a swing landing, or an arrow, bolt or stone in flight. */
  private blow(p: Person, tx: number, ty: number) {
    const kind = p.engine ? 3 : p.weapon === 'crossbow' ? 2 : p.weapon === 'bow' ? 1 : 0;
    this.shots.push(p.x, p.y, tx, ty, kind);
  }

  /** A blow struck by someone or something else (a beast, a hunter, a bandit), for the app to draw: 0 a swing, 1 an arrow, 2 a bolt, 3 a stone, 4 fire. */
  strike(x: number, y: number, tx: number, ty: number, kind: number) {
    this.shots.push(x, y, tx, ty, kind);
  }

  /** Someone has fallen (to a beast, a bandit, a disaster), for the app to draw where they lie. */
  fallAt(p: Person) {
    this.falls.push(p.x, p.y, p.look, this.gearOf(p), p.sex);
  }

  /** Blows struck and people fallen since the last snapshot (taken by the snapshot). */
  takeEffects(): { shots: Float32Array; falls: Float32Array } {
    const out = { shots: Float32Array.from(this.shots), falls: Float32Array.from(this.falls) };
    this.shots = [];
    this.falls = [];
    return out;
  }

  /** Moves straight toward a foe. Returns false when something is in the way (then they go round by a path). */
  private approach(p: Person, foe: Person): boolean {
    const w = this.w;
    const speed = (WALK_SPEED * this.speedOf(p)) / w.finder.cost(w.tileOf(p));
    const d = Math.hypot(foe.x - p.x, foe.y - p.y);
    const nx = p.x + ((foe.x - p.x) / d) * Math.min(speed, d);
    const ny = p.y + ((foe.y - p.y) / d) * Math.min(speed, d);
    const t = Math.floor(ny) * w.size + Math.floor(nx);
    if (!w.finder.walkable(t) || this.bars(p, t)) return false;
    if (p.task === 'walk' || p.wait === Infinity) w.stop(p);
    p.x = nx;
    p.y = ny;
    p.task = 'fight';
    return true;
  }

  /** Back to standing after a fight. */
  private stand(p: Person) {
    this.w.stop(p);
    p.wait = 5;
    delete p.foe;
  }

  /** Someone has fallen in battle: their side's losses in the war. */
  private fallen(dead: Person, by: Person) {
    const a = this.nationOf(dead);
    const b = this.nationOf(by);
    if (a === undefined || b === undefined) return;
    const war = this.warBetween(a, b);
    if (war) war.lost[a] = (war.lost[a] ?? 0) + 1;
    // The app's nation views are refreshed for losses every few steps (see step), not at every fall.
    this.fell = true;
  }

  // ---------------------------------------------------------------- gates and fences

  /** Whether a fence or gate on this tile bars a soldier's way (its settlement is at war with their nation). */
  bars(p: Person, t: number): boolean {
    if (!p.soldier) return false;
    const v = this.w.towns.walls[t];
    if (v !== Wall.Fence && v !== Wall.Gate) return false;
    const own = this.w.towns.territory[t];
    const s = own ? this.w.towns.byId(own) : undefined;
    return this.atWarWith(this.nationOf(p), s?.nation);
  }

  /** A soldier breaking a gate or fence in their way (Caleb: armies can burn and break fences). */
  private siege(p: Person): boolean {
    const w = this.w;
    const t = p.siegeTile!;
    const v = w.towns.walls[t];
    if (v !== Wall.Fence && v !== Wall.Gate) {
      delete p.siegeTile;
      p.task = 'walk';
      return true;
    }
    p.task = 'fight';
    if (p.cooldown) return true;
    const weapon = WEAPONS[p.weapon ?? 'none'];
    const dmg = p.engine ? ENGINE.damage * ENGINE.walls : weapon.range > 2 ? weapon.damage * 0.3 : weapon.damage;
    this.blow(p, (t % w.size) + 0.5, Math.floor(t / w.size) + 0.5);
    const left = (this.wallHealth.get(t) ?? (v === Wall.Gate ? WALL_HEALTH.gate : WALL_HEALTH.fence)) - dmg;
    p.cooldown = p.engine ? ENGINE.every : weapon.every;
    if (left > 0) {
      this.wallHealth.set(t, left);
      return true;
    }
    this.wallHealth.delete(t);
    w.towns.walls[t] = Wall.None;
    w.tileChange(t, TileField.Walls, Wall.None);
    delete p.siegeTile;
    p.task = 'walk';
    return true;
  }

  // ---------------------------------------------------------------- soldiers' days

  /**
   * What a soldier does when not fighting and their needs are met: fetch the arms their part
   * calls for, carry plunder home, follow their army's order, or keep near their barracks and drill.
   */
  soldierWork(p: Person): boolean {
    const w = this.w;
    const army = p.army !== undefined ? this.byId.get(p.army) : undefined;
    if (!army) return false;
    const home = w.towns.byId(army.home);
    if (!home) return false;
    const here = w.tileOf(p);
    // Arms from the store, at home; provisions too before marching out.
    const store = w.towns.economy.storeTile(home, here);
    const provisions = !!army.order && army.order.kind !== 'return' && p.carry < 2 && w.towns.economy.stockOf(home).food > 0 && w.towns.dist2(here, store) < 20 * 20;
    if ((!army.order && this.lacking(p, army, home)) || provisions) {
      p.jobStep = 'fetch-gear';
      w.goTo(p, store, 'fetch');
      return true;
    }
    // Plunder goes to the treasury, at the barracks.
    if (p.loot) {
      w.goTo(p, this.musterTile(army, home), 'muster', true);
      return true;
    }
    const o = army.order;
    if (o && o.kind !== 'return') {
      const s = w.towns.byId(o.settlement);
      if (s) {
        // An enemy capital with a castle is taken at its castle (Caleb).
        const seat = o.kind === 'attack' ? w.towns.seatOf(s) : s.center;
        if (w.towns.dist2(here, seat) > 25) w.goTo(p, seat, 'muster', true);
        else this.strollNear(p, seat, 4);
        return true;
      }
    }
    const muster = this.musterTile(army, home);
    if (w.towns.dist2(here, muster) > 100) {
      w.goTo(p, muster, 'muster', true);
      return true;
    }
    // Drill by the barracks.
    if (army.barracks !== undefined && w.rand.next() < 0.5) {
      p.task = 'drill';
      p.wait = 60 + w.rand.int(60);
      return true;
    }
    this.strollNear(p, muster, 4);
    return true;
  }

  private strollNear(p: Person, tile: number, r: number) {
    const w = this.w;
    const x = (tile % w.size) + Math.round((w.rand.next() - 0.5) * 2 * r);
    const y = Math.floor(tile / w.size) + Math.round((w.rand.next() - 0.5) * 2 * r);
    const t = y * w.size + x;
    if (x < 0 || y < 0 || x >= w.size || y >= w.size || !w.finder.walkable(t)) {
      p.wait = 20;
      return;
    }
    w.goTo(p, t, 'muster');
  }

  private musterTile(army: Army, home: Settlement): number {
    const b = army.barracks !== undefined ? this.w.towns.byBuildingId(army.barracks) : undefined;
    return b ? this.w.towns.economy.doorTile(b) : home.center;
  }

  /** Whether the store at home holds something better for this soldier than what they carry. */
  private lacking(p: Person, army: Army, home: Settlement): boolean {
    const stock = this.w.towns.economy.stockOf(home);
    const n = this.nations.byId.get(army.nation);
    const want = this.wants(this.roleOf(p, army), new Set(n?.techs ?? []));
    const better = <T extends string>(list: T[] | undefined, have: T | undefined) => {
      if (!list) return false;
      for (const g of list) {
        if (g === have) return false;
        if (stock[g as unknown as Good] > 0) return true;
      }
      return false;
    };
    return better(want.weapon, p.weapon) || better(want.armor, p.armor) || (want.horse && !p.horse && stock.horse > 0) || (want.engine && !p.engine && stock.engine > 0);
  }

  /** At the store: a soldier takes the arms their part calls for (and puts back what they replace). */
  takeGear(p: Person, s: Settlement) {
    const army = p.army !== undefined ? this.byId.get(p.army) : undefined;
    if (!army) return;
    const stock = this.w.towns.economy.stockOf(s);
    const n = this.nations.byId.get(army.nation);
    const want = this.wants(this.roleOf(p, army), new Set(n?.techs ?? []));
    for (const g of want.weapon ?? []) {
      if (g === p.weapon) break;
      if (stock[g] > 0) {
        stock[g]--;
        if (p.weapon) stock[p.weapon]++;
        p.weapon = g;
        break;
      }
    }
    for (const g of want.armor) {
      if (g === p.armor) break;
      if (stock[g] > 0) {
        stock[g]--;
        if (p.armor) stock[p.armor]++;
        p.armor = g;
        break;
      }
    }
    if (want.horse && !p.horse && stock.horse > 0) {
      stock.horse--;
      p.horse = true;
    }
    if (want.engine && !p.engine && stock.engine > 0) {
      stock.engine--;
      p.engine = true;
    }
    // Provisions for the march (the nation feeds its soldiers).
    const food = Math.min(PROVISIONS - p.carry, stock.food);
    if (army.order && army.order.kind !== 'return' && food > 0) {
      stock.food -= food;
      p.carry += food;
    }
    this.w.towns.settlementsChanged = true;
  }

  /** At the barracks: plunder goes into the nation's treasury. */
  muster(p: Person) {
    if (!p.loot) return;
    const army = p.army !== undefined ? this.byId.get(p.army) : undefined;
    const n = army ? this.nations.byId.get(army.nation) : undefined;
    if (n) {
      n.coins += p.loot;
      this.nations.changed = true;
    }
    delete p.loot;
  }

  /** What an armory or stable should make next: what its armies' soldiers lack most, that the store has the makings of. */
  nextArms(s: Settlement, kind: BuildingKind): Good | null {
    const w = this.w;
    const n = s.nation !== undefined ? this.nations.byId.get(s.nation) : undefined;
    if (!n) return null;
    const techs = new Set(n.techs ?? []);
    const stock = w.towns.economy.stockOf(s);
    const short = new Map<Good, number>();
    for (const a of this.armies) {
      if (a.nation !== n.id || a.home !== s.id) continue;
      for (const p of w.state.people) {
        if (p.army !== a.id || !p.soldier) continue;
        const want = this.wants(this.roleOf(p, a), techs);
        if (want.weapon?.length && !p.weapon) short.set(want.weapon[0], (short.get(want.weapon[0]) ?? 0) + 1);
        if (want.armor.length && !p.armor) short.set(want.armor[0], (short.get(want.armor[0]) ?? 0) + 1);
        if (want.horse && !p.horse) short.set('horse', (short.get('horse') ?? 0) + 1);
        if (want.engine && !p.engine) short.set('engine', (short.get('engine') ?? 0) + 1);
      }
    }
    let best: Good | null = null;
    let bestN = 0;
    for (const [g, k] of short) {
      const need = k - stock[g];
      if (need <= 0 || (g === 'horse') !== (kind === BuildingKind.Stable)) continue;
      const tech = GOOD_TECH[g];
      if (tech && !techs.has(tech)) continue;
      const recipe = RECIPES[g]!;
      if (!Object.entries(recipe).every(([x, m]) => stock[x as Good] >= (m ?? 0))) continue;
      if (need > bestN) {
        bestN = need;
        best = g;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- the monthly round

  monthly() {
    const w = this.w;
    const tick = w.state.tick;
    const month = Math.floor(tick / (TICKS_PER_YEAR / 12)) % 12;
    this.keepArmies();
    this.payAndLead();
    if (this.nations.relations.some((r) => r.kind === 'war')) {
      this.orders();
      this.taking();
    }
    if (month === 3) this.yearly();
  }

  /** An army for each barracks of a nation; soldiers are those who hold a job at one (and those the player placed). */
  private keepArmies() {
    const w = this.w;
    const T = w.towns;
    for (const b of T.buildings) {
      if (b.kind !== BuildingKind.Barracks || b.progress < 1) continue;
      const s = b.settlement !== undefined ? T.byId(b.settlement) : undefined;
      let a = this.armies.find((x) => x.barracks === b.id);
      if (!s || s.nation === undefined) {
        if (a) this.disband(a);
        continue;
      }
      if (a && a.nation !== s.nation) {
        this.disband(a);
        a = undefined;
      }
      if (!a) this.newArmy(s.nation, s.id, b.id);
    }
    const manned = new Set<number>();
    for (const p of w.state.people) if (p.soldier && p.army !== undefined) manned.add(p.army);
    for (const a of [...this.armies]) {
      const n = this.nations.byId.get(a.nation);
      const barracksGone = a.barracks !== undefined && !T.byBuildingId(a.barracks);
      // An army of placed soldiers is gone once they are.
      const empty = a.barracks === undefined && !manned.has(a.id);
      if (!n || n.destroyed !== undefined || barracksGone || empty) this.disband(a);
    }
    for (const p of w.state.people) {
      const b = p.job !== undefined ? T.byBuildingId(p.job) : undefined;
      if (b && b.kind === BuildingKind.Barracks) {
        const a = this.armies.find((x) => x.barracks === b.id);
        if (a) {
          p.soldier = true;
          p.army = a.id;
        }
      } else if (p.soldier && (p.army === undefined || !this.byId.has(p.army) || this.byId.get(p.army)!.barracks !== undefined)) {
        // No longer at a barracks: back to ordinary life (their arms go back to the store).
        this.discharge(p);
      }
    }
  }

  private newArmy(nation: number, home: number, barracks?: number): Army {
    const w = this.w;
    const count = this.armies.filter((x) => x.nation === nation).length;
    const n = this.nations.byId.get(nation);
    const a: Army = {
      id: w.state.nextArmyId!++,
      nation,
      home,
      barracks,
      name: `${ORDINAL[count] ?? `${count + 1}th`} Army of ${n ? n.name.replace(/^(Kingdom|Commonwealth) of /, '') : ''}`,
    };
    this.armies.push(a);
    this.byId.set(a.id, a);
    this.changed = true;
    return a;
  }

  private disband(a: Army) {
    for (const p of this.w.state.people) if (p.army === a.id) this.discharge(p);
    this.armies.splice(this.armies.indexOf(a), 1);
    this.byId.delete(a.id);
    this.changed = true;
  }

  private discharge(p: Person) {
    const s = p.settlement !== undefined ? this.w.towns.byId(p.settlement) : undefined;
    if (s) {
      const stock = this.w.towns.economy.stockOf(s);
      if (p.weapon) stock[p.weapon]++;
      if (p.armor) stock[p.armor]++;
      if (p.horse) stock.horse++;
      if (p.engine) stock.engine++;
    }
    delete p.soldier;
    delete p.army;
    delete p.weapon;
    delete p.armor;
    delete p.horse;
    delete p.engine;
    delete p.foe;
    delete p.siegeTile;
    const b = p.job !== undefined ? this.w.towns.byBuildingId(p.job) : undefined;
    if (b?.kind === BuildingKind.Barracks) this.w.towns.economy.quit(p);
  }

  /** Soldiers are paid; volunteers whose nation cannot pay leave; each army has a leader (SPEC 9; SPEC 10: succession). */
  private payAndLead() {
    const w = this.w;
    const members = new Map<number, Person[]>();
    for (const p of w.state.people) {
      if (!p.soldier || p.army === undefined) continue;
      const l = members.get(p.army);
      if (l) l.push(p);
      else members.set(p.army, [p]);
    }
    for (const a of this.armies) {
      const n = this.nations.byId.get(a.nation);
      const people = members.get(a.id) ?? [];
      if (n) {
        // Paid from the nation's treasury, or else from their home settlement's.
        const pay = PAY[n.policies.conscription];
        const home = w.towns.byId(a.home);
        for (const p of people) {
          if (n.coins >= pay) {
            n.coins -= pay;
            p.coins = (p.coins ?? 0) + pay;
          } else if (home && (home.coins ?? 0) >= pay) {
            home.coins = (home.coins ?? 0) - pay;
            p.coins = (p.coins ?? 0) + pay;
          } else if (n.policies.conscription === 'volunteers' && a.barracks !== undefined && w.rand.next() < 0.25) {
            this.discharge(p);
          }
        }
      }
      // The leader: the soldier with the most victories (then influence) commands, and is unique.
      const leader = a.leader !== undefined ? w.byId.get(a.leader) : undefined;
      if (!leader || leader.army !== a.id || !leader.soldier) {
        const alive = people.filter((p) => p.soldier && w.byId.has(p.id));
        if (alive.length) {
          alive.sort((x, y) => (y.kills ?? 0) - (x.kills ?? 0) || this.nations.influence(y) - this.nations.influence(x));
          a.leader = alive[0].id;
          this.nations.makeUnique(alive[0], 'leader');
        } else delete a.leader;
        this.changed = true;
      }
    }
    this.nations.changed = true;
  }

  /** Nations at war give their armies orders: defend settlements enemies are in, else march on the nearest enemy settlement. */
  private orders() {
    const w = this.w;
    const T = w.towns;
    const sizes = new Map<number, number>();
    for (const p of w.state.people) if (p.soldier && p.army !== undefined) sizes.set(p.army, (sizes.get(p.army) ?? 0) + 1);
    for (const a of this.armies) {
      const n = this.nations.byId.get(a.nation);
      if (!n) continue;
      const enemies = this.nations.alive().filter((o) => this.atWarWith(n.id, o.id));
      const size = sizes.get(a.id) ?? 0;
      if (!enemies.length) {
        if (a.order) {
          a.order = { kind: 'return' };
          this.changed = true;
        }
        continue;
      }
      // Our settlements with enemies in them, nearest first.
      const home = T.byId(a.home);
      if (!home) continue;
      const threatened = this.nations
        .settlementsOf(n)
        .filter((s) => this.underAttack.has(s.id))
        .sort((x, y) => T.dist2(x.center, home.center) - T.dist2(y.center, home.center))[0];
      if (threatened && T.dist2(threatened.center, home.center) < 90 * 90) {
        a.order = { kind: 'defend', settlement: threatened.id };
        this.changed = true;
        continue;
      }
      if (a.tookAt !== undefined && w.state.tick - a.tookAt < HOLD_AFTER_TAKING) continue;
      if (size < MARCH_MIN) {
        if (a.order?.kind === 'attack') a.order = { kind: 'return' };
        continue;
      }
      if (a.order?.kind === 'attack' && T.byId(a.order.settlement)?.nation !== undefined && this.atWarWith(n.id, T.byId(a.order.settlement)!.nation)) continue;
      let target: Settlement | undefined;
      let best = 150 * 150;
      for (const e of enemies) {
        for (const s of this.nations.settlementsOf(e)) {
          const d = T.dist2(s.center, home.center);
          if (d < best) {
            best = d;
            target = s;
          }
        }
      }
      a.order = target ? { kind: 'attack', settlement: target.id } : { kind: 'return' };
      this.changed = true;
    }
  }

  /** An army at an enemy settlement takes it once no enemy soldier is left near it (Caleb: conquest, plunder, destruction). */
  private taking() {
    const w = this.w;
    const T = w.towns;
    for (const a of this.armies) {
      if (a.order?.kind !== 'attack') continue;
      const s = T.byId(a.order.settlement);
      if (!s || s.abandoned) {
        a.order = { kind: 'return' };
        continue;
      }
      // A settlement is taken where its seat is: its castle if it has one (Caleb), else its middle.
      const seat = T.seatOf(s);
      const near = (p: Person, r: number) => T.dist2(w.tileOf(p), seat) <= r * r;
      const ours = w.state.people.filter((p) => p.soldier && p.army === a.id && near(p, 8));
      if (ours.length < 3) continue;
      const defenders = w.state.people.filter((p) => p.soldier && this.atWarWith(this.nationOf(p), a.nation) && near(p, 10));
      if (defenders.length) continue;
      if (!this.atWarWith(a.nation, s.nation)) {
        a.order = { kind: 'return' };
        continue;
      }
      this.take(s, a, ours);
    }
  }

  private take(s: Settlement, a: Army, takers: Person[]) {
    const w = this.w;
    const loser = s.nation !== undefined ? this.nations.byId.get(s.nation) : undefined;
    // Plunder: a share of the treasury and of the store, carried home by the soldiers.
    const stock = w.towns.economy.stockOf(s);
    let value = Math.floor((s.coins ?? 0) * PLUNDER.coins);
    s.coins = (s.coins ?? 0) - value;
    for (const g of GOODS) {
      if (ARMS.includes(g)) continue;
      const take = Math.floor(stock[g] * PLUNDER.goods);
      stock[g] -= take;
      value += take * BASE_PRICE[g];
    }
    for (const p of takers) p.loot = (p.loot ?? 0) + value / takers.length;
    // A building or two burns.
    const burnable = w.towns.buildings.filter((b) => b.settlement === s.id && b.progress >= 1 && b.kind !== BuildingKind.Campfire && b.fire === undefined);
    for (let k = 0; k < 2 && burnable.length; k++) {
      if (w.rand.next() < 0.5) continue;
      const b = burnable.splice(w.rand.int(burnable.length), 1)[0];
      b.fire = BURN_STEPS;
      w.towns.buildingsChanged = true;
    }
    // It changes hands; its people stay (Caleb).
    const winner = this.nations.byId.get(a.nation);
    if (winner) w.record.add('war', `The ${winner.name} took ${s.name}${loser ? ` from the ${loser.name}` : ''}.`, s.center);
    s.nation = a.nation;
    delete s.unrest;
    const war = loser ? this.warBetween(a.nation, loser.id) : undefined;
    if (war) war.taken[a.nation] = (war.taken[a.nation] ?? 0) + 1;
    a.order = { kind: 'return' };
    a.tookAt = w.state.tick;
    w.towns.settlementsChanged = true;
    this.nations.changed = true;
    this.changed = true;
  }

  /** Once a year: wars may end in peace; nations at rivalry may go to war (SPEC 10: a rule). */
  private yearly() {
    const w = this.w;
    const tick = w.state.tick;
    const strength = new Map<number, number>();
    for (const p of w.state.people) {
      const n = p.soldier ? this.nationOf(p) : undefined;
      if (n !== undefined) strength.set(n, (strength.get(n) ?? 0) + 1);
    }
    // Peace when a side is worn out, or after long enough (Caleb).
    for (const r of this.nations.relations) {
      if (r.kind !== 'war' || !r.war) continue;
      // Worn out: the share of its fighters a side has lost, and the settlements it has lost.
      const tired = (side: number) => {
        const lost = r.war!.lost[side] ?? 0;
        return lost / Math.max(5, lost + (strength.get(side) ?? 0)) + (r.war!.taken[side === r.a ? r.b : r.a] ?? 0) * 0.25;
      };
      const ta = tired(r.a);
      const tb = tired(r.b);
      const years = (tick - r.war.start) / TICKS_PER_YEAR;
      if (years < 1) continue;
      const chance = Math.min(0.9, Math.max(0, Math.max(ta, tb) - 0.5) + Math.max(0, years - 6) * 0.08);
      if (w.rand.next() < chance) this.makePeace(r.a, r.b, ta > tb ? r.a : r.b);
    }
    // War between rivals (SPEC 10: units declaring war, a rule; and sim-triggered events, another).
    if (!w.toggles.war || !w.toggles.events) return;
    const alive = this.nations.alive();
    for (const a of alive) {
      const mine = strength.get(a.id) ?? 0;
      if (mine < MARCH_MIN) continue;
      for (const b of alive) {
        if (a === b || this.nations.relation(a.id, b.id) !== 'rivalry') continue;
        const theirs = strength.get(b.id) ?? 0;
        const martial = this.nations.mainCulture(a)?.traits.temper === 'martial' ? 2 : 1;
        const odds = mine >= theirs * 1.2 ? 1.5 : 0.5;
        if (w.rand.next() < WAR_CHANCE * martial * odds) {
          this.declare(a, b);
          break;
        }
      }
    }
  }

  /** A nation declares war; the other's allies join it (SPEC 7: alliances; a major event). */
  declare(a: Nation, b: Nation) {
    if (this.atWarWith(a.id, b.id)) return;
    const strength = (n: Nation) => this.w.state.people.filter((p) => p.soldier && this.nationOf(p) === n.id).length;
    const war: War = { start: this.w.state.tick, by: a.id, strength: { [a.id]: strength(a), [b.id]: strength(b) }, lost: {}, taken: {} };
    this.nations.setWar(a.id, b.id, war);
    for (const ally of this.nations.alive()) {
      if (ally === a || ally === b || this.nations.relation(ally.id, b.id) !== 'alliance' || this.atWarWith(ally.id, a.id)) continue;
      this.nations.setWar(ally.id, a.id, { start: this.w.state.tick, by: ally.id, strength: { [ally.id]: strength(ally), [a.id]: strength(a) }, lost: {}, taken: {} });
    }
    const front = this.w.towns.byId(b.capital);
    this.w.record.add('war', `The ${a.name} declared war on the ${b.name}.`, front?.center);
    this.nations.majorEvents([a, b]);
    this.atWar = true;
    this.changed = true;
  }

  /** Peace: the more worn-out side pays tribute (a share of its treasury); they stand as rivals or at peace (Caleb). */
  makePeace(a: number, b: number, payer?: number) {
    const na = this.nations.byId.get(a);
    const nb = this.nations.byId.get(b);
    if (payer !== undefined && na && nb) {
      const from = payer === a ? na : nb;
      const to = payer === a ? nb : na;
      const tribute = Math.floor(from.coins * 0.3);
      from.coins -= tribute;
      to.coins += tribute;
    }
    if (na && nb) this.w.record.add('war', `The ${na.name} and the ${nb.name} made peace${payer !== undefined ? `; the ${(payer === a ? na : nb).name} paid tribute` : ''}.`);
    this.nations.endWar(a, b);
    for (const army of this.armies) if ((army.nation === a || army.nation === b) && army.order?.kind !== 'return') army.order = { kind: 'return' };
    this.nations.majorEvents([na, nb].filter((x): x is Nation => !!x));
    this.changed = true;
  }

  warBetween(a: number, b: number): War | undefined {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return this.nations.relations.find((r) => r.a === lo && r.b === hi && r.kind === 'war')?.war;
  }

  // ---------------------------------------------------------------- the player

  /** Places armed soldiers (SPEC 4: placing units) of the nation whose land each tile is on. Returns how many. */
  place(tiles: number[], kind: SoldierKind): number {
    const w = this.w;
    let placed = 0;
    for (const t of tiles) {
      const own = w.towns.territory[t] || w.towns.buildingAt(t)?.settlement;
      const s = own ? w.towns.byId(own) : undefined;
      if (!s || s.nation === undefined) continue;
      const before = w.state.people.length;
      if (!w.place([t])) continue;
      const p = w.state.people[before];
      // Placed soldiers belong to their nation's army without a barracks (one is raised for them).
      const army = this.armies.find((a) => a.nation === s.nation && a.barracks === undefined) ?? this.newArmy(s.nation, s.id);
      p.settlement = s.id;
      p.soldier = true;
      p.army = army.id;
      if (kind === 'archer') p.weapon = 'bow';
      else if (kind === 'artillery') {
        p.engine = true;
        p.weapon = 'spear';
      } else {
        p.weapon = 'sword';
        p.armor = 'mail';
        if (kind === 'cavalry') p.horse = true;
      }
      placed++;
    }
    this.changed = true;
    return placed;
  }

  // ---------------------------------------------------------------- the app

  /** Soldiers whose army has somewhere to be sleep in the open, not at home. */
  onCampaign(p: Person): boolean {
    if (!p.soldier || p.army === undefined) return false;
    return !!this.byId.get(p.army)?.order;
  }

  /** Whether a soldier is further than a short walk from home. */
  awayFromHome(p: Person): boolean {
    const army = p.army !== undefined ? this.byId.get(p.army) : undefined;
    const home = army ? this.w.towns.byId(army.home) : undefined;
    return !home || this.w.towns.dist2(this.w.tileOf(p), home.center) > 20 * 20;
  }

  /** How much faster (or slower) someone walks for a horse or a catapult. */
  speedOf(p: Person): number {
    return (p.horse ? HORSE_SPEED : 1) * (p.engine ? ENGINE.speed : 1);
  }

  detailsOf(p: Person): PersonDetails['soldier'] {
    if (!p.soldier) return undefined;
    const army = p.army !== undefined ? this.byId.get(p.army) : undefined;
    return { kind: this.kindOf(p), weapon: p.weapon, armor: p.armor, horse: !!p.horse, engine: !!p.engine, army: army?.name, leads: army?.leader === p.id, kills: p.kills ?? 0 };
  }

  gearOf(p: Person): number {
    if (!p.soldier) return 0;
    const wcode = p.weapon ? ['spear', 'sword', 'bow', 'crossbow'].indexOf(p.weapon) + 1 : 0;
    const acode = p.armor === 'plate' ? 2 : p.armor === 'mail' ? 1 : 0;
    const army = p.army !== undefined ? this.byId.get(p.army) : undefined;
    const n = army ? this.nations.byId.get(army.nation) : undefined;
    const leader = army?.leader === p.id ? 1 : 0;
    return wcode | (acode << 3) | (p.horse ? 32 : 0) | (p.engine ? 64 : 0) | (leader << 7) | ((n ? n.color + 1 : 0) << 8);
  }

  armyViews(n: Nation, members: Map<number, number>): { id: number; name: string; leader?: { id: number; name: string }; soldiers: number; order: string }[] {
    const w = this.w;
    return this.armies
      .filter((a) => a.nation === n.id)
      .map((a) => {
        const leader = a.leader !== undefined ? w.byId.get(a.leader) : undefined;
        const soldiers = members.get(a.id) ?? 0;
        const o = a.order;
        const target = o && o.kind !== 'return' ? w.towns.settlementName(o.settlement) : undefined;
        const order = !o ? 'At home' : o.kind === 'attack' ? `Marching on ${target}` : o.kind === 'defend' ? `Defending ${target}` : 'Coming home';
        return { id: a.id, name: a.name, leader: leader ? { id: leader.id, name: leader.unique?.name ?? `No. ${leader.id}` } : undefined, soldiers, order };
      });
  }

  /** Workers a barracks takes. */
  static barracksJobs = BUILDINGS[BuildingKind.Barracks].jobs;
}
