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

export const WORLD_FORMAT_VERSION = 7;

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
  return doc;
}
