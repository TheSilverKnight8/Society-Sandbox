import { CLOTHES, HAIRS, SKINS, unpackLook } from '../sim/look';
import type { SimClient } from '../sim/client';
import { Pose } from '../sim/types';
import { isoX, isoY } from './iso';
import type { IsoView } from './IsoView';
import { NAVY } from './style';

// Draws people as small stick figures in Stickman Arena's style: a round head, a tunic
// (a long dress for women), arms and legs, in skin and clothing colors inside a navy
// outline. Each look, pose and size is drawn once into a small picture and reused.
// Zoomed far out, a person is a dot in their clothing color.

/** A person's height, in tile widths. */
const HEIGHT = 0.42;
/** Below this height on screen (device pixels), people are dots. */
const MIN_FIGURE_PX = 10;
const LEGS = '#5a4232';

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the feet are in the picture. */
  ax: number;
  ay: number;
}

const sprites = new Map<string, Sprite>();

function sprite(look: number, male: boolean, pose: number, frame: number, px: number): Sprite {
  const key = `${look}|${male ? 1 : 0}|${pose}|${frame}|${px}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  if (sprites.size > 4000) sprites.clear();
  const s = pose === Pose.Sleep ? drawSleeping(look, male, px) : drawStanding(look, male, pose, frame, px);
  sprites.set(key, s);
  return s;
}

/** A colored line with a navy outline, like a stick figure's limb. */
function limbOf(ctx: CanvasRenderingContext2D, H: number, lw: number) {
  return (pts: [number, number][], color: string, width: number) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * H, pts[0][1] * H);
    for (const p of pts.slice(1)) ctx.lineTo(p[0] * H, p[1] * H);
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = width + lw * 1.6;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
}

/** Lying on the ground asleep, head to the left, with a small "z". */
function drawSleeping(look: number, male: boolean, px: number): Sprite {
  const H = px;
  const lw = Math.max(1.2, H * 0.08);
  const w = Math.ceil(H * 1.0 + lw * 2);
  const h = Math.ceil(H * 0.62 + lw * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const ax = w / 2;
  const ay = h - lw - 1;
  ctx.translate(ax, ay);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const { skin, hair, clothes } = unpackLook(look);
  const limb = limbOf(ctx, H, lw);
  const limbW = Math.max(1.3, H * 0.08);
  // Legs.
  limb(
    [
      [0.08, -0.07],
      [0.4, -0.05],
    ],
    LEGS,
    limbW,
  );
  // Body (tunic or dress) lying flat.
  ctx.beginPath();
  ctx.moveTo(-0.2 * H, -0.15 * H);
  ctx.lineTo((male ? 0.1 : 0.3) * H, -0.13 * H);
  ctx.lineTo((male ? 0.1 : 0.3) * H, -0.01 * H);
  ctx.lineTo(-0.2 * H, -0.02 * H);
  ctx.closePath();
  ctx.fillStyle = CLOTHES[clothes];
  ctx.fill();
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = lw;
  ctx.stroke();
  // Head with hair.
  ctx.beginPath();
  ctx.arc(-0.32 * H, -0.1 * H, 0.12 * H, 0, Math.PI * 2);
  ctx.fillStyle = SKINS[skin];
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = HAIRS[hair];
  ctx.fillRect(-0.46 * H, -0.24 * H, 0.1 * H, 0.3 * H);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(-0.32 * H, -0.1 * H, 0.12 * H, 0, Math.PI * 2);
  ctx.strokeStyle = NAVY;
  ctx.stroke();
  // A "z" above the head.
  if (H >= 18) {
    ctx.beginPath();
    const zx = -0.18 * H;
    const zy = -0.48 * H;
    const zs = 0.1 * H;
    ctx.moveTo(zx, zy);
    ctx.lineTo(zx + zs, zy);
    ctx.lineTo(zx, zy + zs);
    ctx.lineTo(zx + zs, zy + zs);
    ctx.lineWidth = Math.max(1, lw * 0.8);
    ctx.strokeStyle = NAVY;
    ctx.stroke();
  }
  return { canvas, ax, ay };
}

function drawStanding(look: number, male: boolean, pose: number, frame: number, px: number): Sprite {
  const H = px;
  const lw = Math.max(1.2, H * 0.08);
  const w = Math.ceil(H * 0.7 + lw * 2);
  const h = Math.ceil(H * 1.06 + lw * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const ax = w / 2;
  const ay = h - lw - 1;
  ctx.translate(ax, ay);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const { skin, hair, clothes } = unpackLook(look);
  const skinC = SKINS[skin];
  const hairC = HAIRS[hair];
  const clothC = CLOTHES[clothes];
  const work = pose === Pose.Work;
  const swing = work ? 0 : frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const limb = limbOf(ctx, H, lw);
  const limbW = Math.max(1.3, H * 0.08);

  // Long hair falls behind the head and shoulders.
  if (!male) {
    ctx.beginPath();
    ctx.ellipse(0, -0.76 * H, 0.15 * H, 0.15 * H, 0, 0, Math.PI * 2);
    ctx.fillStyle = hairC;
    ctx.fill();
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  // Legs.
  const hem = male ? -0.3 : -0.07;
  limb(
    [
      [-0.05, hem],
      [-0.06 + swing * 0.07, 0],
    ],
    LEGS,
    limbW,
  );
  limb(
    [
      [0.05, hem],
      [0.06 - swing * 0.07, 0],
    ],
    LEGS,
    limbW,
  );
  // Arms: swinging when walking; reaching down and forward in turn when gathering or eating.
  const reach = work ? (frame % 2 === 0 ? 1 : -1) : 0;
  limb(
    [
      [-0.09, -0.62],
      work ? [-0.13, reach > 0 ? -0.34 : -0.48] : [-0.15 - swing * 0.04, -0.4],
    ],
    skinC,
    limbW,
  );
  limb(
    [
      [0.09, -0.62],
      work ? [0.13, reach > 0 ? -0.48 : -0.34] : [0.15 + swing * 0.04, -0.4],
    ],
    skinC,
    limbW,
  );
  // Tunic, or a long dress.
  ctx.beginPath();
  ctx.moveTo(-0.1 * H, -0.68 * H);
  ctx.lineTo(0.1 * H, -0.68 * H);
  ctx.lineTo((male ? 0.14 : 0.16) * H, hem * H);
  ctx.lineTo(-(male ? 0.14 : 0.16) * H, hem * H);
  ctx.closePath();
  ctx.fillStyle = clothC;
  ctx.fill();
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = lw;
  ctx.stroke();
  // Head, then hair on top.
  ctx.beginPath();
  ctx.arc(0, -0.84 * H, 0.13 * H, 0, Math.PI * 2);
  ctx.fillStyle = skinC;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = hairC;
  ctx.fillRect(-0.2 * H, -1.0 * H, 0.4 * H, (male ? 0.11 : 0.12) * H);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, -0.84 * H, 0.13 * H, 0, Math.PI * 2);
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = lw;
  ctx.stroke();
  return { canvas, ax, ay };
}

/** Positions of people this frame, kept between frames to avoid making garbage. */
let buf = new Float32Array(0);
let order = new Int32Array(0);

/** Draws everyone on screen, back to front. */
export function drawPeople(ctx: CanvasRenderingContext2D, view: IsoView, client: SimClient, now: number, selected: ReadonlySet<number>) {
  const n = client.population;
  if (!n) return;
  if (buf.length < n * 6) {
    buf = new Float32Array(n * 6 + 600);
    order = new Int32Array(n + 100);
  }
  const { size, elevation } = view.src;
  const z = view.cam.zoom;
  const W = view.width;
  const Hs = view.height;
  let count = 0;
  client.forEach(now, (_k, id, x, y, look, flags) => {
    const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
    const h = elevation[ty * size + tx];
    // A point inside a tile, at that tile's height.
    const X = isoX(x, y);
    const Y = isoY(x, y, h);
    const [sx, sy] = view.toScreen(X, Y);
    if (sx < -40 || sy < -60 || sx > W + 40 || sy > Hs + 40) return;
    const o = count * 6;
    buf[o] = sx;
    buf[o + 1] = sy;
    buf[o + 2] = x + y;
    buf[o + 3] = look;
    buf[o + 4] = flags;
    buf[o + 5] = id;
    order[count] = count;
    count++;
  });
  const idx = Array.from(order.subarray(0, count)).sort((a, b) => buf[a * 6 + 2] - buf[b * 6 + 2]);

  const dpr = view.dpr;
  const figurePx = Math.round(HEIGHT * z * dpr);
  const t = Math.floor(now / 140);
  for (const k of idx) {
    const o = k * 6;
    const sx = buf[o];
    const sy = buf[o + 1];
    const look = buf[o + 3];
    const flags = buf[o + 4];
    const id = buf[o + 5];
    if (selected.has(id)) drawSelection(ctx, sx, sy, z);
    if (figurePx < MIN_FIGURE_PX) {
      const r = Math.max(1.6, 0.06 * z);
      ctx.beginPath();
      ctx.arc(sx, sy - r, r, 0, Math.PI * 2);
      ctx.fillStyle = CLOTHES[unpackLook(look).clothes];
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, r * 0.45);
      ctx.strokeStyle = NAVY;
      ctx.stroke();
      continue;
    }
    const pose = (flags >> 3) & 3;
    const frame = flags & 1 ? (t + id) % 4 : pose === Pose.Work ? Math.floor((t + id) / 2) % 2 : 0;
    const sp = sprite(look, (flags & 4) !== 0, pose, frame, Math.min(figurePx, 90));
    const scale = figurePx > 90 ? figurePx / 90 : 1;
    ctx.drawImage(sp.canvas, sx - (sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, (sp.canvas.width * scale) / dpr, (sp.canvas.height * scale) / dpr);
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number) {
  const r = Math.max(5, z * 0.22);
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fc3f3f';
  ctx.stroke();
}

/** The person drawn at a screen point (frontmost first), or null. */
export function pickPerson(view: IsoView, client: SimClient, sx: number, sy: number, now: number): number | null {
  const { size, elevation } = view.src;
  const z = view.cam.zoom;
  const H = Math.max(10, HEIGHT * z);
  let best: number | null = null;
  let bestDepth = -Infinity;
  let nearest: number | null = null;
  let nearestD = 14;
  client.forEach(now, (_k, id, x, y) => {
    const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
    const [px, py] = view.toScreen(isoX(x, y), isoY(x, y, elevation[ty * size + tx]));
    if (Math.abs(sx - px) <= H * 0.22 && sy <= py + 2 && sy >= py - H) {
      if (x + y > bestDepth) {
        bestDepth = x + y;
        best = id;
      }
    }
    const d = Math.hypot(sx - px, sy - (py - H * 0.4));
    if (d < nearestD) {
      nearestD = d;
      nearest = id;
    }
  });
  return best ?? nearest;
}

