import { makeRng } from './rng';

// 2D gradient noise (Perlin's improved noise), seeded, plus fractal sums of it.
// Output of noise() is roughly in [-1, 1].

export interface Noise2 {
  noise(x: number, y: number): number;
  /** Fractal sum of `octaves` layers, each at twice the frequency and `gain` times the strength. Roughly [-1, 1]. */
  fbm(x: number, y: number, octaves: number, gain?: number): number;
  /** Ridged fractal: sharp crests along lines, for mountain ranges. Roughly [0, 1]. */
  ridged(x: number, y: number, octaves: number): number;
}

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function makeNoise(seed: number): Noise2 {
  const rng = makeRng(seed);
  const p = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (h: number, x: number, y: number) => {
    const g = GRAD[h & 7];
    return g[0] * x + g[1] * y;
  };

  function noise(x: number, y: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const u = fade(xf);
    const v = fade(yf);
    const x1 = dot(aa, xf, yf) + u * (dot(ba, xf - 1, yf) - dot(aa, xf, yf));
    const x2 = dot(ab, xf, yf - 1) + u * (dot(bb, xf - 1, yf - 1) - dot(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.1;
  }

  function fbm(x: number, y: number, octaves: number, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq + o * 17.3, y * freq - o * 9.1);
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  }

  function ridged(x: number, y: number, octaves: number) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(noise(x * freq + o * 31.7, y * freq + o * 4.3));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  return { noise, fbm, ridged };
}
