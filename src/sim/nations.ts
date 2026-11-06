import { BUILDINGS, BuildingKind } from './buildings';
import { TRAIT_AXES } from './cultures';
import { POLICY_TECH } from './tech';
import {
  ADULT_AGE,
  TICKS_PER_YEAR,
  type Culture,
  type CultureTraits,
  type Nation,
  type NationEdit,
  type NationView,
  type Person,
  type War,
  type Policies,
  type PolicyKey,
  type Relation,
  type RelationKind,
  type Settlement,
  type UniqueWhy,
} from './types';
import type { World } from './world';

// Nations (Stage 4b; SPEC 6, 7 and 10).
//
// A nation is the political layer over settlements. Some are placed by the player; others
// form when a person of high enough influence in a settlement outside any nation claims
// rule (Caleb's answer for Stage 4): they become its ruler and their settlement its capital.
// Settlements its own settlers found belong to it, and an independent settlement near it
// joins it only if most of its people hold its main culture (Caleb). When the ruler dies or
// leaves, someone succeeds them by the nation's succession policy (SPEC 10: succession always
// happens). Rulers, and people who become central to a major event or reach high influence,
// are unique: they get a name (SPEC 6).
//
// A nation's policies (SPEC 7) start out as its main culture's traits would have them. Each
// culture holds a support value for each policy choice, higher when the choice fits its
// traits and rising the longer the choice is in force; during a major event (a change of
// ruler, a settlement breaking away, a nation forming or falling) a policy its main culture
// supports less than the other choice may change, rarely when support is high. People whose
// culture does not support their nation's policies grow restless; after a while a group of
// them may break from their culture, or revolt: a small revolt sends families away to found
// a settlement of no nation, a large one (most of a settlement) makes the settlement break
// away, possibly as a new nation (Caleb). Officials collect taxes for the nation (Caleb; their
// work is in economy.ts). Nations stand with each other in peace, trade, alliance or rivalry,
// changing by themselves over time (SPEC 7: diplomacy), and expansionist ones send settlers
// out to take land (Caleb: a nation wanting to expand).

/** Nation colors on the nation map view: deep heraldic colors, the most distinct first. */
export const NATION_COLORS = [
  '#b03a2e',
  '#1f4e9c',
  '#c9a227',
  '#6c3483',
  '#117a65',
  '#ca6f1e',
  '#922b5f',
  '#34495e',
  '#7b4a2a',
  '#2874a6',
  '#7d6608',
  '#943126',
  '#0e6655',
  '#4a235a',
  '#af601a',
  '#2e7d32',
];

/** Each policy, its two choices, and which culture trait favors each (SPEC 7: support is higher when a policy matches the culture's traits). */
export const POLICY_DEFS: { key: PolicyKey; label: string; choices: [string, string]; names: [string, string]; axis: keyof CultureTraits; fits: [string, string]; note: string }[] = [
  { key: 'succession', label: 'Succession', choices: ['hereditary', 'elective'], names: ['Hereditary', 'Elective'], axis: 'order', fits: ['hierarchical', 'communal'], note: 'Who rules next: the ruler’s eldest child, or the most influential person in the nation.' },
  { key: 'taxation', label: 'Taxation', choices: ['light', 'heavy'], names: ['Light', 'Heavy'], axis: 'order', fits: ['communal', 'hierarchical'], note: 'Officials take a tenth of each settlement’s treasury a year, or a quarter.' },
  { key: 'trade', label: 'Trade', choices: ['open', 'closed'], names: ['Open', 'Closed'], axis: 'livelihood', fits: ['mercantile', 'agrarian'], note: 'Closed: its traders deal only within the nation and with allies.' },
  { key: 'expansion', label: 'Expansion', choices: ['expansionist', 'settled'], names: ['Expansionist', 'Settled'], axis: 'outlook', fits: ['progressive', 'traditional'], note: 'Expansionist nations send settlers out to take land.' },
  { key: 'conscription', label: 'Conscription', choices: ['levy', 'volunteers'], names: ['Levy', 'Volunteers'], axis: 'temper', fits: ['martial', 'peaceful'], note: 'Levy: the barracks fill first, soldiers are paid little and fight a little worse. Volunteers: paid more, they enlist only while the treasury can pay.' },
];

export const RELATION_NAME: Record<RelationKind, string> = { alliance: 'Alliance', trade: 'Trade', peace: 'Peace', rivalry: 'Rivalry', war: 'War' };

/** Influence a person needs to claim rule, and to become unique by themselves. */
const CLAIM_INFLUENCE = 24;
const UNIQUE_INFLUENCE = 40;
/** Chance each year that the most influential person in a settlement outside any nation claims rule, once they have enough influence. */
const CLAIM_CHANCE = 0.3;
/** An independent settlement this near (tiles) a nation's settlement, most of whose people hold its main culture, joins it with this chance each year. */
const JOIN_TILES = 40;
const JOIN_CHANCE = 0.3;
/** Support (0 to 100) a culture starts with for a policy choice that fits its traits, and one that does not; how much it rises a year while in force, and drifts back when not. */
const SUPPORT_FIT = 70;
const SUPPORT_MISFIT = 25;
const SUPPORT_RISE = 3;
const SUPPORT_DRIFT = 2;
/** People are unhappy when their culture's support for their nation's policies averages below this. */
const UNHAPPY = 45;
/** Months of unrest before a break or a revolt, and the chance each month after that. */
const UNREST_MONTHS = 12;
const UNREST_CHANCE = 1 / 8;
/** Chance a year that an expansionist nation sends settlers out. */
const EXPAND_CHANCE = 0.3;
/** Nations whose settlements come this near (tiles) are in contact and have relations. */
const CONTACT_TILES = 120;

const REALM: Record<Policies['succession'], string> = { hereditary: 'Kingdom', elective: 'Commonwealth' };

const MALE_NAMES = ['Aldric', 'Bertram', 'Cedric', 'Edmund', 'Godwin', 'Hugh', 'Osric', 'Ralf', 'Walter', 'Wulfric', 'Alaric', 'Baldwin', 'Conrad', 'Duncan', 'Geoffrey', 'Harold', 'Leofric', 'Odo', 'Roger', 'Simon', 'Thurstan', 'Wystan', 'Anselm', 'Gilbert'];
const FEMALE_NAMES = ['Aelfwyn', 'Beatrice', 'Cecily', 'Edith', 'Emma', 'Godiva', 'Hilda', 'Isolde', 'Juliana', 'Matilda', 'Rohesia', 'Sybil', 'Agnes', 'Alice', 'Eleanor', 'Joan', 'Margery', 'Maud', 'Petronilla', 'Rosamund', 'Agatha', 'Avelina', 'Elfleda', 'Gunilda'];

export class Nations {
  private w: World;
  list: Nation[];
  relations: Relation[];
  byId = new Map<number, Nation>();
  /** People who rule a nation now (drawn with a crown). */
  rulers = new Set<number>();
  changed = true;

  constructor(w: World) {
    this.w = w;
    const st = w.state;
    st.nations ??= [];
    st.nextNationId ??= 1;
    st.relations ??= [];
    this.list = st.nations;
    this.relations = st.relations;
    for (const n of this.list) {
      this.byId.set(n.id, n);
      if (n.ruler !== undefined && n.destroyed === undefined) this.rulers.add(n.ruler);
    }
  }

  private get towns() {
    return this.w.towns;
  }

  // ---------------------------------------------------------------- reading

  alive(): Nation[] {
    return this.list.filter((n) => n.destroyed === undefined);
  }

  settlementsOf(n: Nation): Settlement[] {
    return this.towns.settlements.filter((s) => s.nation === n.id && !s.abandoned);
  }

  nationOfPerson(p: Person): Nation | undefined {
    const s = p.settlement !== undefined ? this.towns.byId(p.settlement) : undefined;
    return s?.nation !== undefined ? this.byId.get(s.nation) : undefined;
  }

  /** The culture most of a nation's people hold. */
  mainCulture(n: Nation): Culture | undefined {
    const tally = this.cultureTally(n);
    let best: number | undefined;
    let bestN = 0;
    for (const [c, k] of tally) {
      if (k > bestN) {
        bestN = k;
        best = c;
      }
    }
    return best !== undefined ? this.w.cultures.byId.get(best) : undefined;
  }

  /** How many of a nation's people hold each culture (counted for every nation in one pass, kept for the step). */
  private cultureTally(n: Nation): Map<number, number> {
    const tick = this.w.state.tick;
    if (!this.tallies || this.tallies.tick !== tick) {
      const all = new Map<number, Map<number, number>>();
      for (const p of this.w.state.people) {
        if (p.settlement === undefined || p.culture === undefined) continue;
        const nid = this.towns.byId(p.settlement)?.nation;
        if (nid === undefined) continue;
        let t = all.get(nid);
        if (!t) all.set(nid, (t = new Map()));
        t.set(p.culture, (t.get(p.culture) ?? 0) + 1);
      }
      this.tallies = { tick, all };
    }
    return this.tallies.all.get(n.id) ?? new Map();
  }

  private tallies?: { tick: number; all: Map<number, Map<number, number>> };

  /** A person's influence (SPEC 6, a [Claude's call] item: from office held, wealth, and family and pair ties). */
  influence(p: Person): number {
    if (this.w.ageOf(p) < ADULT_AGE) return 0;
    const own = this.ownInfluence(p);
    const pair = p.pair !== undefined ? this.w.byId.get(p.pair) : undefined;
    let ties = pair ? this.ownInfluence(pair) * 0.3 : 0;
    for (const id of [p.mother, p.father]) if (id !== undefined && this.rulers.has(id)) ties += 25;
    for (const r of this.rulers) {
      const q = this.w.byId.get(r);
      if (q && (q.mother === p.id || q.father === p.id)) ties += 15;
    }
    return Math.round(own + ties);
  }

  private ownInfluence(p: Person): number {
    const office = this.rulers.has(p.id) ? 50 : this.w.towns.economy.jobOf(p) === 'official' ? 10 : 0;
    const wealth = Math.min(50, this.w.towns.economy.wealthOf(p) * 0.5);
    return office + wealth;
  }

  /** The title of a nation's ruler. */
  title(n: Nation, p: Person) {
    return n.policies.succession === 'hereditary' ? (p.sex === 1 ? 'King' : 'Queen') : p.sex === 1 ? 'Lord Protector' : 'Lady Protector';
  }

  relation(a: number, b: number): RelationKind {
    if (a === b) return 'alliance';
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return this.relations.find((r) => r.a === lo && r.b === hi)?.kind ?? 'peace';
  }

  private setRelation(a: number, b: number, kind: RelationKind) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const r = this.relations.find((x) => x.a === lo && x.b === hi);
    if (r) {
      if (r.kind === kind) return;
      r.kind = kind;
      r.since = this.w.state.tick;
      if (kind !== 'war') delete r.war;
    } else if (kind !== 'peace') this.relations.push({ a: lo, b: hi, kind, since: this.w.state.tick });
    this.changed = true;
  }

  /** Two nations go to war (Stage 5; see Military.declare). */
  setWar(a: number, b: number, war: War) {
    this.setRelation(a, b, 'war');
    const r = this.relations.find((x) => x.a === Math.min(a, b) && x.b === Math.max(a, b));
    if (r) r.war = war;
  }

  /** A war ends: the two stand as rivals, or at peace if the war went on long (Caleb: peace when worn out). */
  endWar(a: number, b: number) {
    const r = this.relations.find((x) => x.a === Math.min(a, b) && x.b === Math.max(a, b));
    if (!r || r.kind !== 'war') return;
    const years = (this.w.state.tick - (r.war?.start ?? r.since)) / TICKS_PER_YEAR;
    this.setRelation(a, b, years >= 5 ? 'peace' : 'rivalry');
  }

  /** Whether traders of two settlements may deal with each other (relations and trade policies). */
  canTrade(a: Settlement, b: Settlement): boolean {
    const na = a.nation !== undefined ? this.byId.get(a.nation) : undefined;
    const nb = b.nation !== undefined ? this.byId.get(b.nation) : undefined;
    if (na && nb && na === nb) return true;
    const rel = na && nb ? this.relation(na.id, nb.id) : 'peace';
    if (rel === 'rivalry' || rel === 'war') return false;
    const closed = na?.policies.trade === 'closed' || nb?.policies.trade === 'closed';
    if (closed) return rel === 'alliance';
    return true;
  }

  /** What share of a settlement's treasury its nation's officials take a year. */
  taxRate(s: Settlement): number {
    const n = s.nation !== undefined ? this.byId.get(s.nation) : undefined;
    return !n ? 0 : n.policies.taxation === 'heavy' ? 0.25 : 0.1;
  }

  // ---------------------------------------------------------------- the monthly round

  monthly() {
    const w = this.w;
    const tick = w.state.tick;
    const month = Math.floor(tick / (TICKS_PER_YEAR / 12)) % 12;
    this.tidy();
    for (const n of this.alive()) {
      this.checkRuler(n);
      // A nation formed before its people had a culture takes up its first main culture's ways.
      if (n.unshaped) {
        const c = this.mainCulture(n);
        if (c) {
          n.policies = this.policiesFor(c, new Set(n.techs ?? c.techs ?? []));
          delete n.unshaped;
          this.fitName(n);
          this.markChanged();
        }
      }
    }
    const bySettlement = new Map<number, Person[]>();
    for (const p of w.state.people) {
      if (p.settlement === undefined) continue;
      const l = bySettlement.get(p.settlement);
      if (l) l.push(p);
      else bySettlement.set(p.settlement, [p]);
    }
    // Leaders claim rule over settlements outside any nation (Caleb).
    if (w.toggles.nations) {
      for (const s of this.towns.settlements) {
        if (s.abandoned || s.nation !== undefined || s.stage === 'camp') continue;
        const leader = this.mostInfluential(bySettlement.get(s.id) ?? []);
        if (leader && leader.inf >= CLAIM_INFLUENCE && w.rand.next() < monthlyChance(CLAIM_CHANCE)) this.found(s, leader.p);
      }
    }
    // Independent settlements near a nation join it if most of their people hold its main culture (Caleb).
    const mains = new Map<number, number | undefined>(this.alive().map((n) => [n.id, this.mainCulture(n)?.id]));
    for (const s of this.towns.settlements) {
      if (s.abandoned || s.nation !== undefined) continue;
      const people = bySettlement.get(s.id) ?? [];
      if (!people.length) continue;
      for (const n of this.alive()) {
        const main = mains.get(n.id);
        if (main === undefined) continue;
        const holders = people.filter((p) => p.culture === main).length;
        if (holders * 2 <= people.length) continue;
        const near = this.settlementsOf(n).some((o) => this.towns.dist2(o.center, s.center) <= JOIN_TILES * JOIN_TILES);
        if (near && w.rand.next() < monthlyChance(JOIN_CHANCE)) {
          s.nation = n.id;
          this.markChanged();
          break;
        }
      }
    }
    // People of high influence become unique by themselves (SPEC 6).
    if (w.toggles.uniques) {
      for (const p of w.state.people) if (!p.unique && p.settlement !== undefined && this.influence(p) >= UNIQUE_INFLUENCE) this.makeUnique(p, 'influence');
    }
    if (month === 0) this.yearly();
    this.unrest(bySettlement);
  }

  /** Once a year: culture support moves, relations change, expansionist nations send settlers. */
  private yearly() {
    const w = this.w;
    // Support for each policy choice rises while it is in force where the culture lives, and drifts back otherwise.
    const inForce = new Map<number, Set<string>>();
    for (const n of this.alive()) {
      for (const [c] of this.cultureTally(n)) {
        const set = inForce.get(c) ?? new Set<string>();
        for (const d of POLICY_DEFS) set.add(`${d.key}:${n.policies[d.key]}`);
        inForce.set(c, set);
      }
    }
    for (const c of w.cultures.list) {
      if (c.extinct !== undefined) continue;
      const sup = this.supportOf(c);
      const here = inForce.get(c.id);
      for (const d of POLICY_DEFS) {
        for (const choice of d.choices) {
          const key = `${d.key}:${choice}`;
          const base = baseSupport(c, d.key, choice);
          if (here?.has(key)) sup[key] = Math.min(100, sup[key] + SUPPORT_RISE);
          else sup[key] = sup[key] > base ? Math.max(base, sup[key] - SUPPORT_DRIFT) : Math.min(base, sup[key] + SUPPORT_DRIFT);
        }
      }
    }
    // Relations change by themselves (SPEC 7; SPEC 10: diplomatic relation changes).
    if (w.toggles.diplomacy) {
      const alive = this.alive();
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          const gap = this.nearest(a, b);
          if (gap > CONTACT_TILES) continue;
          const want = this.wantedRelation(a, b, gap);
          // War is made and ended by the military (Stage 5), not by drifting opinion.
          const now = this.relation(a.id, b.id);
          if (now !== 'war' && want !== now && w.rand.next() < 0.5) this.setRelation(a.id, b.id, want);
        }
      }
    }
    // Expansionist nations send settlers to take land (Caleb: a nation wanting to expand).
    if (w.toggles.founding) {
      for (const n of this.alive()) {
        if (n.policies.expansion !== 'expansionist' || w.rand.next() > EXPAND_CHANCE) continue;
        // Only from a settlement big enough and still growing (Caleb: towns grow first).
        const from = this.settlementsOf(n)
          .filter((s) => this.towns.mayStrikeOut(s))
          .sort((x, y) => this.towns.peopleOf(y) - this.towns.peopleOf(x))[0];
        if (from) this.towns.sendOut(from, 'young');
      }
    }
  }

  /**
   * How two nations in contact would stand: a shared culture and shared ways draw them
   * together, and so does open trade on both sides; close neighbours of different cultures
   * rub against each other, two martial ones more so, and two expansionist neighbours fall out.
   */
  private wantedRelation(a: Nation, b: Nation, gap: number): RelationKind {
    const ca = this.mainCulture(a);
    const cb = this.mainCulture(b);
    let opinion = 0;
    const same = !!ca && !!cb && ca.id === cb.id;
    if (ca && cb) {
      if (same) opinion += 40;
      else if (ca.parent === cb.id || cb.parent === ca.id) opinion += 20;
      for (const ax of TRAIT_AXES) if (ca.traits[ax.key] === cb.traits[ax.key]) opinion += 8;
      if (!same && ca.traits.temper === 'martial' && cb.traits.temper === 'martial') opinion -= 10;
    }
    if (a.policies.trade === 'open' && b.policies.trade === 'open') opinion += 20;
    if (!same && gap < 40) opinion -= 15;
    if (a.policies.expansion === 'expansionist' && b.policies.expansion === 'expansionist' && gap < 70) opinion -= 35;
    // What they are now carries over a little.
    const now = this.relation(a.id, b.id);
    opinion += now === 'alliance' ? 10 : now === 'trade' ? 5 : now === 'rivalry' ? -10 : 0;
    return opinion >= 60 ? 'alliance' : opinion >= 30 ? 'trade' : opinion <= -15 ? 'rivalry' : 'peace';
  }

  /** Distance (tiles) between the nearest settlements of two nations. */
  private nearest(a: Nation, b: Nation): number {
    let best = Infinity;
    const sb = this.settlementsOf(b);
    for (const x of this.settlementsOf(a)) for (const y of sb) best = Math.min(best, this.towns.dist2(x.center, y.center));
    return Math.sqrt(best);
  }

  /** People unhappy with their nation's policies: in time they break from their culture or revolt (Caleb). */
  private unrest(bySettlement: Map<number, Person[]>) {
    const w = this.w;
    for (const s of this.towns.settlements) {
      if (s.abandoned || s.nation === undefined) {
        if (s.unrest) {
          delete s.unrest;
          this.markChanged();
        }
        continue;
      }
      const n = this.byId.get(s.nation);
      const people = bySettlement.get(s.id) ?? [];
      if (!n || !people.length) continue;
      // The unhappiest culture group of a fair size here.
      const groups = new Map<number, Person[]>();
      for (const p of people) {
        if (p.culture === undefined) continue;
        const g = groups.get(p.culture);
        if (g) g.push(p);
        else groups.set(p.culture, [p]);
      }
      let worst: { c: Culture; members: Person[]; avg: number } | null = null;
      for (const [cid, members] of groups) {
        if (members.length < 4) continue;
        const c = w.cultures.byId.get(cid);
        if (!c) continue;
        const avg = this.avgSupport(c, n.policies);
        if (avg < UNHAPPY && (!worst || avg < worst.avg)) worst = { c, members, avg };
      }
      const before = s.unrest ?? 0;
      s.unrest = worst ? Math.min(UNREST_MONTHS * 3, before + 1) : Math.max(0, before - 2);
      if ((before >= UNREST_MONTHS) !== (s.unrest >= UNREST_MONTHS)) this.markChanged();
      if (!worst || s.unrest < UNREST_MONTHS || w.rand.next() > UNREST_CHANCE) continue;
      // A break from the culture (they take up the nation's ways), or a revolt.
      const breakChance = worst.c.traits.outlook === 'progressive' ? 0.5 : 0.25;
      if (w.toggles.cultures && w.rand.next() < breakChance) {
        this.breakOverPolicy(s, worst.c, worst.members, n);
      } else {
        const most = worst.members.length * 2 > people.length;
        if (most && s.id !== n.capital) this.secede(s, n, worst.members);
        else this.smallRevolt(s, n, worst.members);
      }
      s.unrest = 0;
      this.markChanged();
    }
  }

  private avgSupport(c: Culture, policies: Policies): number {
    const sup = this.supportOf(c);
    let sum = 0;
    for (const d of POLICY_DEFS) sum += sup[`${d.key}:${policies[d.key]}`];
    return sum / POLICY_DEFS.length;
  }

  /** A culture's support values, filled in from its traits where missing. */
  supportOf(c: Culture): Record<string, number> {
    c.support ??= {};
    for (const d of POLICY_DEFS) for (const choice of d.choices) c.support[`${d.key}:${choice}`] ??= baseSupport(c, d.key, choice);
    return c.support;
  }

  /** The group breaks from its culture and founds one that takes up the policy it liked least (Caleb: a break over policies). */
  private breakOverPolicy(s: Settlement, c: Culture, members: Person[], n: Nation) {
    const sup = this.supportOf(c);
    let worstDef = POLICY_DEFS[0];
    for (const d of POLICY_DEFS) if (sup[`${d.key}:${n.policies[d.key]}`] < sup[`${worstDef.key}:${n.policies[worstDef.key]}`]) worstDef = d;
    const fit = worstDef.fits[worstDef.choices.indexOf(n.policies[worstDef.key])];
    this.w.cultures.splitOff(s, c, members, { [worstDef.axis]: fit } as Partial<CultureTraits>);
  }

  /** A large revolt: the settlement breaks from the nation, and may become a nation of its own (Caleb). */
  private secede(s: Settlement, n: Nation, members: Person[]) {
    const w = this.w;
    delete s.nation;
    const leader = this.mostInfluential(members);
    if (leader) this.makeUnique(leader.p, 'revolt');
    if (this.rulers.has(leader?.p.id ?? -1)) this.checkRuler(n);
    if (w.toggles.nations && leader && leader.inf >= CLAIM_INFLUENCE / 2) this.found(s, leader.p);
    this.majorEvent([n]);
    this.markChanged();
  }

  /** A small revolt: unhappy families leave to found a settlement of no nation (Caleb). */
  private smallRevolt(s: Settlement, n: Nation, members: Person[]) {
    const leader = this.mostInfluential(members);
    if (this.towns.sendOut(s, 'quarter', new Set(members), true) && leader) this.makeUnique(leader.p, 'revolt');
    void n;
  }

  private mostInfluential(people: Person[]): { p: Person; inf: number } | null {
    let best: { p: Person; inf: number } | null = null;
    for (const p of people) {
      if (this.w.ageOf(p) < ADULT_AGE) continue;
      const inf = this.influence(p);
      if (!best || inf > best.inf) best = { p, inf };
    }
    return best;
  }

  // ---------------------------------------------------------------- forming, rulers, falling

  /** A nation forms with a settlement as its capital and (if given) a ruler. */
  found(s: Settlement, ruler: Person | undefined): Nation {
    const w = this.w;
    const people = w.state.people.filter((p) => p.settlement === s.id);
    const culture = this.cultureOfGroup(people);
    const techs = new Set(culture?.techs ?? []);
    const policies = this.policiesFor(culture, techs);
    const used = new Set(this.alive().map((n) => n.color));
    const free = NATION_COLORS.map((_, i) => i).filter((i) => !used.has(i));
    const n: Nation = {
      id: w.state.nextNationId!++,
      name: `${REALM[policies.succession]} of ${s.name}`,
      color: free.length ? free[0] : w.rand.int(NATION_COLORS.length),
      founded: w.state.tick,
      capital: s.id,
      policies,
      coins: 0,
      techs: [...techs],
    };
    if (!culture) n.unshaped = true;
    this.list.push(n);
    this.byId.set(n.id, n);
    s.nation = n.id;
    delete s.unrest;
    if (ruler) this.crown(n, ruler);
    else this.checkRuler(n);
    this.markChanged();
    return n;
  }

  /** Policies as a culture's traits would have them (random where there is no culture), among the choices its technology allows. */
  private policiesFor(culture: Culture | undefined, techs: Set<string>): Policies {
    return Object.fromEntries(
      POLICY_DEFS.map((d) => {
        const t = culture?.traits[d.axis];
        const fit = t !== undefined ? d.fits.indexOf(t) : -1;
        let choice = d.choices[fit >= 0 ? fit : this.w.rand.int(2)];
        if (!allowed(d.key, choice, techs)) choice = d.choices[1 - d.choices.indexOf(choice)];
        return [d.key, choice];
      }),
    ) as unknown as Policies;
  }

  /** Whether a nation's technology allows a policy choice (SPEC 7). */
  allows(n: Nation, key: PolicyKey, choice: string) {
    return allowed(key, choice, new Set(n.techs ?? []));
  }

  /** The realm word in a nation's name follows its succession (unless the player renamed it). */
  private fitName(n: Nation) {
    const m = /^(Kingdom|Commonwealth) of (.+)$/.exec(n.name);
    if (m) n.name = `${REALM[n.policies.succession]} of ${m[2]}`;
  }

  private cultureOfGroup(people: Person[]): Culture | undefined {
    const tally = new Map<number, number>();
    for (const p of people) if (p.culture !== undefined) tally.set(p.culture, (tally.get(p.culture) ?? 0) + 1);
    let best: number | undefined;
    let bestN = 0;
    for (const [c, k] of tally) {
      if (k > bestN) {
        bestN = k;
        best = c;
      }
    }
    return best !== undefined ? this.w.cultures.byId.get(best) : undefined;
  }

  private crown(n: Nation, p: Person) {
    if (n.ruler !== undefined) this.rulers.delete(n.ruler);
    n.ruler = p.id;
    this.rulers.add(p.id);
    this.makeUnique(p, 'ruler');
    this.markChanged();
  }

  /** Succession when a ruler has died or left (SPEC 10: always happens). */
  private checkRuler(n: Nation) {
    this.seatRuler(n);
    const w = this.w;
    const ruler = n.ruler !== undefined ? w.byId.get(n.ruler) : undefined;
    if (ruler && this.nationOfPerson(ruler) === n) return;
    const had = n.ruler !== undefined;
    if (n.ruler !== undefined) this.rulers.delete(n.ruler);
    delete n.ruler;
    this.successor(n, ruler, had);
  }

  /** Picks the next ruler by the nation's succession policy (`ruler`: the one who has gone, if known). */
  private successor(n: Nation, ruler: Person | undefined, had = true) {
    const w = this.w;
    const mine = new Set(this.settlementsOf(n).map((s) => s.id));
    const inNation = (p: Person | undefined): p is Person => !!p && w.byId.has(p.id) && p.settlement !== undefined && mine.has(p.settlement) && w.ageOf(p) >= ADULT_AGE;
    let next: Person | undefined;
    if (n.policies.succession === 'hereditary' && ruler) {
      // The eldest grown child, then the pair, then the most influential in the capital.
      const children = w.state.people.filter((q) => (q.mother === ruler.id || q.father === ruler.id) && inNation(q)).sort((a, b) => a.born - b.born);
      next = children[0] ?? (ruler.pair !== undefined ? w.byId.get(ruler.pair) : undefined);
      if (!inNation(next)) next = this.mostInfluential(w.state.people.filter((q) => q.settlement === n.capital))?.p;
    }
    if (!inNation(next)) next = this.mostInfluential(w.state.people.filter((q) => inNation(q)))?.p;
    if (next) this.crown(n, next);
    if (had) this.majorEvent([n]);
    this.markChanged();
  }

  /** Keeps nations in order: settlements that are gone leave, capitals move, nations with nothing left fall. */
  private tidy() {
    for (const s of this.towns.settlements) {
      if (s.nation === undefined) continue;
      const n = this.byId.get(s.nation);
      if (!n || n.destroyed !== undefined || s.abandoned) {
        delete s.nation;
        this.markChanged();
      }
    }
    for (const n of this.alive()) {
      const mine = this.settlementsOf(n);
      if (!mine.length) {
        this.fall(n);
        continue;
      }
      if (!mine.some((s) => s.id === n.capital)) {
        n.capital = mine.sort((a, b) => this.towns.peopleOf(b) - this.towns.peopleOf(a))[0].id;
        this.markChanged();
      }
    }
  }

  /** A nation with no settlements left is destroyed (SPEC 7: a major event). */
  private fall(n: Nation) {
    n.destroyed = this.w.state.tick;
    if (n.ruler !== undefined) this.rulers.delete(n.ruler);
    delete n.ruler;
    const others = this.relations.filter((r) => r.a === n.id || r.b === n.id).map((r) => this.byId.get(r.a === n.id ? r.b : r.a)!);
    this.relations.splice(0, this.relations.length, ...this.relations.filter((r) => r.a !== n.id && r.b !== n.id));
    this.majorEvent(others.filter((o) => o && o.destroyed === undefined));
    this.markChanged();
  }

  /** Wars beginning and ending are major events too (SPEC 7). */
  majorEvents(nations: Nation[]) {
    this.majorEvent(nations);
  }

  /** During a major event a nation's policies may change toward what its main culture supports (SPEC 7). */
  private majorEvent(nations: Nation[]) {
    const w = this.w;
    if (!w.toggles.policyChanges) return;
    for (const n of nations) {
      const c = this.mainCulture(n);
      if (!c) continue;
      const sup = this.supportOf(c);
      for (const d of POLICY_DEFS) {
        const now = n.policies[d.key];
        const other = d.choices[1 - d.choices.indexOf(now)];
        const sNow = sup[`${d.key}:${now}`];
        const sOther = sup[`${d.key}:${other}`];
        // The better its current policy is supported, the less likely it changes (SPEC 7, [Claude's call]).
        if (sOther > sNow && this.allows(n, d.key, other) && w.rand.next() < 0.6 * (1 - sNow / 100)) {
          (n.policies as unknown as Record<string, string>)[d.key] = other;
          if (d.key === 'succession') this.fitName(n);
          this.markChanged();
        }
      }
    }
  }

  /** Someone has died or been removed: a ruler is succeeded at once (SPEC 10). */
  onGone(p: Person) {
    if (!this.rulers.has(p.id)) return;
    const n = this.alive().find((x) => x.ruler === p.id);
    this.rulers.delete(p.id);
    if (n) {
      delete n.ruler;
      this.successor(n, p);
    }
  }

  /** Someone becomes unique: they get a name (SPEC 6). */
  makeUnique(p: Person, why: UniqueWhy) {
    if (p.unique) return;
    const list = p.sex === 1 ? MALE_NAMES : FEMALE_NAMES;
    const s = p.settlement !== undefined ? this.towns.byId(p.settlement) : undefined;
    const name = list[this.w.rand.int(list.length)] + (s ? ` of ${s.name}` : '');
    p.unique = { name, since: this.w.state.tick, why };
    this.markChanged();
  }

  private markChanged() {
    this.changed = true;
    this.towns.settlementsChanged = true;
  }

  // ---------------------------------------------------------------- the player

  /** The player places a nation (SPEC 7): a settlement outside any nation becomes its capital, its most influential adult its ruler. */
  place(settlementId: number): boolean {
    const s = this.towns.byId(settlementId);
    if (!s || s.abandoned || s.nation !== undefined) return false;
    const leader = this.mostInfluential(this.w.state.people.filter((p) => p.settlement === s.id));
    this.found(s, leader?.p);
    return true;
  }

  edit(id: number, e: NationEdit) {
    const n = this.byId.get(id);
    if (!n || n.destroyed !== undefined) return;
    if (e.name !== undefined && e.name.trim()) n.name = e.name.trim().slice(0, 50);
    if (e.color !== undefined && e.color >= 0 && e.color < NATION_COLORS.length) n.color = e.color;
    if (e.policies) {
      for (const d of POLICY_DEFS) {
        const v = e.policies[d.key];
        if (v !== undefined && d.choices.includes(v) && this.allows(n, d.key, v)) (n.policies as unknown as Record<string, string>)[d.key] = v;
      }
      delete n.unshaped;
      if (e.policies.succession) this.fitName(n);
    }
    if (e.capital !== undefined) {
      const s = this.towns.byId(e.capital);
      if (s && s.nation === n.id) n.capital = s.id;
    }
    if (e.ruler !== undefined) {
      const p = this.w.byId.get(e.ruler);
      if (p && this.nationOfPerson(p) === n) this.crown(n, p);
    }
    if (e.relation) {
      const o = this.byId.get(e.relation.other);
      if (o && o !== n && o.destroyed === undefined) {
        // The player declares war or makes peace (Stage 5).
        const now = this.relation(n.id, o.id);
        if (e.relation.kind === 'war') this.w.military.declare(n, o);
        else {
          if (now === 'war') this.w.military.makePeace(n.id, o.id);
          this.setRelation(n.id, o.id, e.relation.kind);
        }
      }
    }
    this.towns.buildingsChanged = true; // halls fly the nation's color
    this.markChanged();
  }

  /** The player's order: settlers from the nation's settlement nearest the spot found a settlement there for the nation. */
  orderExpand(id: number, tile: number) {
    const n = this.byId.get(id);
    if (!n || n.destroyed !== undefined) return;
    const from = this.settlementsOf(n).sort((a, b) => this.towns.dist2(a.center, tile) - this.towns.dist2(b.center, tile))[0];
    if (from) this.towns.order(from.id, { kind: 'settlers', tile });
  }

  // ---------------------------------------------------------------- views

  views(): NationView[] {
    const w = this.w;
    // One pass over everyone: people and officials by nation, soldiers by nation and army.
    const soldiers = new Map<number, number>();
    const inArmy = new Map<number, number>();
    const peopleOf = new Map<number, number>();
    const officialsOf = new Map<number, number>();
    for (const p of w.state.people) {
      if (p.soldier) {
        const id = w.military.nationOf(p);
        if (id !== undefined) soldiers.set(id, (soldiers.get(id) ?? 0) + 1);
        if (p.army !== undefined) inArmy.set(p.army, (inArmy.get(p.army) ?? 0) + 1);
      }
      const nid = p.settlement !== undefined ? this.towns.byId(p.settlement)?.nation : undefined;
      if (nid === undefined) continue;
      peopleOf.set(nid, (peopleOf.get(nid) ?? 0) + 1);
      if (w.towns.economy.jobOf(p) === 'official') officialsOf.set(nid, (officialsOf.get(nid) ?? 0) + 1);
    }
    return this.list.map((n) => {
      const mine = this.settlementsOf(n);
      const tally = this.cultureTally(n);
      const main = this.mainCulture(n);
      const sup = main ? this.supportOf(main) : undefined;
      const ruler = n.ruler !== undefined ? w.byId.get(n.ruler) : undefined;
      const people = peopleOf.get(n.id) ?? 0;
      const officials = officialsOf.get(n.id) ?? 0;
      return {
        id: n.id,
        name: n.name,
        color: n.color,
        foundedYear: Math.floor(n.founded / TICKS_PER_YEAR) + 1,
        capital: n.capital,
        capitalName: this.towns.settlementName(n.capital) ?? '',
        ruler: ruler ? { id: ruler.id, name: ruler.unique?.name ?? `No. ${ruler.id}`, title: this.title(n, ruler) } : undefined,
        settlements: mine.length,
        people,
        coins: Math.floor(n.coins),
        officials,
        policies: { ...n.policies },
        cultures: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([id, members]) => ({ id, members })),
        support: Object.fromEntries(POLICY_DEFS.map((d) => [d.key, sup ? Math.round(sup[`${d.key}:${n.policies[d.key]}`]) : 50])) as Record<PolicyKey, number>,
        relations: this.alive()
          .filter((o) => o !== n && n.destroyed === undefined)
          .map((o) => ({ other: o.id, kind: this.relation(n.id, o.id) })),
        unrest: mine.filter((s) => (s.unrest ?? 0) >= UNREST_MONTHS).length,
        destroyedYear: n.destroyed !== undefined ? Math.floor(n.destroyed / TICKS_PER_YEAR) + 1 : undefined,
        techs: [...(n.techs ?? [])],
        soldiers: soldiers.get(n.id) ?? 0,
        armies: w.military.armyViews(n, inArmy),
        wars: this.relations
          .filter((r) => r.kind === 'war' && (r.a === n.id || r.b === n.id))
          .map((r) => {
            const other = r.a === n.id ? r.b : r.a;
            const war = r.war;
            return {
              other,
              years: Math.floor((w.state.tick - (war?.start ?? r.since)) / TICKS_PER_YEAR),
              lost: war?.lost[n.id] ?? 0,
              enemyLost: war?.lost[other] ?? 0,
              taken: war?.taken[n.id] ?? 0,
              enemyTaken: war?.taken[other] ?? 0,
              declaredBy: war?.by ?? other,
            };
          }),
      };
    });
  }

  /** Someone's office, for the inspect panel. */
  officeOf(p: Person): string | undefined {
    if (!this.rulers.has(p.id)) return undefined;
    const n = this.alive().find((x) => x.ruler === p.id);
    return n ? `${this.title(n, p)} of ${n.name.replace(/^(Kingdom|Commonwealth) of /, '')}` : undefined;
  }

  /** Halls fly their nation's color. */
  bannerOf(settlementId: number | undefined): string | undefined {
    const s = settlementId !== undefined ? this.towns.byId(settlementId) : undefined;
    const n = s?.nation !== undefined ? this.byId.get(s.nation) : undefined;
    return n ? NATION_COLORS[n.color] : undefined;
  }

  /** Whether a settlement is a nation's capital, or a town or city of a nation (each builds a hall). */
  wantsHall(s: Settlement): boolean {
    const n = s.nation !== undefined ? this.byId.get(s.nation) : undefined;
    return !!n && (n.capital === s.id || s.stage === 'town' || s.stage === 'city');
  }

  /**
   * Whether a settlement should build the nation's castle (Caleb): the nation's biggest city,
   * when the nation has no castle yet.
   */
  wantsCastle(s: Settlement): boolean {
    const n = s.nation !== undefined ? this.byId.get(s.nation) : undefined;
    if (!n || s.stage !== 'city') return false;
    const mine = this.settlementsOf(n);
    if (this.towns.buildings.some((b) => b.kind === BuildingKind.Castle && b.settlement !== undefined && mine.some((m) => m.id === b.settlement))) return false;
    const cities = mine.filter((m) => m.stage === 'city').sort((a, b) => this.towns.peopleOf(b) - this.towns.peopleOf(a));
    return cities[0] === s;
  }

  /** The castle of a nation, finished, if it has one. */
  castleOf(n: Nation) {
    const mine = new Set(this.settlementsOf(n).map((m) => m.id));
    return this.towns.buildings.find((b) => b.kind === BuildingKind.Castle && b.progress >= 1 && b.settlement !== undefined && mine.has(b.settlement));
  }

  /**
   * The capital is where the castle stands, and the ruler and their family live in it (Caleb).
   * Looked at every month.
   */
  private seatRuler(n: Nation) {
    const castle = this.castleOf(n);
    if (!castle || castle.settlement === undefined) return;
    if (n.capital !== castle.settlement) {
      n.capital = castle.settlement;
      this.markChanged();
    }
    const ruler = n.ruler !== undefined ? this.w.byId.get(n.ruler) : undefined;
    if (!ruler) return;
    const family = [ruler, ...(ruler.pair !== undefined ? [this.w.byId.get(ruler.pair)] : []), ...this.w.state.people.filter((q) => (q.mother === ruler.id || q.father === ruler.id) && this.w.ageOf(q) < ADULT_AGE)];
    for (const p of family) {
      if (!p || (p.home === castle.id && p.settlement === castle.settlement)) continue;
      this.towns.moveInto(p, castle);
    }
  }

  /** Workers a hall can use. */
  static hallJobs = BUILDINGS[14].jobs;
}

function allowed(key: PolicyKey, choice: string, techs: Set<string>) {
  const need = POLICY_TECH[`${key}:${choice}`];
  return !need || techs.has(need);
}

function monthlyChance(yearly: number) {
  return 1 - Math.pow(1 - yearly, 1 / 12);
}

function baseSupport(c: Culture, key: PolicyKey, choice: string): number {
  const d = POLICY_DEFS.find((x) => x.key === key)!;
  const fit = d.fits[d.choices.indexOf(choice)];
  return c.traits[d.axis] === fit ? SUPPORT_FIT : SUPPORT_MISFIT;
}
