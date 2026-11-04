import type { MapData, MapMeta } from '../map/types';

// The app's storage in this browser (IndexedDB). Nothing leaves the computer.
//
//   maps     MapMeta by map ID: the small list Home shows (name, size, dates, thumbnail)
//   mapData  { id, version, map } by map ID: the whole map, tile arrays included
//
// Later stages add stores for setups and saved runs.

const DB_NAME = 'society-sandbox';
const DB_VERSION = 1;

export interface StoredMap {
  id: string;
  /** The map format version it was saved in (see map/format.ts). */
  version: number;
  map: MapData;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no IndexedDB storage.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('mapData')) db.createObjectStore('mapData', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab with a newer version of the app needs to upgrade the database.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The app is open in another tab with an older version. Close that tab and reload.'));
  });
  opening.catch(() => (opening = null));
  return opening;
}

function result<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('The save was cancelled.', 'AbortError'));
  });
}

export async function listMaps(): Promise<MapMeta[]> {
  const db = await open();
  return result(db.transaction('maps').objectStore('maps').getAll() as IDBRequest<MapMeta[]>);
}

export async function readMap(id: string): Promise<StoredMap | undefined> {
  const db = await open();
  return result(db.transaction('mapData').objectStore('mapData').get(id) as IDBRequest<StoredMap | undefined>);
}

/** Saves a map's list entry and its data together, so they never disagree. */
export async function writeMap(meta: MapMeta, stored: StoredMap): Promise<void> {
  const db = await open();
  const tx = db.transaction(['maps', 'mapData'], 'readwrite');
  tx.objectStore('maps').put(meta);
  tx.objectStore('mapData').put(stored);
  return finished(tx);
}

export async function deleteMapData(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['maps', 'mapData'], 'readwrite');
  tx.objectStore('maps').delete(id);
  tx.objectStore('mapData').delete(id);
  return finished(tx);
}

/** Turns storage errors into a sentence a person can act on. */
export function storageMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'QuotaExceededError') return 'The browser has no more room for this site. Free up disk space, or delete a map.';
  return err?.message || 'Unknown storage error.';
}
