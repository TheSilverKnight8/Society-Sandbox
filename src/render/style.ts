import { TERRAINS, Terrain } from '../map/terrain';

// The map's colors.
//
// Caleb's direction after Stage 3c: each biome has its natural color (green grassland, darker
// green forest, sandy beaches, grey rock, white snow, blue water), drawn in the same flat,
// navy-outlined style as the trees, people and buildings: flat fills, a lighter and a darker
// side, and navy outlines on everything. The app's own cream, navy and red stay for the
// interface, the map's outlines and its edge.

export const CREAM = '#faeeda';
export const NAVY = '#002657';
export const RED = '#fc3f3f';
/** Behind the map, as behind Stickman Arena's stages. */
export const BACKDROP = '#f6e7cf';

type Rgb = readonly [number, number, number];
const C: Rgb = [250, 238, 218];
const N: Rgb = [0, 38, 87];

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const css = (c: Rgb) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const hex = (h: string): Rgb => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
/** A color made darker (k < 1) or lighter (k > 1), as the buildings' walls are shaded. */
export function shadeRgb(c: Rgb, k: number): Rgb {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}
export function shadeHex(h: string, k: number) {
  return css(shadeRgb(hex(h), k));
}

/** Cream blended toward navy by k (0 = cream, 1 = navy). */
export function tint(k: number) {
  return css(mix(C, N, k));
}

/** Each biome's natural ground color. */
export const BIOME: Record<number, string> = {
  [Terrain.DeepWater]: '#3b76ae',
  [Terrain.ShallowWater]: '#63a9d5',
  [Terrain.Sand]: '#eedb9f',
  [Terrain.Grassland]: '#9fc866',
  [Terrain.Forest]: '#79aa55',
  [Terrain.Hills]: '#b2b66d',
  [Terrain.Mountain]: '#a39a8c',
  [Terrain.Snow]: '#f2f5f7',
  [Terrain.Desert]: '#e8c47f',
  [Terrain.Swamp]: '#7f9867',
};

/** Each terrain's ground color, as RGB. */
export const GROUND_RGB: Rgb[] = TERRAINS.map((t) => hex(BIOME[t.id] ?? '#9fc866'));

export const GROUND = GROUND_RGB.map(css);
/** Cliff sides below each terrain: its ground darkened, the left side less than the right (light from the left, as on buildings). */
export const FACE_L = GROUND_RGB.map((g) => css(shadeRgb(g, 0.8)));
export const FACE_R = GROUND_RGB.map((g) => css(shadeRgb(g, 0.64)));

/** Colors of the drawings on the land. */
export const LAND = {
  hill: shadeHex(BIOME[Terrain.Hills], 1.06),
  hillShade: shadeHex(BIOME[Terrain.Hills], 0.82),
  rock: '#cbc4b8',
  rockShade: '#857d71',
  snow: '#fbfcfd',
  snowShade: '#d6e0e8',
  reed: '#58803c',
  cattail: '#7a4b2a',
  sandMark: shadeHex(BIOME[Terrain.Sand], 0.78),
  duneMark: shadeHex(BIOME[Terrain.Desert], 0.74),
  foam: '#ffffff',
  paving: '#d4c7ac',
  bridge: '#a7774a',
  bridgeLine: '#7d5533',
  pavingJoint: '#ad9f84',
};

/** Natural colors for objects. */
export const OBJ = {
  trunk: '#8b5a2b',
  leaf: '#6aab4f',
  pine: '#3f8d4e',
  bush: '#5f9f47',
  berry: '#e0313f',
  stone: '#b8b2a7',
  oreRock: '#9a948b',
  iron: '#b5552f',
  gold: '#f2c230',
  clay: '#c9845a',
  fish: '#b9cddc',
};
