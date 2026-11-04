import { useSyncExternalStore } from 'react';
import { deleteMapData, listMaps, readMap, storageMessage, writeMap } from './db';
import { newId } from './ids';
import { FORMAT_VERSION, download, fileName, fromFile, toFile, upgrade } from '../map/format';
import { blankTiles, generateTiles } from '../map/generate';
import { makeThumbnail } from '../map/thumbnail';
import { metaOf, type GenSettings, type MapData, type MapMeta } from '../map/types';

export interface SaveStatus {
  state: 'saved' | 'saving' | 'error';
  message?: string;
}

/** The map open in Map mode, if any. Only one is open at a time. */
export type OpenMap =
  | { kind: 'none' }
  | { kind: 'loading'; id: string }
  | { kind: 'ready'; map: MapData }
  | { kind: 'missing'; id: string }
  /** Open in another tab or window of the app, which would overwrite changes made here. */
  | { kind: 'elsewhere'; id: string }
  | { kind: 'error'; id: string; message: string };

export interface StorageInfo {
  /** Whether Chrome has agreed to keep this site's storage when the disk runs low. null: not known. */
  persisted: boolean | null;
  /** Bytes used by this site, as the browser reports it. */
  usage: number | null;
}

export interface AppState {
  boot: { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };
  /** Oldest first. */
  maps: MapMeta[];
  open: OpenMap;
  save: SaveStatus;
  storage: StorageInfo;
}

let state: AppState = {
  boot: { kind: 'loading' },
  maps: [],
  open: { kind: 'none' },
  save: { state: 'saved' },
  storage: { persisted: null, usage: null },
};

const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function getState() {
  return state;
}

/** Reads part of the app state and re-renders when it changes. The selector must return something already in the state (not a new object). */
export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

const byCreated = (a: MapMeta, b: MapMeta) => a.createdAt.localeCompare(b.createdAt);

function setMapMeta(meta: MapMeta) {
  const rest = state.maps.filter((m) => m.id !== meta.id);
  set({ maps: [...rest, meta].sort(byCreated) });
}

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; reason: string };

// ---------------------------------------------------------------- start

export async function initApp() {
  try {
    const maps = await listMaps();
    set({ boot: { kind: 'ready' }, maps: maps.sort(byCreated) });
  } catch (e) {
    set({ boot: { kind: 'error', message: storageMessage(e) } });
    return;
  }
  void refreshStorage();
}

/**
 * Asks Chrome to keep this site's storage even when the disk runs low (persistent
 * storage). Chrome decides on its own whether to agree. Also reads how much space
 * the site uses.
 */
export async function refreshStorage() {
  const s = navigator.storage;
  if (!s) return;
  try {
    let persisted = s.persisted ? await s.persisted() : null;
    if (!persisted && state.maps.length > 0 && s.persist) persisted = await s.persist();
    const estimate = s.estimate ? await s.estimate() : undefined;
    set({ storage: { persisted, usage: estimate?.usage ?? null } });
  } catch {
    // Unknown; the line on Home just says less.
  }
}

// ---------------------------------------------------------------- maps

export async function createMap(opts: { name: string; size: number; gen: GenSettings | null }): Promise<Result<string>> {
  const now = new Date().toISOString();
  const tiles = opts.gen ? generateTiles(opts.size, opts.gen) : blankTiles(opts.size);
  const map: MapData = {
    id: newId(),
    name: opts.name.trim() || 'Untitled map',
    size: opts.size,
    ...tiles,
    gen: opts.gen ?? undefined,
    createdAt: now,
    updatedAt: now,
  };
  const meta = metaOf(map, makeThumbnail(tiles, map.size));
  try {
    await writeMap(meta, { id: map.id, version: FORMAT_VERSION, map });
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  setMapMeta(meta);
  void refreshStorage();
  return { ok: true, value: map.id };
}

export async function deleteMap(id: string): Promise<Result> {
  const o = state.open;
  if (o.kind !== 'none' && (o.kind === 'ready' ? o.map.id : o.id) === id) await closeMap();
  try {
    await deleteMapData(id);
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  set({ maps: state.maps.filter((m) => m.id !== id) });
  void refreshStorage();
  return { ok: true, value: undefined };
}

export async function exportMap(id: string): Promise<Result> {
  try {
    if (state.open.kind === 'ready' && state.open.map.id === id) await flushSaves();
    const stored = await readMap(id);
    if (!stored) return { ok: false, reason: 'This map is no longer in the app.' };
    const map = upgrade(stored.version, stored.map);
    download(fileName(map), JSON.stringify(toFile(map)));
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
}

export async function importMap(file: File): Promise<Result<MapMeta>> {
  let map: MapData;
  try {
    map = fromFile(await file.text(), newId());
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const meta = metaOf(map, makeThumbnail(map, map.size));
  try {
    await writeMap(meta, { id: map.id, version: FORMAT_VERSION, map });
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  setMapMeta(meta);
  void refreshStorage();
  return { ok: true, value: meta };
}

// ---------------------------------------------------------------- the open map

let openToken = 0;
let releaseLock: (() => void) | null = null;

/**
 * Holds a lock on the map while it is open, so the same map cannot be open in two tabs
 * or windows at once (each would save over the other's changes). Resolves to the
 * function that lets go of it, or null if another tab holds it. It waits a moment first,
 * because a lock let go of a moment ago (leaving and reopening the same map) can take a
 * little while to become free.
 */
function lockMap(id: string): Promise<(() => void) | null> {
  if (!navigator.locks) return Promise.resolve(() => {});
  return new Promise((acquired) => {
    navigator.locks
      .request(`map:${id}`, { signal: AbortSignal.timeout(1500) }, () => new Promise<void>((release) => acquired(release)))
      .catch(() => acquired(null));
  });
}

function unlock() {
  releaseLock?.();
  releaseLock = null;
}

export async function openMap(id: string) {
  const o = state.open;
  if (o.kind === 'ready' && o.map.id === id) return;
  await closeMap();
  const token = ++openToken;
  // Another map was asked for (or this one closed) while this one was loading.
  const stale = () => token !== openToken;
  set({ open: { kind: 'loading', id } });
  const release = await lockMap(id);
  if (!release) {
    if (!stale()) set({ open: { kind: 'elsewhere', id } });
    return;
  }
  if (stale()) return release();
  releaseLock = release;
  try {
    const stored = await readMap(id);
    if (stale()) return; // closeMap has already let go of the lock
    if (!stored) {
      unlock();
      return set({ open: { kind: 'missing', id } });
    }
    const map = upgrade(stored.version, stored.map);
    set({ open: { kind: 'ready', map }, save: { state: 'saved' } });
    // A map saved by an older version of the app is saved again in the current format.
    if (stored.version < FORMAT_VERSION) mapChanged(map);
  } catch (e) {
    if (stale()) return;
    unlock();
    set({ open: { kind: 'error', id, message: storageMessage(e) } });
  }
}

export async function closeMap() {
  openToken++;
  await flushSaves();
  unlock();
  if (state.open.kind !== 'none') set({ open: { kind: 'none' } });
}

// ---------------------------------------------------------------- saving

const SAVE_DELAY = 600;
let saveTimer = 0;
let pendingMap: MapData | null = null;
let saving: Promise<void> | null = null;

/**
 * Call after changing the open map in place (its tile arrays are edited directly).
 * Saves half a second or so after the last change.
 */
export function mapChanged(map: MapData) {
  map.updatedAt = new Date().toISOString();
  pendingMap = map;
  if (state.save.state !== 'saving') set({ save: { state: 'saving' } });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSaves(), SAVE_DELAY);
}

export function hasUnsavedChanges() {
  return pendingMap !== null || saving !== null;
}

/** Saves any waiting change now. */
export async function flushSaves(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (saving) await saving;
  const map = pendingMap;
  if (!map) return;
  pendingMap = null;
  saving = (async () => {
    try {
      const meta = metaOf(map, makeThumbnail(map, map.size));
      await writeMap(meta, { id: map.id, version: FORMAT_VERSION, map });
      setMapMeta(meta);
      if (!pendingMap) set({ save: { state: 'saved' } });
    } catch (e) {
      pendingMap = pendingMap ?? map;
      set({ save: { state: 'error', message: storageMessage(e) } });
    }
  })();
  await saving;
  saving = null;
}
