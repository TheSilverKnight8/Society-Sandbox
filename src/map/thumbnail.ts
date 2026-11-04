import { TERRAINS } from './terrain';
import type { Tiles } from './generate';

const TOPS = TERRAINS.map((t) => {
  const v = parseInt(t.top.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
});

/**
 * A small picture of a map for Home: each tile's color, lit from the top left so
 * elevation shows, turned into the same diamond the map view uses.
 */
export function makeThumbnail(tiles: Tiles, size: number, width = 480): string {
  const flat = document.createElement('canvas');
  flat.width = size;
  flat.height = size;
  const fctx = flat.getContext('2d')!;
  const img = fctx.createImageData(size, size);
  const { terrain, elevation } = tiles;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const c = TOPS[terrain[i]] ?? TOPS[0];
      const back = x > 0 && y > 0 ? elevation[i - size - 1] : elevation[i];
      const k = 1 + Math.max(-0.25, Math.min(0.25, (elevation[i] - back) * 0.08));
      const o = i * 4;
      img.data[o] = Math.min(255, c[0] * k);
      img.data[o + 1] = Math.min(255, c[1] * k);
      img.data[o + 2] = Math.min(255, c[2] * k);
      img.data[o + 3] = 255;
    }
  }
  fctx.putImageData(img, 0, 0);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = Math.round(width / 2);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Tile (x, y) goes to ((x - y) / 2, (x + y) / 4) in tile widths: rotate 45 degrees, then halve the height.
  const s = width / size;
  ctx.setTransform(s * 0.5, s * 0.25, -s * 0.5, s * 0.25, width / 2, 0);
  ctx.drawImage(flat, 0, 0);
  return out.toDataURL('image/png');
}
