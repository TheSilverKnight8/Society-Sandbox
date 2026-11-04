import type { WorldDoc } from './types';

// Versions of stored setups and saved runs. When what is saved changes, raise
// WORLD_FORMAT_VERSION and teach upgradeWorld() to bring older ones forward, so setups
// and runs saved today keep opening.
//
//   1  Stage 2a: people with a position and health.
//   2  Stage 2b: people's needs (food, rest), the food they carry, their orders; food left on each tile.

export const WORLD_FORMAT_VERSION = 2;

export function upgradeWorld(version: number, doc: WorldDoc): WorldDoc {
  if (version > WORLD_FORMAT_VERSION) throw new Error('This was saved by a newer version of the app. Reload the app to update it, then try again.');
  if (version < 2) {
    // People saved before needs existed start fed and rested; food tiles start full (the simulation fills them in).
    doc = { ...doc, state: { ...doc.state, people: doc.state.people.map((p) => ({ ...p, food: 100, rest: 100, carry: 0 })) } };
  }
  return doc;
}
