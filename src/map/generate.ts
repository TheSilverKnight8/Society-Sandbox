import { makeNoise } from '../lib/noise';
import { makeRng } from '../lib/rng';
import { Deposit, MAX_ELEV, Terrain, depositFits, isWater, terrainDef } from './terrain';
import type { GenSettings } from './types';

export interface Tiles {
  terrain: Uint8Array;
  elevation: Uint8Array;
  deposit: Uint8Array;
}

export function blankTiles(size: number): Tiles {
  // All deep water: a blank map is an empty sea to paint land into.
  return { terrain: new Uint8Array(size * size), elevation: new Uint8Array(size * size), deposit: new Uint8Array(size * size) };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Makes a map from settings. The same settings and size always give the same map.
 * Steps: a height field from noise, a sea level set so the land share matches,
 * mountain ranges along noise ridges, a moisture field for forests, deserts and
 * swamps, coasts and lakes, rivers that run downhill to water, then deposits.
 */
export function generateTiles(size: number, s: GenSettings): Tiles {
  const n = size * size;
  const height = new Float32Array(n);
  const mountainH = new Float32Array(n);
  const moisture = new Float32Array(n);
  const hN = makeNoise(s.seed);
  const mN = makeNoise(s.seed + 1);
  const rN = makeNoise(s.seed + 2);
  const dN = makeNoise(s.seed + 3);
  const wN = makeNoise(s.seed + 4);
  const rng = makeRng(s.seed + 5);

  const features = s.shape === 'continent' ? 3 : s.shape === 'continents' ? 2.4 : 6;
  const octaves = 5 + Math.round(Math.log2(size / 128));

  // 1. Height field.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const ny = (y / size) * 2 - 1;
      let u = (x / size) * features;
      let v = (y / size) * features;
      u += 0.35 * wN.fbm(u * 0.8, v * 0.8, 3);
      v += 0.35 * wN.fbm(u * 0.8 + 40, v * 0.8 + 40, 3);
      const nv = hN.fbm(u, v, octaves, 0.5);
      let h: number;
      if (s.shape === 'continent') {
        const d = Math.sqrt(nx * nx + ny * ny) / 1.2;
        h = nv * 0.75 + (0.55 - d) * 0.9;
      } else if (s.shape === 'continents') {
        h = nv * 1.1 + 0.05;
      } else {
        h = nv * 1.1;
      }
      // Ocean all around the edge.
      const edge = Math.max(Math.abs(nx), Math.abs(ny));
      const keep = smoothstep(0.97, 0.72, edge);
      h = h * keep - (1 - keep) * 0.6;
      const i = y * size + x;
      height[i] = h;

      // Mountain ranges follow the crests of a ridged noise, in regions picked by a slow noise.
      const ridge = rN.ridged(u * 1.6, v * 1.6, 4);
      const region = smoothstep(-0.1, 0.35, rN.fbm(u * 0.7 + 50, v * 0.7, 2) + (s.mountains - 0.5) * 0.7);
      mountainH[i] = Math.pow(Math.max(0, ridge - 0.42) / 0.58, 1.3) * region * (3 + 13 * s.mountains);

      moisture[i] = mN.fbm(u * 1.4 + 7, v * 1.4 - 3, 4) * 0.5 + 0.5;
    }
  }

  // 2. Sea level: the height below which the requested share of tiles lies.
  const sorted = Float32Array.from(height).sort();
  const sea = sorted[clamp(Math.floor((1 - clamp(s.land, 0.05, 0.95)) * n), 0, n - 1)];
  const top = sorted[n - 1];

  const terrain = new Uint8Array(n);
  const elevation = new Uint8Array(n);
  const deposit = new Uint8Array(n);

  // Moisture thresholds by rank among land tiles, so the sliders set shares of the land:
  // Deserts at 100% makes the driest 30% desert; Forests at 100% makes the wettest 70% forest.
  const landMoist: number[] = [];
  for (let i = 0; i < n; i++) if (height[i] >= sea) landMoist.push(moisture[i]);
  landMoist.sort((a, b) => a - b);
  const q = (f: number) => (landMoist.length ? landMoist[clamp(Math.floor(f * landMoist.length), 0, landMoist.length - 1)] : 0);
  const desertBelow = s.deserts > 0 ? q(s.deserts * 0.3) : -Infinity;
  const forestAbove = s.forests > 0 ? q(1 - s.forests * 0.7) : Infinity;
  const swampAbove = q(0.93);

  // 3. Land elevation and terrain by height and moisture.
  for (let i = 0; i < n; i++) {
    const h = height[i];
    if (h < sea) {
      terrain[i] = Terrain.DeepWater;
      elevation[i] = 0;
      continue;
    }
    const t = clamp((h - sea) / Math.max(1e-6, top - sea), 0, 1);
    const coastFade = smoothstep(0.02, 0.18, t);
    const mh = mountainH[i] * coastFade;
    const e = clamp(Math.round(1 + Math.pow(t, 1.1) * 6 + mh), 1, MAX_ELEV);
    const m = moisture[i];
    let ter: number;
    if (e >= 11) ter = Terrain.Snow;
    else if (e >= 8) ter = Terrain.Mountain;
    else if (e >= 6 || (e >= 4 && mh > 1.5)) ter = Terrain.Hills;
    else if (m < desertBelow) ter = Terrain.Desert;
    else if (m > swampAbove && e <= 2) ter = Terrain.Swamp;
    else if (m > forestAbove) ter = Terrain.Forest;
    else ter = Terrain.Grassland;
    terrain[i] = ter;
    elevation[i] = e;
  }

  // 4. Water: the sea is the water joined to the map edge; other water is lakes.
  const isSea = new Uint8Array(n);
  {
    const queue: number[] = [];
    for (let k = 0; k < size; k++) {
      for (const i of [k, (size - 1) * size + k, k * size, k * size + size - 1]) {
        if (!isSea[i] && isWater(terrain[i])) {
          isSea[i] = 1;
          queue.push(i);
        }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy] of N4) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (!isSea[j] && isWater(terrain[j])) {
          isSea[j] = 1;
          queue.push(j);
        }
      }
    }
  }
  // Lakes: shallow water, one level below the lowest shore around them.
  {
    const seen = new Uint8Array(n);
    for (let start = 0; start < n; start++) {
      if (seen[start] || isSea[start] || !isWater(terrain[start])) continue;
      const comp: number[] = [start];
      seen[start] = 1;
      let shore = MAX_ELEV;
      for (let q = 0; q < comp.length; q++) {
        const i = comp[q];
        const x = i % size;
        const y = (i - x) / size;
        for (const [dx, dy] of N4) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const j = yy * size + xx;
          if (isWater(terrain[j])) {
            if (!seen[j]) {
              seen[j] = 1;
              comp.push(j);
            }
          } else shore = Math.min(shore, elevation[j]);
        }
      }
      const level = Math.max(0, shore - 1);
      for (const i of comp) {
        terrain[i] = Terrain.ShallowWater;
        elevation[i] = level;
      }
    }
  }

  // 5. Rivers. First every land tile gets a downhill direction toward water ("priority
  // flood": water spreads inland from the lowest ground up, so every tile has a way out,
  // over the lowest pass where it is boxed in). A river then starts on high ground and
  // follows those directions until it meets water or another river.
  const river = new Uint8Array(n);
  if (s.rivers > 0) {
    const down = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const heap = new MinHeap(n);
    for (let i = 0; i < n; i++) {
      if (isWater(terrain[i])) {
        done[i] = 1;
        heap.push(i, elevation[i] + rng() * 0.5);
      }
    }
    while (heap.size) {
      const key = heap.topKey();
      const i = heap.pop();
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy] of N4) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (done[j]) continue;
        done[j] = 1;
        down[j] = i;
        // The random part makes rivers wander instead of running in straight lines.
        heap.push(j, Math.max(elevation[j], key) + rng() * 0.9);
      }
    }

    const sources: number[] = [];
    const minGap = Math.max(10, size / 20);
    let placed = 0;
    for (let attempt = 0; attempt < s.rivers * 60 && placed < s.rivers; attempt++) {
      const sx = Math.floor(rng() * size);
      const sy = Math.floor(rng() * size);
      const si = sy * size + sx;
      if (isWater(terrain[si]) || river[si] || elevation[si] < 5) continue;
      if (sources.some((o) => Math.hypot((o % size) - sx, Math.floor(o / size) - sy) < minGap)) continue;
      const path: number[] = [];
      let cur = si;
      while (cur >= 0 && !isWater(terrain[cur]) && !river[cur] && path.length < size * 4) {
        path.push(cur);
        cur = down[cur];
      }
      if (path.length < 12) continue;
      sources.push(si);
      placed++;
      // The water level only ever goes down along the river, one level below its banks.
      let level = elevation[path[0]];
      const widenFrom = path.length > 60 ? Math.floor(path.length * 0.6) : Infinity;
      for (let k = 0; k < path.length; k++) {
        const i = path[k];
        level = Math.min(level, elevation[i]);
        const lvl = Math.max(0, level - 1);
        river[i] = 1;
        terrain[i] = Terrain.ShallowWater;
        elevation[i] = lvl;
        if (k >= widenFrom) {
          // Wider toward the mouth: also take the tile to the right of the direction of travel.
          const x = i % size;
          const y = (i - x) / size;
          const nxt = k + 1 < path.length ? path[k + 1] : cur;
          if (nxt < 0) continue;
          const fx = (nxt % size) - x;
          const fy = Math.floor(nxt / size) - y;
          const wx = x - fy;
          const wy = y + fx;
          if (wx >= 0 && wy >= 0 && wx < size && wy < size) {
            const j = wy * size + wx;
            if (!isWater(terrain[j])) {
              river[j] = 1;
              terrain[j] = Terrain.ShallowWater;
              elevation[j] = lvl;
            }
          }
        }
      }
    }
  }

  // 6. Coasts: shallow water near land, beaches on low shores beside the sea.
  {
    const dist = new Int16Array(n).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!isWater(terrain[i])) {
        dist[i] = 0;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (dist[i] >= 3) continue;
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy] of N4) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (dist[j] < 0) {
          dist[j] = dist[i] + 1;
          queue.push(j);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (terrain[i] === Terrain.DeepWater && isSea[i] && dist[i] > 0 && dist[i] <= 3) terrain[i] = Terrain.ShallowWater;
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const t = terrain[i];
        if (isWater(t) || t === Terrain.Swamp || elevation[i] > 2) continue;
        let bySea = false;
        for (let dy = -1; dy <= 1 && !bySea; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
            if (isSea[yy * size + xx] && !river[yy * size + xx]) {
              bySea = true;
              break;
            }
          }
        }
        if (bySea) terrain[i] = Terrain.Sand;
      }
    }
  }

  // Keep every tile's elevation inside its terrain's range.
  for (let i = 0; i < n; i++) {
    const d = terrainDef(terrain[i]);
    elevation[i] = clamp(elevation[i], d.minElev, d.maxElev);
  }

  // 7. Deposits, in small patches.
  const r = clamp(s.resources, 0, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = terrain[i];
      let d: number = Deposit.None;
      if (t === Terrain.Hills || t === Terrain.Mountain) {
        if (dN.noise(x / 7, y / 7) > 0.42 - 0.25 * r) d = Deposit.Stone;
        if (dN.noise(x / 6 + 100, y / 6) > 0.58 - 0.2 * r) d = Deposit.Iron;
        if (t === Terrain.Mountain && dN.noise(x / 5 + 200, y / 5 + 50) > 0.7 - 0.15 * r) d = Deposit.Gold;
      } else if (t === Terrain.Grassland || t === Terrain.Forest) {
        if (dN.noise(x / 6 + 300, y / 6 + 20) > 0.6 - 0.2 * r) d = Deposit.Berries;
        else if (dN.noise(x / 8, y / 8 + 400) > 0.72 - 0.2 * r) d = Deposit.Stone;
      } else if (t === Terrain.ShallowWater) {
        if (dN.noise(x / 6 + 500, y / 6 + 70) > 0.48 - 0.3 * r) d = Deposit.Fish;
      }
      if ((t === Terrain.Grassland || t === Terrain.Swamp || t === Terrain.Sand) && d === Deposit.None && nearRiver(river, size, x, y)) {
        if (dN.noise(x / 5 + 600, y / 5 + 90) > 0.3 - 0.25 * r) d = Deposit.Clay;
      }
      if (depositFits(d, t)) deposit[i] = d;
    }
  }

  return { terrain, elevation, deposit };
}

function nearRiver(river: Uint8Array, size: number, x: number, y: number) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      if (river[yy * size + xx]) return true;
    }
  }
  return false;
}

/** A binary min-heap of tile indexes by a number key. */
class MinHeap {
  private keys: Float64Array;
  private items: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
  }
  push(item: number, key: number) {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.items[i] = this.items[p];
      i = p;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }
  topKey() {
    return this.keys[0];
  }
  pop(): number {
    const top = this.items[0];
    const key = this.keys[--this.size];
    const item = this.items[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.items[i] = this.items[c];
      i = c;
    }
    this.keys[i] = key;
    this.items[i] = item;
    return top;
  }
}
