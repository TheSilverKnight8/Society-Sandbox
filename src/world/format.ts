import { DEFAULT_TOGGLES } from '../sim/types';
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

export const WORLD_FORMAT_VERSION = 5;

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
  return doc;
}
