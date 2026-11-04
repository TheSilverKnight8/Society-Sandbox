import type { SimState } from '../sim/types';

// Setups and saved runs (SPEC 5). A setup is a starting point built on a map: the map's
// tiles (copied, so the setup's terrain never changes) plus everything placed on it.
// A saved run is the state of a world part-way through a run. Both have the same shape.

export interface WorldDoc {
  id: string;
  name: string;
  kind: 'setup' | 'run';
  /** For a saved run: the setup it was started from (it may since have been deleted). */
  setupId?: string;
  setupName?: string;
  mapName: string;
  size: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  /** Deposits can change during a run (used up), so each world keeps its own. */
  deposit: Uint8Array;
  state: SimState;
  createdAt: string;
  updatedAt: string;
}

/** The small part of a world that Home lists. */
export interface WorldMeta {
  id: string;
  name: string;
  kind: 'setup' | 'run';
  setupId?: string;
  setupName?: string;
  mapName: string;
  size: number;
  population: number;
  tick: number;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
}

export function worldMetaOf(doc: WorldDoc, thumbnail?: string): WorldMeta {
  return {
    id: doc.id,
    name: doc.name,
    kind: doc.kind,
    setupId: doc.setupId,
    setupName: doc.setupName,
    mapName: doc.mapName,
    size: doc.size,
    population: doc.state.people.length,
    tick: doc.state.tick,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    thumbnail,
  };
}
