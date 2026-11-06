import { DEFAULT_TOGGLES } from '../sim/types';
import { Deposit } from '../map/terrain';
import type { WorldDoc } from './types';

// Versions of stored setups and saved runs. When what is saved changes, raise
// WORLD_FORMAT_VERSION and teach upgradeWorld() to bring older ones forward, so setups
// and runs saved today keep opening.
//
//   1  Stage 2a: people with a position and health.
//   2  Stage 2b: people's needs (food, rest), the food they carry, their orders; food left on each tile.
//   3  Stage 2c: pairs, parents, pregnancy and births; the rules the player has turned on or off.
//   4  Stage 3a: settlements, buildings, land, trees standing, stone left; people's settlement and home.
//   5  Buildings span several tiles and can be turned (Building.rot). Buildings saved in 4 keep
//      their corner tile and take their new size from there (nothing to change in the data).
//   6  Stage 3b: jobs, settlement stores, farm crops; iron and gold deposits hold ore.
//   7  Stage 3c: coins (people and treasuries), household goods, traders' runs, tools and
//      pottery, clay deposits hold clay, fences and gates.
//   8  Stage 4a: cultures; people's culture; how long a settlement has been without a culture
//      or far from its culture; the culture formation rule.
//   9  Settlements spread: which settlement founded one, how long it has been crowded, when it
//      last sent people out; settlers' home settlement. (New fields only; nothing to change.)
//  10  Stage 4b: nations, relations between them, settlements' nation and unrest, unique
//      people, officials' taxes, cultures' support for policies; the four new rules.
//  11  Stage 4c: cultures' technologies and research, nations' technologies, scholars; the
//      research rule. (Older cultures start knowing nothing; buildings already standing stay.)
//  12  Pavement on each tile, and each settlement's planned paths. (New fields only.)
//  13  Stage 5: armies, wars on relations, soldiers and their arms, arms in stores, buildings
//      burning, armorers' work; the war rule. (Runs from before have no armies; the rule starts on.)
//  14  After Stage 5: bridges on each tile, settlements' planned bridges, docks and castles,
//      builders' bridge work, orders to gather resources. (New fields only. Land on water or
//      mountains, which older runs could hold, is let go when the run opens.)
//  15  Settlements' yearly head counts (whether they are still growing) and the most people they
//      have had (coins for newcomers). (New fields only. An older run's villages and towns are
//      given coins for all their people the first month, since their coins had not kept pace.)
//  16  Stage 6: weather fronts and droughts, floods, locusts and forest fires, animals (wild and
//      tame), the record of events, people's sickness, criminals and their camps and raids,
//      fires being put out; the events, criminals and record rules. (Runs from before get the
//      animals the land holds when they open; the new rules start on.)

export const WORLD_FORMAT_VERSION = 16;

export function upgradeWorld(version: number, doc: WorldDoc): WorldDoc {
  if (version > WORLD_FORMAT_VERSION) throw new Error('This was saved by a newer version of the app. Reload the app to update it, then try again.');
  if (version < 2) {
    // People saved before needs existed start fed and rested; food tiles start full (the simulation fills them in).
    doc = { ...doc, state: { ...doc.state, people: doc.state.people.map((p) => ({ ...p, food: 100, rest: 100, carry: 0 })) } };
  }
  if (version < 3) {
    // Nobody saved before 2c is paired or expecting; every rule starts on.
    doc = { ...doc, state: { ...doc.state, toggles: { ...DEFAULT_TOGGLES } } };
  }
  if (version < 4) {
    // No settlements yet; the new rule (settlement founding) starts on. Trees and stone start full (the simulation fills them in).
    doc = { ...doc, state: { ...doc.state, toggles: { ...DEFAULT_TOGGLES, ...doc.state.toggles }, settlements: [], buildings: [] } };
  }
  if (version < 6 && doc.state.stock && doc.state.trees) {
    // Worlds that already kept stone left start their iron and gold deposits full. (Worlds older
    // than that have every deposit filled by the simulation when they open.)
    const stock = doc.state.stock.slice();
    for (let i = 0; i < stock.length; i++) if (doc.deposit[i] === Deposit.Iron || doc.deposit[i] === Deposit.Gold) stock[i] = 20;
    doc = { ...doc, state: { ...doc.state, stock } };
  }
  if (version < 7) {
    let state = doc.state;
    if (state.stock && state.trees) {
      // Clay deposits start full.
      const stock = state.stock.slice();
      for (let i = 0; i < stock.length; i++) if (doc.deposit[i] === Deposit.Clay) stock[i] = 20;
      state = { ...state, stock };
    }
    // Settlements that were already villages or bigger get the purse a new village gets.
    const counts = new Map<number, number>();
    for (const p of state.people) if (p.settlement !== undefined) counts.set(p.settlement, (counts.get(p.settlement) ?? 0) + 1);
    state = {
      ...state,
      settlements: (state.settlements ?? []).map((s) => (s.stage === 'camp' || s.coins !== undefined ? s : { ...s, coins: 50 + 3 * (counts.get(s.id) ?? 0) })),
    };
    doc = { ...doc, state };
  }
  if (version < 8) {
    // No cultures yet (they form as the run goes on); the new rule (culture formation) starts on.
    doc = { ...doc, state: { ...doc.state, toggles: { ...DEFAULT_TOGGLES, ...doc.state.toggles }, cultures: [], nextCultureId: 1 } };
  }
  if (version < 10) {
    // No nations yet; the new rules start on. (Runs without the nations field need nothing else.)
    doc = { ...doc, state: { ...doc.state, toggles: { ...DEFAULT_TOGGLES, ...doc.state.toggles }, nations: doc.state.nations ?? [], nextNationId: doc.state.nextNationId ?? 1, relations: doc.state.relations ?? [] } };
  }
  if (version < 11) {
    // The new rule (culture research) starts on; cultures and nations know nothing yet.
    doc = { ...doc, state: { ...doc.state, toggles: { ...DEFAULT_TOGGLES, ...doc.state.toggles } } };
  }
  if (version < 13) {
    // No armies yet; the new rule (war) starts on. Stores without arms get none (the simulation fills missing goods with 0).
    doc = { ...doc, state: { ...doc.state, toggles: { ...DEFAULT_TOGGLES, ...doc.state.toggles }, armies: doc.state.armies ?? [], nextArmyId: doc.state.nextArmyId ?? 1 } };
  }
  if (version < 16) {
    // The new rules (events, criminals, record) start on. Weather, animals and the record start when the run opens.
    doc = { ...doc, state: { ...doc.state, toggles: { ...DEFAULT_TOGGLES, ...doc.state.toggles } } };
  }
  return doc;
}
