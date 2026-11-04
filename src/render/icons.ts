import { hash2 } from '../lib/rng';
import { Deposit } from '../map/terrain';
import { FACE_L, FACE_R, GROUND, NAVY } from './style';
import { biomeSparse, deposit as drawDeposit } from './symbols';

// Small pictures of single tiles for Map mode's tool buttons, drawn with the map's own
// line drawings so a button looks like what it paints.

const cache = new Map<string, string>();

// A tile position whose fixed random number is low, so the drawings that only appear on
// some tiles (grass tufts, waves) always appear on the button.
let probe = { x: 0, y: 0 };
for (let k = 0; k < 400; k++) {
  if (hash2(k, 7, 9) < 0.15) {
    probe = { x: k, y: 7 };
    break;
  }
}

export function tileIcon(terrain: number, dep: number = Deposit.None, px = 56): string {
  const key = `${terrain}:${dep}:${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dpr = 2;
  const c = document.createElement('canvas');
  c.width = px * dpr;
  c.height = px * dpr;
  const ctx = c.getContext('2d')!;
  // One tile 0.9 of the button wide, its top at about a third of the way down.
  const L = px * dpr * 0.9;
  ctx.setTransform(L, 0, 0, L, (px * dpr) / 2, px * dpr * 0.36);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lw = (1.9 * dpr) / L;
  ctx.lineWidth = lw;
  const d = 0.12;
  // Faces, top, outline.
  ctx.fillStyle = FACE_L[terrain];
  ctx.beginPath();
  ctx.moveTo(-0.5, 0.25);
  ctx.lineTo(0, 0.5);
  ctx.lineTo(0, 0.5 + d);
  ctx.lineTo(-0.5, 0.25 + d);
  ctx.fill();
  ctx.fillStyle = FACE_R[terrain];
  ctx.beginPath();
  ctx.moveTo(0, 0.5);
  ctx.lineTo(0.5, 0.25);
  ctx.lineTo(0.5, 0.25 + d);
  ctx.lineTo(0, 0.5 + d);
  ctx.fill();
  ctx.fillStyle = GROUND[terrain];
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.5, 0.25);
  ctx.lineTo(0, 0.5);
  ctx.lineTo(-0.5, 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = NAVY;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0.5, 0.25);
  ctx.lineTo(0.5, 0.25 + d);
  ctx.lineTo(0, 0.5 + d);
  ctx.lineTo(-0.5, 0.25 + d);
  ctx.lineTo(-0.5, 0.25);
  ctx.closePath();
  ctx.moveTo(-0.5, 0.25);
  ctx.lineTo(0, 0.5);
  ctx.lineTo(0.5, 0.25);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(0, 0.5 + d);
  ctx.stroke();
  if (dep === Deposit.None) biomeSparse(ctx, terrain, probe.x, probe.y, 3, 0, 0.3, 1.25, lw);
  else drawDeposit(ctx, dep, 0, 0.29, 1.6, lw);
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
