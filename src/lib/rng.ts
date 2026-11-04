/** A small seeded random number generator (mulberry32). Same seed, same numbers. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof makeRng>;

/** A fixed pseudo-random number in [0, 1) for a pair of integers, e.g. a tile's position. */
export function hash2(x: number, y: number, salt = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A random seed for a new map. */
export function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000);
}
