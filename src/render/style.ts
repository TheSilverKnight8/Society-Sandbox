import { TERRAINS, Terrain } from '../map/terrain';

// The map's colors.
//
// The environment uses only the app's three colors (cream, navy and red, as in Stickman
// Arena) and blends of them: each biome's ground is its own shade of the cream, water is
// navy, and cliff sides and shadows are cream blended toward navy. Objects the simulation
// will act on (trees, deposits, and later people and buildings) get their own natural
// colors. Everything is outlined in navy.

export const CREAM = '#faeeda';
export const NAVY = '#002657';
export const RED = '#fc3f3f';
/** Behind the map, as behind Stickman Arena's stages. */
export const BACKDROP = '#f6e7cf';

type Rgb = readonly [number, number, number];
const C: Rgb = [250, 238, 218];
const N: Rgb = [0, 38, 87];
const R: Rgb = [252, 63, 63];
const W: Rgb = [255, 255, 255];

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const css = (c: Rgb) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/** Cream blended toward navy by k (0 = cream, 1 = navy). */
export function tint(k: number) {
  return css(mix(C, N, k));
}

/** Each terrain's ground color, as RGB: shades of the cream, navy for water. */
export const GROUND_RGB: Rgb[] = TERRAINS.map((t) => {
  switch (t.id) {
    case Terrain.DeepWater:
      return N;
    case Terrain.ShallowWater:
      return mix(C, N, 0.72);
    case Terrain.Sand:
      return mix(C, W, 0.45);
    case Terrain.Grassland:
      return C;
    case Terrain.Forest:
      return mix(C, N, 0.09);
    case Terrain.Hills:
      return mix(mix(C, R, 0.04), N, 0.045);
    case Terrain.Mountain:
      return mix(C, N, 0.17);
    case Terrain.Snow:
      return mix(C, W, 0.8);
    case Terrain.Desert:
      return mix(C, R, 0.12);
    case Terrain.Swamp:
      return mix(mix(C, N, 0.12), R, 0.03);
    default:
      return C;
  }
});

export const GROUND = GROUND_RGB.map(css);
/** Cliff sides below each terrain: its ground shaded toward navy (left side lighter than right). */
export const FACE_L = GROUND_RGB.map((g, i) => css(mix(g, N, TERRAINS[i].water ? 0.5 : 0.2)));
export const FACE_R = GROUND_RGB.map((g, i) => css(mix(g, N, TERRAINS[i].water ? 0.75 : 0.36)));
/** Shading on the dark side of mountains and hills. */
export const SHADE = tint(0.24);

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
