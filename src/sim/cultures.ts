import { TICKS_PER_MONTH, TICKS_PER_YEAR, type Culture, type CultureEdit, type CultureTraits, type CultureView, type Person, type Settlement } from './types';
import type { World } from './world';

// Cultures (Stage 4a; SPEC 6 and 7).
//
// Cultures only emerge from people; the player cannot make one, but can edit one afterwards.
// A settlement whose people have had no culture for a while forms one (a single person is
// enough), and everyone there joins it. People living outside any settlement take longer, and
// those near one another then form one together. People without a culture who live among a culture
// take it up; children are born into their mother's culture (or their father's). A
// settlement that has lived far from every other settlement of its culture for many years
// may break away and found a new culture (Caleb's answer for Stage 4), as may any
// settlement the player orders to; the settlement where most of a culture's people live is
// its heartland and is never far from home. People whose culture is a small minority where
// they live slowly take up the culture around them (SPEC 6: groups influence individuals). A new culture that breaks away keeps its parent's traits
// but one. A culture whose last member is gone is extinct, and kept for the record.

/** Years a settlement goes without a culture before one forms there; people outside any settlement take longer. */
const FORM_YEARS = 3;
const WANDERER_FORM_YEARS = 6;
/** People outside settlements without a culture this close (tiles) form one together. */
const WANDERER_RANGE = 20;
/** A settlement farther than this (tiles) from every other settlement of its culture is far from home. */
const FAR_TILES = 50;
/** People whose culture is held by fewer than this share of their settlement may take up its culture, with this chance each year. */
const MINORITY_SHARE = 0.25;
const ASSIMILATE_CHANCE = 0.1;
/** Years far from home before it may break away, and the chance each year after that (by outlook). */
const FAR_YEARS = 10;
const BREAK_CHANCE: Record<CultureTraits['outlook'], number> = { traditional: 0.1, progressive: 0.3 };

/** One side of each pair of traits, and what each is called. */
export const TRAIT_AXES: { key: keyof CultureTraits; label: string; poles: [string, string]; names: [string, string] }[] = [
  { key: 'temper', label: 'Temper', poles: ['martial', 'peaceful'], names: ['Martial', 'Peaceful'] },
  { key: 'livelihood', label: 'Livelihood', poles: ['mercantile', 'agrarian'], names: ['Mercantile', 'Agrarian'] },
  { key: 'outlook', label: 'Outlook', poles: ['traditional', 'progressive'], names: ['Traditional', 'Progressive'] },
  { key: 'order', label: 'Order', poles: ['hierarchical', 'communal'], names: ['Hierarchical', 'Communal'] },
];

/** Colors for the culture map view, like dyed cloth and heraldry: the most distinct first (green late, as it is hard to see on grassland). */
export const CULTURE_COLORS = [
  '#c0392b',
  '#2e6db4',
  '#d4a017',
  '#7d3c98',
  '#16a085',
  '#e67e22',
  '#c2185b',
  '#5d6d7e',
  '#8e5b3a',
  '#3f8f4f',
  '#1f618d',
  '#9a7d0a',
  '#a04000',
  '#117a65',
  '#6c3483',
  '#d35400',
];

const NAME_START = ['Ald', 'Bren', 'Cal', 'Dun', 'Eth', 'Far', 'Gal', 'Hroth', 'Ivr', 'Kel', 'Lor', 'Mer', 'Nor', 'Ost', 'Pryd', 'Rhen', 'Sal', 'Tor', 'Ulm', 'Ves', 'Wyr', 'Gwyn', 'Bael', 'Cor', 'Dra', 'Esk', 'Hal', 'Lind', 'Mor', 'Thal'];
const NAME_END = ['ic', 'ish', 'an', 'ene', 'ar', 'ian', 'ese', 'ond', 'ing', 'el'];

export class Cultures {
  private w: World;
  list: Culture[];
  byId = new Map<number, Culture>();
  /** Each settlement's culture: the one most of its people hold. */
  dominant = new Map<number, number>();
  /** People in each culture. */
  members = new Map<number, number>();
  /** Set when anything the app shows about cultures changed. */
  changed = true;

  constructor(w: World) {
    this.w = w;
    const st = w.state;
    st.cultures ??= [];
    st.nextCultureId ??= 1;
    this.list = st.cultures;
    for (const c of this.list) this.byId.set(c.id, c);
    this.recount();
  }

  private get people() {
    return this.w.state.people;
  }

  /** Counts members and works out each settlement's culture. Returns each settlement's people. */
  private recount(): Map<number, Person[]> {
    const bySettlement = new Map<number, Person[]>();
    this.members.clear();
    for (const p of this.people) {
      if (p.culture !== undefined) this.members.set(p.culture, (this.members.get(p.culture) ?? 0) + 1);
      if (p.settlement === undefined) continue;
      const list = bySettlement.get(p.settlement);
      if (list) list.push(p);
      else bySettlement.set(p.settlement, [p]);
    }
    let moved = false;
    for (const s of this.w.towns.settlements) {
      const dom = s.abandoned ? undefined : this.mostHeld(bySettlement.get(s.id) ?? [], this.dominant.get(s.id));
      if (dom !== this.dominant.get(s.id)) moved = true;
      if (dom === undefined) this.dominant.delete(s.id);
      else this.dominant.set(s.id, dom);
    }
    if (moved) {
      this.w.towns.settlementsChanged = true;
      this.changed = true;
    }
    return bySettlement;
  }

  /** The culture most of these people hold; the current one stays unless another is held by more. */
  private mostHeld(people: Person[], current?: number): number | undefined {
    const tally = new Map<number, number>();
    for (const p of people) if (p.culture !== undefined) tally.set(p.culture, (tally.get(p.culture) ?? 0) + 1);
    let best = current !== undefined && tally.has(current) ? current : undefined;
    let bestN = best !== undefined ? tally.get(best)! : 0;
    for (const [c, n] of tally) {
      if (n > bestN) {
        bestN = n;
        best = c;
      }
    }
    return best;
  }

  /** Once a month: people take up their settlement's culture, cultures form and break away, and extinct ones are marked. */
  monthly() {
    const w = this.w;
    const tick = w.state.tick;
    const on = w.toggles.cultures;
    const bySettlement = this.recount();
    for (const s of w.towns.settlements) {
      if (s.abandoned) continue;
      const people = bySettlement.get(s.id) ?? [];
      if (!people.length) continue;
      const dom = this.dominant.get(s.id);
      if (dom !== undefined) {
        // Newcomers without a culture take up the culture they live among; a small minority slowly does too.
        const held = new Map<number, number>();
        for (const p of people) if (p.culture !== undefined) held.set(p.culture, (held.get(p.culture) ?? 0) + 1);
        const monthly = 1 - Math.pow(1 - ASSIMILATE_CHANCE, 1 / 12);
        for (const p of people) {
          if (p.culture === undefined) this.setCulture(p, dom);
          else if (p.culture !== dom && (held.get(p.culture) ?? 0) < people.length * MINORITY_SHARE && w.rand.next() < monthly) this.setCulture(p, dom);
        }
        delete s.cultureless;
        continue;
      }
      s.cultureless ??= s.founded;
      if (on && tick - s.cultureless >= FORM_YEARS * TICKS_PER_YEAR) this.form(s, people);
    }
    // People outside any settlement: after a longer while without a culture, those living near one another form one together.
    const wanderers = this.people.filter((p) => p.settlement === undefined && p.culture === undefined);
    for (const p of wanderers) p.cultureless ??= tick;
    if (on) {
      for (const p of wanderers) {
        if (p.culture !== undefined || tick - p.cultureless! < WANDERER_FORM_YEARS * TICKS_PER_YEAR) continue;
        const c = this.newCulture(undefined);
        for (const q of wanderers) {
          if (q.culture === undefined && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= WANDERER_RANGE * WANDERER_RANGE) this.setCulture(q, c.id);
        }
      }
    }
    // Settlements far from the rest of their culture. A culture's heartland is where most of its people live.
    const heart = new Map<number, { id: number; n: number }>();
    for (const s of w.towns.settlements) {
      const c = this.dominant.get(s.id);
      if (s.abandoned || c === undefined) continue;
      const n = bySettlement.get(s.id)?.length ?? 0;
      const h = heart.get(c);
      if (!h || n > h.n) heart.set(c, { id: s.id, n });
    }
    for (const s of w.towns.settlements) {
      const c = this.dominant.get(s.id);
      if (s.abandoned || c === undefined || heart.get(c)?.id === s.id) {
        delete s.farSince;
        continue;
      }
      let nearest = Infinity;
      let others = 0;
      for (const o of w.towns.settlements) {
        if (o === s || o.abandoned || this.dominant.get(o.id) !== c) continue;
        others++;
        nearest = Math.min(nearest, Math.sqrt(w.towns.dist2(o.center, s.center)));
      }
      if (!others || nearest <= FAR_TILES) {
        delete s.farSince;
        continue;
      }
      s.farSince ??= tick;
      const culture = this.byId.get(c);
      const yearly = culture ? BREAK_CHANCE[culture.traits.outlook] : 0.15;
      if (on && tick - s.farSince >= FAR_YEARS * TICKS_PER_YEAR && w.rand.next() < 1 - Math.pow(1 - yearly, 1 / 12)) {
        this.breakAway(s, bySettlement.get(s.id) ?? []);
      }
    }
    // Cultures with nobody left.
    for (const c of this.list) {
      if (c.extinct === undefined && !(this.members.get(c.id) ?? 0) && tick - c.founded > TICKS_PER_MONTH) {
        c.extinct = tick;
        w.record.add('culture', `The ${c.name} culture died out.`);
        this.changed = true;
      }
    }
    if (this.changed) w.towns.settlementsChanged = true;
  }

  private setCulture(p: Person, id: number | undefined) {
    if (p.culture === id) return;
    if (p.culture !== undefined) this.members.set(p.culture, (this.members.get(p.culture) ?? 1) - 1);
    if (id === undefined) delete p.culture;
    else {
      p.culture = id;
      delete p.cultureless;
      this.members.set(id, (this.members.get(id) ?? 0) + 1);
    }
    this.changed = true;
  }

  private newCulture(origin: Settlement | undefined, parent?: Culture, set?: Partial<CultureTraits>): Culture {
    const w = this.w;
    const traits: CultureTraits = parent
      ? { ...parent.traits }
      : (Object.fromEntries(TRAIT_AXES.map((a) => [a.key, a.poles[w.rand.int(2)]])) as unknown as CultureTraits);
    // What the parent knew is not forgotten.
    const techs = parent?.techs ? [...parent.techs] : undefined;
    if (parent && set) Object.assign(traits, set);
    else if (parent) {
      // A break keeps the old ways but one.
      const a = TRAIT_AXES[w.rand.int(TRAIT_AXES.length)];
      (traits as unknown as Record<string, string>)[a.key] = traits[a.key] === a.poles[0] ? a.poles[1] : a.poles[0];
    }
    // The first color no living culture has (the list runs from most to least distinct).
    const used = new Set(this.list.filter((c) => c.extinct === undefined).map((c) => c.color));
    const free = CULTURE_COLORS.map((_, i) => i).filter((i) => !used.has(i));
    const color = free.length ? free[0] : w.rand.int(CULTURE_COLORS.length);
    const c: Culture = { id: w.state.nextCultureId!++, name: this.newName(), color, founded: w.state.tick, origin: origin?.id, parent: parent?.id, traits };
    if (techs) c.techs = techs;
    this.list.push(c);
    this.byId.set(c.id, c);
    this.changed = true;
    return c;
  }

  private newName() {
    const w = this.w;
    const taken = new Set(this.list.map((c) => c.name));
    for (let k = 0; k < 40; k++) {
      const name = NAME_START[w.rand.int(NAME_START.length)] + NAME_END[w.rand.int(NAME_END.length)];
      if (!taken.has(name)) return name;
    }
    return NAME_START[w.rand.int(NAME_START.length)] + NAME_END[w.rand.int(NAME_END.length)] + ' ' + (this.list.length + 1);
  }

  /** A culture forms among a settlement's people (SPEC 7: after a period of having no culture). */
  private form(s: Settlement, people: Person[]) {
    const c = this.newCulture(s);
    this.w.record.add('culture', `The ${c.name} culture formed at ${s.name}.`, s.center);
    for (const p of people) this.setCulture(p, c.id);
    this.dominant.set(s.id, c.id);
    delete s.cultureless;
    this.w.towns.settlementsChanged = true;
  }

  /** A settlement's people of its culture break away and found a new one (SPEC 7: a deliberate break). */
  private breakAway(s: Settlement, people: Person[]) {
    const old = this.dominant.get(s.id);
    const parent = old !== undefined ? this.byId.get(old) : undefined;
    if (!parent) return;
    const c = this.newCulture(s, parent);
    this.w.record.add('culture', `${s.name} broke away from the ${parent.name} culture, forming the ${c.name} culture.`, s.center);
    for (const p of people) if (p.culture === old) this.setCulture(p, c.id);
    this.dominant.set(s.id, c.id);
    delete s.farSince;
    this.w.towns.settlementsChanged = true;
  }

  /** A group breaks from its culture over its nation's policies, taking up the ways given (Caleb; see nations.ts). */
  splitOff(s: Settlement, parent: Culture, members: Person[], set: Partial<CultureTraits>) {
    const c = this.newCulture(s, parent, set);
    this.w.record.add('culture', `People of ${s.name} broke from the ${parent.name} culture over their nation's ways, forming the ${c.name} culture.`, s.center);
    for (const p of members) if (p.culture === parent.id) this.setCulture(p, c.id);
    this.recount();
  }

  /** The player's order: a settlement breaks from its culture (whether or not the rule is on). */
  orderBreak(settlementId: number) {
    const s = this.w.towns.byId(settlementId);
    if (!s || s.abandoned) return;
    const people = this.people.filter((p) => p.settlement === s.id);
    this.recount();
    this.breakAway(s, people);
  }

  /** A newborn takes their mother's culture, or their father's. */
  onBirth(child: Person, mother: Person, father: Person | undefined) {
    const c = mother.culture ?? father?.culture;
    if (c !== undefined) this.setCulture(child, c);
  }

  /** Someone has died or been removed. */
  onGone(p: Person) {
    if (p.culture !== undefined) this.members.set(p.culture, (this.members.get(p.culture) ?? 1) - 1);
  }

  /** The player sets someone's culture (SPEC 1), or takes it away. */
  setPersonCulture(p: Person, id: number | null) {
    if (id !== null && !this.byId.get(id)) return;
    this.setCulture(p, id ?? undefined);
    const c = id !== null ? this.byId.get(id) : undefined;
    if (c && c.extinct !== undefined) delete c.extinct;
  }

  /** The player edits a culture (SPEC 7). */
  edit(id: number, e: CultureEdit) {
    const c = this.byId.get(id);
    if (!c) return;
    if (e.name !== undefined && e.name.trim()) c.name = e.name.trim().slice(0, 40);
    if (e.color !== undefined && e.color >= 0 && e.color < CULTURE_COLORS.length) c.color = e.color;
    if (e.traits) {
      for (const a of TRAIT_AXES) {
        const v = e.traits[a.key];
        if (v !== undefined && a.poles.includes(v)) (c.traits as unknown as Record<string, string>)[a.key] = v;
      }
    }
    if (e.research !== undefined || e.techs) this.w.tech.edit(c, e.research, e.techs);
    this.changed = true;
  }

  /** The traits of a settlement's culture, if it has one. */
  /** A settlement's main culture. */
  cultureOf(s: Settlement): Culture | undefined {
    const c = this.dominant.get(s.id);
    return c !== undefined ? this.byId.get(c) : undefined;
  }

  traitsOf(s: Settlement): CultureTraits | undefined {
    const c = this.dominant.get(s.id);
    return c !== undefined ? this.byId.get(c)?.traits : undefined;
  }

  views(): CultureView[] {
    const settlements = new Map<number, number>();
    for (const c of this.dominant.values()) settlements.set(c, (settlements.get(c) ?? 0) + 1);
    return this.list.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      foundedYear: Math.floor(c.founded / TICKS_PER_YEAR) + 1,
      members: Math.max(0, this.members.get(c.id) ?? 0),
      settlements: settlements.get(c.id) ?? 0,
      traits: { ...c.traits },
      origin: c.origin !== undefined ? this.w.towns.settlementName(c.origin) : undefined,
      parent: c.parent,
      extinctYear: c.extinct !== undefined ? Math.floor(c.extinct / TICKS_PER_YEAR) + 1 : undefined,
      techs: [...(c.techs ?? [])],
      ...this.w.tech.researchView(c),
    }));
  }

  /** A settlement's culture, and how many other cultures live there. */
  ofSettlement(id: number): { culture?: number; others: number } {
    const dom = this.dominant.get(id);
    const seen = new Set<number>();
    for (const p of this.people) if (p.settlement === id && p.culture !== undefined && p.culture !== dom) seen.add(p.culture);
    return { culture: dom, others: seen.size };
  }
}
