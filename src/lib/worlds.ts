import { deleteWorldData, readMap, readWorld, storageMessage, writeWorld } from './db';
import { newId } from './ids';
import { getState, lockName, patchState, refreshStorage, type Result } from './store';
import { upgrade } from '../map/format';
import { makeThumbnail } from '../map/thumbnail';
import { emptyState, type SimState } from '../sim/types';
import { WORLD_FORMAT_VERSION, upgradeWorld } from '../world/format';
import { worldMetaOf, type WorldDoc, type WorldMeta } from '../world/types';

// Setups and saved runs: making, opening, saving and deleting them.

const byCreated = (a: WorldMeta, b: WorldMeta) => a.createdAt.localeCompare(b.createdAt);

function setWorldMeta(meta: WorldMeta) {
  const rest = getState().worlds.filter((w) => w.id !== meta.id);
  patchState({ worlds: [...rest, meta].sort(byCreated) });
}

/** Makes a setup from a map. The setup keeps its own copy of the map's tiles (SPEC 3: a loaded map cannot be edited). */
export async function createSetup(name: string, mapId: string): Promise<Result<string>> {
  try {
    const stored = await readMap(mapId);
    if (!stored) return { ok: false, reason: 'That map is no longer in the app.' };
    const map = upgrade(stored.version, stored.map);
    const now = new Date().toISOString();
    const doc: WorldDoc = {
      id: newId(),
      name: name.trim() || 'Untitled setup',
      kind: 'setup',
      mapName: map.name,
      size: map.size,
      terrain: map.terrain.slice(),
      elevation: map.elevation.slice(),
      deposit: map.deposit.slice(),
      state: emptyState(Math.floor(Math.random() * 2 ** 31)),
      createdAt: now,
      updatedAt: now,
    };
    const meta = worldMetaOf(doc, makeThumbnail(doc, doc.size));
    await writeWorld(meta, { id: doc.id, version: WORLD_FORMAT_VERSION, doc });
    setWorldMeta(meta);
    void refreshStorage();
    return { ok: true, value: doc.id };
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
}

export async function deleteWorld(id: string): Promise<Result> {
  const w = getState().world;
  if (w.kind !== 'none' && (w.kind === 'ready' ? w.doc.id : w.id) === id) await closeWorld();
  try {
    await deleteWorldData(id);
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  patchState({ worlds: getState().worlds.filter((x) => x.id !== id) });
  void refreshStorage();
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------- the open world

let token = 0;
let release: (() => void) | null = null;

function unlock() {
  release?.();
  release = null;
}

/** Opens a setup or saved run for the main screen. Only one tab can have a given world open. */
export async function openWorld(id: string) {
  const w = getState().world;
  if (w.kind === 'ready' && w.doc.id === id) return;
  await closeWorld();
  const mine = ++token;
  const stale = () => mine !== token;
  patchState({ world: { kind: 'loading', id } });
  const r = await lockName(`world:${id}`);
  if (!r) {
    if (!stale()) patchState({ world: { kind: 'elsewhere', id } });
    return;
  }
  if (stale()) return r();
  release = r;
  try {
    const stored = await readWorld(id);
    if (stale()) return;
    if (!stored) {
      unlock();
      return patchState({ world: { kind: 'missing', id } });
    }
    patchState({ world: { kind: 'ready', doc: upgradeWorld(stored.version, stored.doc) }, worldUnsaved: false });
  } catch (e) {
    if (stale()) return;
    unlock();
    patchState({ world: { kind: 'error', id, message: storageMessage(e) } });
  }
}

export async function closeWorld() {
  token++;
  unlock();
  if (getState().world.kind !== 'none') patchState({ world: { kind: 'none' }, worldUnsaved: false });
}

export function setWorldUnsaved(v: boolean) {
  if (getState().worldUnsaved !== v) patchState({ worldUnsaved: v });
}

/** Saves the open world's current state over its stored copy (a setup's starting state, or a saved run). */
export async function saveWorld(doc: WorldDoc, state: SimState, deposit: Uint8Array): Promise<Result<WorldDoc>> {
  const next: WorldDoc = { ...doc, state, deposit, updatedAt: new Date().toISOString() };
  try {
    const meta = worldMetaOf(next, getState().worlds.find((w) => w.id === doc.id)?.thumbnail ?? makeThumbnail(next, next.size));
    await writeWorld(meta, { id: next.id, version: WORLD_FORMAT_VERSION, doc: next });
    setWorldMeta(meta);
    patchState({ world: { kind: 'ready', doc: next }, worldUnsaved: false });
    void refreshStorage();
    return { ok: true, value: next };
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
}

/** Saves the current state of a run as a new saved run, and makes it the open world. */
export async function saveRunAs(from: WorldDoc, name: string, state: SimState, deposit: Uint8Array): Promise<Result<WorldDoc>> {
  const now = new Date().toISOString();
  const doc: WorldDoc = {
    ...from,
    id: newId(),
    name: name.trim() || 'Untitled run',
    kind: 'run',
    setupId: from.kind === 'setup' ? from.id : from.setupId,
    setupName: from.kind === 'setup' ? from.name : from.setupName,
    state,
    deposit,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const meta = worldMetaOf(doc, getState().worlds.find((w) => w.id === from.id)?.thumbnail ?? makeThumbnail(doc, doc.size));
    const r = await lockName(`world:${doc.id}`);
    await writeWorld(meta, { id: doc.id, version: WORLD_FORMAT_VERSION, doc });
    setWorldMeta(meta);
    // The new run is now the open world: let go of the old one's lock, keep the new one's.
    token++;
    unlock();
    release = r;
    patchState({ world: { kind: 'ready', doc }, worldUnsaved: false });
    void refreshStorage();
    return { ok: true, value: doc };
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
}

/** The stored starting state of a setup, for starting a run again from it. */
export async function readSetup(id: string): Promise<WorldDoc | null> {
  const stored = await readWorld(id);
  return stored ? upgradeWorld(stored.version, stored.doc) : null;
}
