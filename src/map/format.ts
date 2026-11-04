import { MAP_SIZES, type GenSettings, type MapData } from './types';
import { TERRAINS, DEPOSITS, terrainDef, depositFits } from './terrain';

// Map files and versions.
//
// Every stored map and every exported map file carries a format version. When what is
// saved changes, raise FORMAT_VERSION and teach upgrade() to bring older maps forward,
// so maps and files made today keep opening.

export const FORMAT = 'society-sandbox-map';
export const FORMAT_VERSION = 1;

export interface MapFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  map: {
    name: string;
    size: number;
    createdAt: string;
    updatedAt: string;
    gen?: GenSettings;
    /** Base64 of the byte arrays. */
    terrain: string;
    elevation: string;
    deposit: string;
  };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toFile(map: MapData): MapFile {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    map: {
      name: map.name,
      size: map.size,
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
      gen: map.gen,
      terrain: toBase64(map.terrain),
      elevation: toBase64(map.elevation),
      deposit: toBase64(map.deposit),
    },
  };
}

export function fileName(map: { name: string }) {
  const safe = map.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'map';
  return `${safe}.map.json`;
}

/** Brings a map stored or exported by an older version of the app up to this one. Version 1 is the first. */
export function upgrade(version: number, map: MapData): MapData {
  if (version > FORMAT_VERSION) throw new Error('This map was saved by a newer version of the app. Reload the app to update it, then try again.');
  return map;
}

/** Reads an exported map file. Throws an error with a reason a person can act on. */
export function fromFile(text: string, newId: string): MapData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a map file (it is not readable as JSON).');
  }
  const f = data as Partial<MapFile>;
  if (!f || f.format !== FORMAT) throw new Error('This file is not a Society Sandbox map file.');
  if (typeof f.version !== 'number') throw new Error('This map file has no version number.');
  if (f.version > FORMAT_VERSION) throw new Error('This map file was made by a newer version of the app. Reload the app to update it, then try again.');
  const m = f.map;
  if (!m || typeof m.size !== 'number' || !MAP_SIZES.some((s) => s.size === m.size)) throw new Error('This map file has an unknown map size.');
  const n = m.size * m.size;
  let terrain: Uint8Array, elevation: Uint8Array, deposit: Uint8Array;
  try {
    terrain = fromBase64(m.terrain);
    elevation = fromBase64(m.elevation);
    deposit = fromBase64(m.deposit);
  } catch {
    throw new Error('This map file is damaged (its tile data cannot be read).');
  }
  if (terrain.length !== n || elevation.length !== n || deposit.length !== n) throw new Error('This map file is damaged (its tile data is the wrong length).');
  // Repair any tile values this version does not know, rather than refusing the whole file.
  for (let i = 0; i < n; i++) {
    if (terrain[i] >= TERRAINS.length) terrain[i] = 0;
    const d = terrainDef(terrain[i]);
    if (elevation[i] < d.minElev || elevation[i] > d.maxElev) elevation[i] = Math.max(d.minElev, Math.min(d.maxElev, elevation[i]));
    if (deposit[i] >= DEPOSITS.length || !depositFits(deposit[i], terrain[i])) deposit[i] = 0;
  }
  const now = new Date().toISOString();
  const map: MapData = {
    id: newId,
    name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 80) : 'Imported map',
    size: m.size,
    terrain,
    elevation,
    deposit,
    gen: m.gen,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : now,
    updatedAt: now,
  };
  return upgrade(f.version, map);
}

/** Saves text as a file in the browser's downloads. */
export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
