// The map's colors: only the app's three (cream, navy and red, as in Stickman Arena),
// plus blends of them. Biomes are told apart by the line drawings on the tiles, not by color.

export const CREAM = '#faeeda';
export const NAVY = '#002657';
export const RED = '#fc3f3f';
/** Behind the map, as behind Stickman Arena's stages. */
export const BACKDROP = '#f6e7cf';

const C = [250, 238, 218];
const N = [0, 38, 87];

/** Cream blended toward navy by k (0 = cream, 1 = navy). */
export function tint(k: number) {
  const f = (i: number) => Math.round(C[i] + (N[i] - C[i]) * k);
  return `rgb(${f(0)},${f(1)},${f(2)})`;
}

export const LAND = CREAM;
export const LAND_FACE_L = tint(0.2);
export const LAND_FACE_R = tint(0.36);
export const DEEP = NAVY;
export const SHALLOW = tint(0.72);
export const WATER_FACE_L = tint(0.86);
export const WATER_FACE_R = tint(0.94);
/** Shading on the dark side of mountains and hills. */
export const SHADE = tint(0.24);
