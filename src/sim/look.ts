// Appearance of people: skin tone, hair color and clothing color, packed into one number.
// People get natural colors inside a navy outline (Caleb: "humans will have skin colors and
// colored clothing").

export const SKINS = ['#f6d5bb', '#efc3a0', '#e0aa82', '#c98f66', '#ad7650', '#8f5d3e', '#6f452d', '#523222'];
export const HAIRS = ['#2b1d14', '#4a3020', '#6b4423', '#9b6a3a', '#d2ae68', '#8e8a85'];
/** Dyed and undyed wool and linen: madder red, woad blue, green, undyed tan, purple, saffron, brown, grey, dark teal, rust. */
export const CLOTHES = ['#963d30', '#3f5f88', '#5b7f3a', '#b08c55', '#6b4c7a', '#c9a227', '#7a5232', '#9aa1a8', '#2f5653', '#b5654a'];

export function packLook(skin: number, hair: number, clothes: number) {
  return (skin & 7) | ((hair & 7) << 3) | ((clothes & 15) << 6);
}

export function unpackLook(look: number) {
  return { skin: look & 7, hair: (look >> 3) & 7, clothes: (look >> 6) & 15 };
}

export function randomLook(rand: () => number) {
  return packLook(Math.floor(rand() * SKINS.length), Math.floor(rand() * HAIRS.length), Math.floor(rand() * CLOTHES.length));
}
