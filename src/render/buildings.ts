import { BUILDINGS, BuildingKind } from '../sim/buildings';
import type { BuildingView } from '../sim/types';
import { NAVY } from './style';

// Buildings, drawn as objects (Caleb: objects get the colors of what they are; everything
// keeps a navy outline): wattle huts with thatch, timber-framed houses, a plank
// storehouse, and the campfire at a settlement's middle. A building being put up shows
// its posts and its walls rising, with a pile of the wood and stone brought so far.
// Each kind, stage of building and size is drawn once into a small picture and reused.

const C = {
  wattle: '#b58b5a',
  thatch: '#d6b25a',
  thatchDark: '#b8913f',
  plaster: '#efe3c8',
  timber: '#7a5232',
  plank: '#9c6b3c',
  shingle: '#6e4a2a',
  door: '#4a3424',
  stone: '#b8b2a7',
  log: '#8b5a2b',
  flame: '#f08a24',
  flameHot: '#ffd23f',
};

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the tile's middle is in the picture. */
  ax: number;
  ay: number;
}

const cache = new Map<string, Sprite>();

/** Sizes in tile widths; a tile's diamond is 1 wide and 0.5 tall. */
interface Shape {
  /** Half the width of the walls' footprint along each axis (as a share of the tile). */
  hw: number;
  wall: number;
  roof: number;
  gable: boolean;
  wallColor: string;
  roofColor: string;
  roofShade: string;
}

const SHAPES: Partial<Record<BuildingKind, Shape>> = {
  [BuildingKind.Hut]: { hw: 0.28, wall: 0.13, roof: 0.3, gable: false, wallColor: C.wattle, roofColor: C.thatch, roofShade: C.thatchDark },
  [BuildingKind.House]: { hw: 0.36, wall: 0.2, roof: 0.22, gable: true, wallColor: C.plaster, roofColor: C.thatch, roofShade: C.thatchDark },
  [BuildingKind.Storehouse]: { hw: 0.4, wall: 0.24, roof: 0.2, gable: true, wallColor: C.plank, roofColor: C.shingle, roofShade: '#553820' },
};

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

function shade(hex: string, k: number) {
  const v = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, c * k)));
  return `rgb(${f((v >> 16) & 255)},${f((v >> 8) & 255)},${f(v & 255)})`;
}

/** Draws a house-like building in tile units, with its footprint's middle at (0, 0). `rise` 0..1 is how far the walls are up. */
function drawShape(ctx: CanvasRenderingContext2D, sh: Shape, kind: BuildingKind, rise: number, roofUp: number) {
  const a = sh.hw; // along x: screen (a/2, a/4)
  const L: [number, number] = [-a, 0]; // left corner of the footprint
  const B: [number, number] = [0, a / 2]; // bottom corner
  const R: [number, number] = [a, 0];
  const T: [number, number] = [0, -a / 2];
  const h = sh.wall * rise;
  const up = (p: [number, number], d: number): [number, number] => [p[0], p[1] - d];
  // Walls: left face (L-B) and right face (B-R).
  poly(ctx, [L, B, up(B, h), up(L, h)], shade(sh.wallColor, 0.92));
  poly(ctx, [B, R, up(R, h), up(B, h)], shade(sh.wallColor, 0.78));
  if (rise >= 1 && kind === BuildingKind.House) {
    // Timber framing on the plaster.
    ctx.beginPath();
    for (const k of [0.33, 0.66]) {
      const p = [L[0] + (B[0] - L[0]) * k, L[1] + (B[1] - L[1]) * k];
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[0], p[1] - h);
    }
    ctx.moveTo(L[0], L[1] - h * 0.5);
    ctx.lineTo(B[0], B[1] - h * 0.5);
    ctx.strokeStyle = C.timber;
    ctx.stroke();
    ctx.strokeStyle = NAVY;
  }
  if (rise >= 1) {
    // A door on the left face.
    const k = 0.55;
    const dx = L[0] + (B[0] - L[0]) * k;
    const dy = L[1] + (B[1] - L[1]) * k;
    const dw = a * (kind === BuildingKind.Storehouse ? 0.32 : 0.2);
    const dh = h * (kind === BuildingKind.Storehouse ? 0.75 : 0.7);
    poly(
      ctx,
      [
        [dx - dw / 2, dy - dw / 4],
        [dx + dw / 2, dy + dw / 4],
        [dx + dw / 2, dy + dw / 4 - dh],
        [dx - dw / 2, dy - dw / 4 - dh],
      ],
      C.door,
    );
  }
  if (roofUp <= 0) {
    // Not roofed yet: the top of the walls.
    poly(ctx, [up(L, h), up(B, h), up(R, h), up(T, h)], shade(sh.wallColor, 1.05));
    return;
  }
  const over = 0.06; // eaves
  const hL: [number, number] = [L[0] - over, L[1] - h + over * 0.25];
  const hB: [number, number] = [B[0], B[1] - h + over * 0.5];
  const hR: [number, number] = [R[0] + over, R[1] - h + over * 0.25];
  const hT: [number, number] = [T[0], T[1] - h];
  const rh = sh.roof * roofUp;
  if (!sh.gable) {
    // A pointed thatch roof.
    const apex: [number, number] = [0, -h - rh];
    poly(ctx, [hL, hB, apex], sh.roofColor);
    poly(ctx, [hB, hR, apex], sh.roofShade);
    return;
  }
  // A gable roof with its ridge running left to right (from the left corner's side to the right corner's side).
  const ridgeL: [number, number] = [(hL[0] + hT[0]) / 2 - 0.02, (hL[1] + hB[1]) / 2 - rh];
  const ridgeR: [number, number] = [(hR[0] + hB[0]) / 2 + 0.02, (hR[1] + hT[1]) / 2 - rh];
  // Gable end facing right (triangle on the right face) and the front slope.
  poly(ctx, [hB, hR, ridgeR], shade(sh.wallColor, 0.78));
  poly(ctx, [hL, hB, ridgeR, ridgeL], sh.roofColor);
  // Ridge line.
  ctx.beginPath();
  ctx.moveTo(ridgeL[0], ridgeL[1]);
  ctx.lineTo(ridgeR[0], ridgeR[1]);
  ctx.stroke();
}

function drawCampfire(ctx: CanvasRenderingContext2D, frame: number) {
  // Stones in a ring.
  for (let k = 0; k < 7; k++) {
    const ang = (k / 7) * Math.PI * 2;
    const x = Math.cos(ang) * 0.13;
    const y = Math.sin(ang) * 0.065;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.035, 0.022, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.stone;
    ctx.fill();
    ctx.stroke();
  }
  // Crossed logs.
  const w0 = ctx.lineWidth;
  for (const [x0, y0, x1, y1] of [
    [-0.09, 0.03, 0.08, -0.03],
    [-0.07, -0.03, 0.09, 0.025],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = w0 * 3.2;
    ctx.strokeStyle = NAVY;
    ctx.stroke();
    ctx.lineWidth = w0 * 1.8;
    ctx.strokeStyle = C.log;
    ctx.stroke();
  }
  ctx.lineWidth = w0;
  ctx.strokeStyle = NAVY;
  // Flame.
  const tip = frame ? -0.24 : -0.21;
  const lean = frame ? 0.015 : -0.015;
  ctx.beginPath();
  ctx.moveTo(-0.06, -0.01);
  ctx.quadraticCurveTo(-0.07, -0.1, lean, tip);
  ctx.quadraticCurveTo(0.07, -0.1, 0.06, -0.01);
  ctx.closePath();
  ctx.fillStyle = C.flame;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.03, -0.015);
  ctx.quadraticCurveTo(-0.035, -0.07, lean * 0.6, tip + 0.07);
  ctx.quadraticCurveTo(0.035, -0.07, 0.03, -0.015);
  ctx.closePath();
  ctx.fillStyle = C.flameHot;
  ctx.fill();
}

/** Piles of wood and stone beside a building site. */
function drawPiles(ctx: CanvasRenderingContext2D, sh: Shape) {
  const x = sh.hw + 0.02;
  const w0 = ctx.lineWidth;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(x - 0.08, 0.1 - k * 0.025);
    ctx.lineTo(x + 0.04, 0.16 - k * 0.025);
    ctx.lineWidth = w0 * 2.6;
    ctx.strokeStyle = NAVY;
    ctx.stroke();
    ctx.lineWidth = w0 * 1.4;
    ctx.strokeStyle = C.log;
    ctx.stroke();
  }
  ctx.lineWidth = w0;
  ctx.strokeStyle = NAVY;
}

function sprite(kind: BuildingKind, step: number, frame: number, px: number): Sprite {
  const key = `${kind}|${step}|${frame}|${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 600) cache.clear();
  // px is the tile width in device pixels.
  const w = Math.ceil(px * 1.1);
  const h = Math.ceil(px * 1.1);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const ax = w / 2;
  const ay = h * 0.72;
  ctx.setTransform(px, 0, 0, px, ax, ay);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, px * 0.035) / px;
  ctx.strokeStyle = NAVY;
  if (kind === BuildingKind.Campfire) drawCampfire(ctx, frame);
  else {
    const sh = SHAPES[kind]!;
    const progress = step / 10;
    if (progress >= 1) drawShape(ctx, sh, kind, 1, 1);
    else {
      // Being built: posts at the corners, walls rising, then the roof.
      const rise = Math.min(1, progress / 0.7);
      const roofUp = progress < 0.7 ? 0 : (progress - 0.7) / 0.3;
      drawPiles(ctx, sh);
      if (rise > 0.05) drawShape(ctx, sh, kind, rise, roofUp);
      const a = sh.hw;
      const w0 = ctx.lineWidth;
      for (const [x, y] of [
        [-a, 0],
        [0, a / 2],
        [a, 0],
        [0, -a / 2],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - sh.wall * 1.1);
        ctx.lineWidth = w0 * 2.4;
        ctx.strokeStyle = NAVY;
        ctx.stroke();
        ctx.lineWidth = w0 * 1.2;
        ctx.strokeStyle = C.log;
        ctx.stroke();
      }
      ctx.lineWidth = w0;
      ctx.strokeStyle = NAVY;
    }
  }
  const s = { canvas, ax, ay };
  cache.set(key, s);
  return s;
}

/** Draws one building with its tile's middle at screen point (sx, sy); z is screen pixels per tile width. */
export function drawBuilding(ctx: CanvasRenderingContext2D, b: BuildingView, sx: number, sy: number, z: number, dpr: number, now: number) {
  const px = Math.max(8, Math.min(220, Math.round(z * dpr)));
  const step = b.progress >= 1 ? 10 : Math.min(9, Math.floor(b.progress * 10));
  const frame = b.kind === BuildingKind.Campfire ? Math.floor(now / 260 + b.id) % 2 : 0;
  const sp = sprite(b.kind, step, frame, px);
  const scale = (z * dpr) / px;
  ctx.drawImage(sp.canvas, sx - (sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, (sp.canvas.width * scale) / dpr, (sp.canvas.height * scale) / dpr);
}

export function buildingName(kind: BuildingKind) {
  return BUILDINGS[kind].name;
}
