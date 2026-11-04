import { BuildingKind, type Good } from './buildings';
import { TICKS_PER_YEAR, type Culture, type CultureTraits, type Nation, type Person, type Settlement } from './types';
import type { World } from './world';

// Technology and research (Stage 4c; SPEC 7).
//
// Technology is tracked on cultures (SPEC 7). Every culture with people researches a little
// by itself; scholars at a scriptorium or a university research much faster (SPEC 7:
// research is done by the culture, expedited and enhanced by specific buildings; Caleb: its
// own building and worker). Technologies form a tree (Caleb): each has others it needs first,
// and some need goods in a store of the culture's settlements once the research is done
// (SPEC 7: technology advances through research and resources). The sim picks what a culture
// researches next by its traits, and the player can steer it (Caleb).
//
// A nation's technology comes fully from its main culture; its other cultures add some of
// theirs, by chance and only when the goods each needs are at hand (SPEC 7). A settlement
// uses its nation's technology, or its own culture's if it belongs to no nation. Technology
// opens buildings (some that existed before 4c are now locked behind it: Caleb), improvements
// to work, and two policy choices.

export type Age = 'Classical' | 'Early Medieval' | 'High Medieval' | 'Late Medieval';
type Pole = CultureTraits[keyof CultureTraits];

export interface TechDef {
  id: string;
  name: string;
  age: Age;
  /** Research it takes. */
  cost: number;
  /** Technologies known first (the tree). */
  needs: string[];
  /** Goods taken from a store of the culture's settlements when the research is done. */
  resource?: { good: Good; n: number };
  /** Traits that make a culture lean toward researching it. */
  lean: Pole[];
  /** What it opens or improves, for the panels. */
  opens: string;
}

export const TECHS: TechDef[] = [
  { id: 'writing', name: 'Writing', age: 'Classical', cost: 60, needs: [], lean: ['peaceful', 'progressive'], opens: 'Scriptorium (scholars research faster)' },
  { id: 'masonry', name: 'Masonry', age: 'Classical', cost: 60, needs: [], resource: { good: 'stone', n: 10 }, lean: ['hierarchical', 'traditional'], opens: 'Builders work a fifth faster' },
  { id: 'ironWorking', name: 'Iron working', age: 'Classical', cost: 80, needs: [], resource: { good: 'iron', n: 6 }, lean: ['martial'], opens: 'Smithy (tools from iron ore)' },
  { id: 'cropRotation', name: 'Crop rotation', age: 'Early Medieval', cost: 80, needs: [], lean: ['agrarian', 'traditional'], opens: 'Fields ripen a quarter faster' },
  { id: 'commerce', name: 'Commerce', age: 'Classical', cost: 80, needs: ['writing'], lean: ['mercantile'], opens: 'Market (traders)' },
  { id: 'law', name: 'Law', age: 'Classical', cost: 90, needs: ['writing'], lean: ['communal'], opens: 'Elective succession' },
  { id: 'mathematics', name: 'Mathematics', age: 'Classical', cost: 100, needs: ['writing'], lean: ['progressive', 'mercantile'], opens: 'Research a quarter faster' },
  { id: 'administration', name: 'Administration', age: 'Early Medieval', cost: 110, needs: ['writing', 'law'], lean: ['hierarchical'], opens: 'Hall (officials collect taxes)' },
  { id: 'fortification', name: 'Fortification', age: 'Early Medieval', cost: 110, needs: ['masonry'], resource: { good: 'wood', n: 10 }, lean: ['martial', 'traditional'], opens: 'Fences and gates for towns' },
  { id: 'coinage', name: 'Coinage', age: 'Classical', cost: 120, needs: ['commerce', 'ironWorking'], resource: { good: 'gold', n: 4 }, lean: ['mercantile', 'hierarchical'], opens: 'Mint (coins from gold ore)' },
  { id: 'heavyPlough', name: 'Heavy plough', age: 'Early Medieval', cost: 120, needs: ['ironWorking', 'cropRotation'], resource: { good: 'iron', n: 6 }, lean: ['agrarian'], opens: 'Harvests give 12 food instead of 10' },
  { id: 'feudalism', name: 'Feudalism', age: 'Early Medieval', cost: 120, needs: ['administration'], lean: ['hierarchical', 'martial'], opens: 'Levy (conscription)' },
  { id: 'architecture', name: 'Architecture', age: 'High Medieval', cost: 140, needs: ['masonry', 'mathematics'], resource: { good: 'stone', n: 20 }, lean: ['progressive', 'hierarchical'], opens: 'Townhouse' },
  { id: 'guilds', name: 'Guilds', age: 'High Medieval', cost: 150, needs: ['commerce', 'ironWorking'], lean: ['mercantile', 'communal'], opens: 'Workshops work a fifth faster' },
  { id: 'scholasticism', name: 'Scholasticism', age: 'High Medieval', cost: 180, needs: ['mathematics', 'architecture'], lean: ['peaceful', 'progressive'], opens: 'University (scholars research twice as fast)' },
  { id: 'banking', name: 'Banking', age: 'Late Medieval', cost: 200, needs: ['coinage', 'guilds'], resource: { good: 'gold', n: 6 }, lean: ['mercantile'], opens: 'Traders carry half again as much' },
  { id: 'printing', name: 'Printing press', age: 'Late Medieval', cost: 240, needs: ['scholasticism', 'guilds'], resource: { good: 'iron', n: 6 }, lean: ['progressive', 'communal'], opens: 'Research half again as fast' },
];
export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

/** Buildings that need a technology first (Caleb: some existing ones are now locked; and the new research buildings). */
export const BUILDING_TECH: Partial<Record<BuildingKind, string>> = {
  [BuildingKind.Market]: 'commerce',
  [BuildingKind.Smithy]: 'ironWorking',
  [BuildingKind.Mint]: 'coinage',
  [BuildingKind.Townhouse]: 'architecture',
  [BuildingKind.Hall]: 'administration',
  [BuildingKind.Scriptorium]: 'writing',
  [BuildingKind.University]: 'scholasticism',
};
/** Town fences and gates need this. */
export const FENCE_TECH = 'fortification';
/** Policy choices that need a technology first (SPEC 7: technology affects what policies a nation has). */
export const POLICY_TECH: Record<string, string> = { 'succession:elective': 'law', 'conscription:levy': 'feudalism' };

/** Research a culture does a year by itself: a little, more with more people. */
const BASE_RESEARCH = 5;
const RESEARCH_PER_PERSON = 0.2;
/** Research one scholar's spell of study gives, at each research building. */
const STUDY_POINTS: Partial<Record<BuildingKind, number>> = { [BuildingKind.Scriptorium]: 8, [BuildingKind.University]: 16 };
/** Chance a year that a nation takes up a technology one of its other cultures knows (when the goods it needs are at hand). */
const BORROW_CHANCE = 0.3;

export class Technology {
  private w: World;
  /** Each settlement's technologies (its nation's, or its culture's), rebuilt when anything changes. */
  private cache = new Map<number, Set<string>>();
  private none = new Set<string>();
  /** Research each culture did from study over the last year, for the panel. */
  private studied = new Map<number, number>();
  private studiedLastYear = new Map<number, number>();
  changed = true;

  constructor(w: World) {
    this.w = w;
  }

  // ---------------------------------------------------------------- reading

  /** The technologies a settlement can use. */
  techsOf(s: Settlement | undefined): Set<string> {
    if (!s) return this.none;
    let t = this.cache.get(s.id);
    if (!t) {
      const n = s.nation !== undefined ? this.w.nations.byId.get(s.nation) : undefined;
      if (n) t = new Set(n.techs ?? []);
      else {
        const c = this.w.cultures.dominant.get(s.id);
        t = new Set(c !== undefined ? (this.w.cultures.byId.get(c)?.techs ?? []) : []);
      }
      this.cache.set(s.id, t);
    }
    return t;
  }

  has(s: Settlement | undefined, tech: string) {
    return this.techsOf(s).has(tech);
  }

  /** Whether a settlement may build a building of this kind by itself. */
  canBuild(s: Settlement | undefined, kind: BuildingKind) {
    const need = BUILDING_TECH[kind];
    return !need || this.has(s, need);
  }

  /** Technologies a culture could research now (it knows what each needs, and not the technology itself). */
  available(c: Culture): string[] {
    const known = new Set(c.techs ?? []);
    return TECHS.filter((t) => !known.has(t.id) && t.needs.every((n) => known.has(n))).map((t) => t.id);
  }

  /** How fast a culture researches (its own technologies speed it; progressive cultures a little). */
  private speed(c: Culture) {
    const known = new Set(c.techs ?? []);
    let k = 1;
    if (known.has('mathematics')) k *= 1.25;
    if (known.has('printing')) k *= 1.5;
    if (c.traits.outlook === 'progressive') k *= 1.2;
    return k;
  }

  // ---------------------------------------------------------------- research

  /** Once a month: cultures research, finish technologies, pick what is next; nations take technology from their cultures. */
  monthly() {
    const w = this.w;
    const on = w.toggles.research;
    const month = Math.floor(w.state.tick / (TICKS_PER_YEAR / 12)) % 12;
    if (on) {
      for (const c of w.cultures.list) {
        if (c.extinct !== undefined) continue;
        const members = w.cultures.members.get(c.id) ?? 0;
        if (members <= 0) continue;
        this.finishWaiting(c);
        this.add(c, ((BASE_RESEARCH + RESEARCH_PER_PERSON * members) / 12) * this.speed(c));
      }
      for (const n of w.nations.alive()) this.derive(n, month === 0);
      this.changed = true;
    }
    if (month === 0) {
      this.studiedLastYear = this.studied;
      this.studied = new Map();
    }
    this.cache.clear();
  }

  /**
   * Adds research to a culture's current technology, finishing it if its goods are at hand.
   * A technology whose research is done but whose goods are missing waits, and the culture
   * researches something else meanwhile.
   */
  private add(c: Culture, points: number) {
    if (!c.research || (c.techs ?? []).includes(c.research) || this.isWaiting(c, c.research)) this.pickNext(c);
    const id = c.research;
    if (!id) return;
    const t = TECH_BY_ID.get(id)!;
    c.progress ??= {};
    if ((c.progress[id] ?? 0) >= t.cost) return; // everything left is waiting for goods
    c.progress[id] = Math.min(t.cost, (c.progress[id] ?? 0) + points);
    if (c.progress[id] >= t.cost) {
      if (this.takeResource(c, t)) this.learn(c, id);
      else this.pickNext(c);
    }
    // (Progress is shown to the app once a month, from monthly(), so panels are not redrawn for every spell of study.)
  }

  private learn(c: Culture, id: string) {
    c.techs = [...(c.techs ?? []), id];
    if (c.progress) delete c.progress[id];
    if (c.research === id) delete c.research;
    this.pickNext(c);
    this.cache.clear();
    this.w.towns.settlementsChanged = true;
    this.changed = true;
  }

  /** Whether a technology's research is done and it is waiting for goods. */
  private isWaiting(c: Culture, id: string) {
    const t = TECH_BY_ID.get(id);
    return !!t && (c.progress?.[id] ?? 0) >= t.cost && !(c.techs ?? []).includes(id);
  }

  /** Technologies waiting for goods are learned once the goods are in a store of the culture's settlements. */
  private finishWaiting(c: Culture) {
    for (const id of Object.keys(c.progress ?? {})) {
      if (!this.isWaiting(c, id)) continue;
      const t = TECH_BY_ID.get(id)!;
      if (t.needs.every((n) => (c.techs ?? []).includes(n)) && this.takeResource(c, t)) this.learn(c, id);
    }
  }

  /** Technologies whose research is done, waiting for goods. */
  waitingFor(c: Culture): string[] {
    return Object.keys(c.progress ?? {}).filter((id) => this.isWaiting(c, id));
  }

  /** Takes the goods a technology needs from a store of the culture's settlements, if any has enough. */
  private takeResource(c: Culture, t: TechDef): boolean {
    if (!t.resource) return true;
    const s = this.storeWith(c, t.resource.good, t.resource.n);
    if (!s) return false;
    this.w.towns.economy.stockOf(s)[t.resource.good] -= t.resource.n;
    this.w.towns.settlementsChanged = true;
    return true;
  }

  private storeWith(c: Culture, good: Good, n: number): Settlement | undefined {
    const C = this.w.cultures;
    return this.w.towns.settlements.find((s) => !s.abandoned && C.dominant.get(s.id) === c.id && this.w.towns.economy.stockOf(s)[good] >= n);
  }

  /** Picks what a culture researches next: by its traits, cheaper ones a little more often (Caleb: the sim picks by traits). */
  private pickNext(c: Culture) {
    const all = this.available(c);
    // Something not waiting for goods, if there is any.
    const open = all.filter((id) => !this.isWaiting(c, id));
    const options = (open.length ? open : all).map((id) => TECH_BY_ID.get(id)!);
    if (!options.length) {
      delete c.research;
      return;
    }
    const traits = Object.values(c.traits) as Pole[];
    const weights = options.map((t) => (1 + 2 * t.lean.filter((p) => traits.includes(p)).length) * (100 / t.cost));
    let r = this.w.rand.next() * weights.reduce((a, b) => a + b, 0);
    let k = 0;
    while (k < options.length - 1 && r > weights[k]) r -= weights[k++];
    c.research = options[k].id;
    this.changed = true;
  }

  /** A scholar finishes a spell of study at a research building: research for their culture. */
  study(p: Person, kind: BuildingKind) {
    if (!this.w.toggles.research) return;
    const s = p.settlement !== undefined ? this.w.towns.byId(p.settlement) : undefined;
    const cid = p.culture ?? (s ? this.w.cultures.dominant.get(s.id) : undefined);
    const c = cid !== undefined ? this.w.cultures.byId.get(cid) : undefined;
    if (!c) return;
    const points = (STUDY_POINTS[kind] ?? 0) * this.speed(c);
    this.studied.set(c.id, (this.studied.get(c.id) ?? 0) + points);
    this.add(c, points);
  }

  /** A nation's technology: all of its main culture's, and some of its other cultures' (SPEC 7: by chance and the goods at hand). */
  private derive(n: Nation, roll: boolean) {
    const w = this.w;
    const main = w.nations.mainCulture(n);
    const mainTechs = new Set(main?.techs ?? []);
    const others = new Map<string, number>(); // technology → people of other cultures knowing it
    const ids = new Set(w.nations.settlementsOf(n).map((s) => s.id));
    const holders = new Map<number, number>();
    for (const p of w.state.people) if (p.settlement !== undefined && ids.has(p.settlement) && p.culture !== undefined && p.culture !== main?.id) holders.set(p.culture, (holders.get(p.culture) ?? 0) + 1);
    for (const [cid, count] of holders) {
      if (count < 5) continue;
      for (const t of w.cultures.byId.get(cid)?.techs ?? []) if (!mainTechs.has(t)) others.set(t, (others.get(t) ?? 0) + count);
    }
    const before = new Set(n.techs ?? []);
    const next = new Set(mainTechs);
    for (const t of others.keys()) {
      // Kept once taken up; taken up now and then while goods are at hand.
      if (before.has(t)) next.add(t);
      else if (roll && w.rand.next() < BORROW_CHANCE && this.nationHas(n, TECH_BY_ID.get(t)?.resource)) next.add(t);
    }
    const list = TECHS.map((t) => t.id).filter((id) => next.has(id));
    if (list.length !== before.size || list.some((t) => !before.has(t))) {
      n.techs = list;
      w.nations.changed = true;
      this.changed = true;
    }
  }

  private nationHas(n: Nation, res: TechDef['resource']): boolean {
    if (!res) return true;
    return this.w.nations.settlementsOf(n).some((s) => this.w.towns.economy.stockOf(s)[res.good] >= res.n);
  }

  // ---------------------------------------------------------------- the player

  /** The player sets what a culture researches next (Caleb), or which technologies it knows (SPEC 1). */
  edit(c: Culture, research: string | undefined, techs: string[] | undefined) {
    if (techs) {
      // Keep the tree whole: a technology stays only with everything it needs.
      const want = new Set(techs.filter((t) => TECH_BY_ID.has(t)));
      const known = new Set<string>();
      for (const t of TECHS) if (want.has(t.id) && t.needs.every((x) => known.has(x))) known.add(t.id);
      c.techs = TECHS.map((t) => t.id).filter((id) => known.has(id));
      if (c.research && known.has(c.research)) delete c.research;
    }
    if (research !== undefined && this.available(c).includes(research)) c.research = research;
    // Nations whose main culture this is follow at once.
    for (const n of this.w.nations.alive()) if (this.w.nations.mainCulture(n) === c) this.derive(n, false);
    this.cache.clear();
    this.changed = true;
    this.w.towns.settlementsChanged = true;
  }

  // ---------------------------------------------------------------- views

  researchView(c: Culture): { research?: { tech: string; progress: number; cost: number; waiting?: string }; researchRate: number; awaiting: { tech: string; needs: string }[] } {
    const members = this.w.cultures.members.get(c.id) ?? 0;
    const rate = this.w.toggles.research && members > 0 ? Math.round((BASE_RESEARCH + RESEARCH_PER_PERSON * members) * this.speed(c) + (this.studiedLastYear.get(c.id) ?? 0)) : 0;
    const goodName = (r: NonNullable<TechDef['resource']>) => `${r.n} ${r.good === 'iron' ? 'iron ore' : r.good === 'gold' ? 'gold ore' : r.good}`;
    const awaiting = this.waitingFor(c).map((id) => ({ tech: id, needs: goodName(TECH_BY_ID.get(id)!.resource!) }));
    if (!c.research) return { researchRate: rate, awaiting };
    const t = TECH_BY_ID.get(c.research)!;
    const progress = Math.floor(c.progress?.[c.research] ?? 0);
    const waiting = progress >= t.cost && t.resource ? goodName(t.resource) : undefined;
    return { research: { tech: t.id, progress, cost: t.cost, waiting }, researchRate: rate, awaiting };
  }
}
