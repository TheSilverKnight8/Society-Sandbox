import type { WorldDoc } from './types';

// Versions of stored setups and saved runs. When what is saved changes, raise
// WORLD_FORMAT_VERSION and teach upgradeWorld() to bring older ones forward, so setups
// and runs saved today keep opening.

export const WORLD_FORMAT_VERSION = 1;

export function upgradeWorld(version: number, doc: WorldDoc): WorldDoc {
  if (version > WORLD_FORMAT_VERSION) throw new Error('This was saved by a newer version of the app. Reload the app to update it, then try again.');
  return doc;
}
