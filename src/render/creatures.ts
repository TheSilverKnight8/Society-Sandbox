import { NAVY } from './style';

// Animals, drawn like the people: flat shapes in natural colors inside a navy outline, each
// kind, frame and size drawn once into a small picture and reused (Stage 6). Kinds follow
// CREATURE_KINDS in sim/types.ts: deer, boar, wolf, bear, cattle, sheep, dragon.

export interface CreatureSprite {
  canvas: HTMLCanvasElement;
  /** Where its feet (or, for a flying dragon, its shadow) are in the picture. */
  ax: number;
  ay: number;
}

/** Size of each kind against a person's height (body length), and how high it stands. */
const SIZE = [0.85, 0.75, 0.75, 1.0, 0.95, 0.65, 3.2];
const COLORS: { body: string; belly?: string; dark: string }[] = [
  { body: '#a8743f', belly: '#e1c49a', dark: '#6b4524' }, // deer
  { body: '#5b4a3e', dark: '#3a2e26' }, // boar
  { body: '#8a8f96', belly: '#c9ccd0', dark: '#5c6168' }, // wolf
  { body: '#5a3d29', dark: '#3b281b' }, // bear
  { body: '#3f2e24', dark: '#291d16' }, // aurochs (wild cattle)
  { body: '#b89a6e', dark: '#5b4632' }, // wild sheep
  { body: '#4c6b3a', belly: '#c9b46a', dark: '#2f4524' }, // dragon
];
/** Tame cattle and sheep look different from wild ones. */
const TAME: Partial<Record<number, { body: string; belly?: string; dark: string }>> = {
  4: { body: '#b08a5a', belly: '#f2ece0', dark: '#6d5233' },
  5: { body: '#ece6d6', dark: '#4a3d30' },
};

const cache = new Map<string, CreatureSprite>();

/** The picture of an animal: kind, walking frame (0 to 3), height of a grown person on screen (device pixels), young, tame. */
export function creatureSprite(kind: number, frame: number, personPx: number, young: boolean, tame: boolean): CreatureSprite {
  const px = Math.max(4, Math.round(personPx * SIZE[kind] * (young ? 0.6 : 1)));
  const key = `${kind}|${frame}|${px}|${young ? 1 : 0}|${tame ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 1500) cache.clear();
  const s = kind === 6 ? drawDragon(frame, px) : drawBeast(kind, frame, px, young, tame);
  cache.set(key, s);
  return s;
}

/** A four-legged animal side on, facing right. `L` is its body length in pixels. */
function drawBeast(kind: number, frame: number, L: number, young: boolean, tame: boolean): CreatureSprite {
  const c = (tame && TAME[kind]) || COLORS[kind];
  const lw = Math.max(1, L * 0.06);
  const w = Math.ceil(L * 1.5 + lw * 4);
  const h = Math.ceil(L * 1.2 + lw * 4);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const ax = w / 2;
  const ay = h - lw * 2;
  ctx.translate(ax, ay);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = lw;
  const bear = kind === 3;
  const sheep = kind === 5;
  const boar = kind === 1;
  // Proportions: leg length, body height and length.
  const legH = L * (kind === 0 ? 0.42 : bear || boar ? 0.22 : sheep ? 0.25 : 0.32);
  const bodyH = L * (bear ? 0.42 : sheep ? 0.38 : boar ? 0.36 : 0.3);
  const bodyL = L * 0.62;
  const by = -legH - bodyH / 2;
  // Legs, swinging as it walks.
  const swing = [0, 1, 0, -1][frame] * L * 0.07;
  const legs: [number, number][] = [
    [-bodyL * 0.36, swing],
    [-bodyL * 0.22, -swing],
    [bodyL * 0.24, -swing],
    [bodyL * 0.38, swing],
  ];
  const legW = Math.max(1.2, L * (bear ? 0.11 : 0.07));
  for (const [x, d] of legs) {
    ctx.beginPath();
    ctx.moveTo(x, by + bodyH * 0.2);
    ctx.lineTo(x + d, -lw * 0.5);
    ctx.lineWidth = legW + lw * 1.6;
    ctx.strokeStyle = NAVY;
    ctx.stroke();
    ctx.lineWidth = legW;
    ctx.strokeStyle = c.dark;
    ctx.stroke();
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = NAVY;
  // Tail.
  ctx.beginPath();
  if (kind === 2) {
    // A wolf's bushy tail.
    ctx.ellipse(-bodyL * 0.58, by + bodyH * 0.1, L * 0.16, L * 0.06, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = c.body;
    ctx.fill();
    ctx.stroke();
  } else if (!sheep) {
    ctx.moveTo(-bodyL * 0.5, by - bodyH * 0.1);
    ctx.lineTo(-bodyL * 0.62, by + bodyH * 0.25);
    ctx.stroke();
  }
  // Body.
  ctx.beginPath();
  if (sheep) {
    // Wool: a cloud of bumps.
    for (let k = 0; k < 5; k++) {
      const x = -bodyL * 0.4 + (bodyL * 0.8 * k) / 4;
      ctx.moveTo(x + bodyH * 0.38, by);
      ctx.arc(x, by - (k % 2) * bodyH * 0.08, bodyH * 0.38, 0, Math.PI * 2);
    }
  } else ctx.ellipse(0, by, bodyL / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.stroke();
  if (c.belly && !sheep) {
    ctx.beginPath();
    ctx.ellipse(bodyL * 0.02, by + bodyH * 0.22, bodyL * 0.3, bodyH * 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.belly;
    ctx.fill();
  }
  if (boar) {
    // A bristly ridge.
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const x = -bodyL * 0.3 + k * bodyL * 0.13;
      ctx.moveTo(x, by - bodyH * 0.45);
      ctx.lineTo(x + bodyL * 0.04, by - bodyH * 0.68);
    }
    ctx.stroke();
  }
  // Head and neck.
  const hx = bodyL * 0.52;
  const hy = by - bodyH * (kind === 0 ? 0.75 : bear || boar ? 0.05 : 0.45);
  const hr = L * (bear ? 0.16 : kind === 0 ? 0.11 : 0.12);
  if (kind === 0 || kind === 2 || kind === 4) {
    ctx.beginPath();
    ctx.moveTo(bodyL * 0.3, by - bodyH * 0.2);
    ctx.lineTo(hx - hr * 0.3, hy);
    ctx.lineWidth = hr * 1.1 + lw * 1.6;
    ctx.strokeStyle = NAVY;
    ctx.stroke();
    ctx.lineWidth = hr * 1.1;
    ctx.strokeStyle = c.body;
    ctx.stroke();
    ctx.lineWidth = lw;
    ctx.strokeStyle = NAVY;
  }
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * (boar || kind === 2 ? 1.35 : 1.1), hr, 0, 0, Math.PI * 2);
  ctx.fillStyle = sheep ? c.dark : c.body;
  ctx.fill();
  ctx.stroke();
  // A snout.
  if (boar || bear || kind === 2) {
    ctx.beginPath();
    ctx.ellipse(hx + hr * 1.1, hy + hr * 0.2, hr * 0.45, hr * 0.38, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.dark;
    ctx.fill();
    ctx.stroke();
  }
  // Ears, antlers, horns, tusks.
  ctx.beginPath();
  if (kind === 2) {
    ctx.moveTo(hx - hr * 0.5, hy - hr * 0.6);
    ctx.lineTo(hx - hr * 0.3, hy - hr * 1.5);
    ctx.lineTo(hx + hr * 0.1, hy - hr * 0.7);
    ctx.fillStyle = c.body;
    ctx.fill();
    ctx.stroke();
  } else if (bear) {
    ctx.arc(hx - hr * 0.5, hy - hr * 0.85, hr * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = c.body;
    ctx.fill();
    ctx.stroke();
  }
  if (kind === 0 && !young) {
    // Antlers.
    ctx.beginPath();
    ctx.moveTo(hx - hr * 0.2, hy - hr * 0.8);
    ctx.lineTo(hx - hr * 0.6, hy - hr * 2.4);
    ctx.moveTo(hx - hr * 0.45, hy - hr * 1.7);
    ctx.lineTo(hx - hr * 1.2, hy - hr * 2.0);
    ctx.moveTo(hx + hr * 0.2, hy - hr * 0.8);
    ctx.lineTo(hx + hr * 0.5, hy - hr * 2.2);
    ctx.lineWidth = Math.max(1, lw * 1.1);
    ctx.strokeStyle = '#7a5a36';
    ctx.stroke();
    ctx.lineWidth = lw;
    ctx.strokeStyle = NAVY;
  }
  if ((kind === 4 || (sheep && !tame)) && !young) {
    // Horns: an aurochs' forward curve, a wild ram's curl.
    ctx.beginPath();
    if (sheep) ctx.arc(hx - hr * 0.2, hy - hr * 0.1, hr * 0.75, Math.PI * 1.1, Math.PI * 2.2);
    else {
      ctx.moveTo(hx - hr * 0.4, hy - hr * 0.7);
      ctx.quadraticCurveTo(hx + hr * 0.2, hy - hr * 2.0, hx + hr * 1.1, hy - hr * 1.3);
    }
    ctx.lineWidth = Math.max(1.2, lw * 1.4);
    ctx.strokeStyle = '#e9dfc8';
    ctx.stroke();
    ctx.lineWidth = lw;
    ctx.strokeStyle = NAVY;
  }
  if (boar) {
    ctx.beginPath();
    ctx.moveTo(hx + hr * 1.2, hy + hr * 0.5);
    ctx.lineTo(hx + hr * 1.4, hy - hr * 0.2);
    ctx.lineWidth = Math.max(1, lw);
    ctx.strokeStyle = '#f2ead8';
    ctx.stroke();
    ctx.strokeStyle = NAVY;
  }
  // An eye.
  ctx.beginPath();
  ctx.arc(hx + hr * 0.35, hy - hr * 0.2, Math.max(0.6, hr * 0.15), 0, Math.PI * 2);
  ctx.fillStyle = NAVY;
  ctx.fill();
  return { canvas, ax, ay };
}

/** A dragon in flight: a long body, beating wings, and its shadow on the ground under it. */
function drawDragon(frame: number, L: number): CreatureSprite {
  const c = COLORS[6];
  const lw = Math.max(1.2, L * 0.025);
  const w = Math.ceil(L * 1.3);
  const h = Math.ceil(L * 1.4);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const ax = w / 2;
  const ay = h - lw * 3;
  ctx.translate(ax, ay);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // The shadow.
  ctx.beginPath();
  ctx.ellipse(0, 0, L * 0.35, L * 0.08, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 38, 87, 0.22)';
  ctx.fill();
  // Flying high above it.
  const y0 = -L * 0.7;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = lw;
  const beat = [0.35, 0.1, -0.2, 0.1][frame];
  // Far wing.
  wing(ctx, -L * 0.02, y0 - L * 0.05, L, beat * 0.8, c.dark, lw);
  // Tail, body, neck and head.
  ctx.beginPath();
  ctx.moveTo(-L * 0.18, y0);
  ctx.quadraticCurveTo(-L * 0.42, y0 + L * 0.06, -L * 0.55, y0 - L * 0.06);
  ctx.lineWidth = L * 0.05 + lw * 1.6;
  ctx.strokeStyle = NAVY;
  ctx.stroke();
  ctx.lineWidth = L * 0.05;
  ctx.strokeStyle = c.body;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-L * 0.55, y0 - L * 0.06);
  ctx.lineTo(-L * 0.62, y0 - L * 0.12);
  ctx.lineTo(-L * 0.6, y0 - L * 0.02);
  ctx.closePath();
  ctx.fillStyle = c.dark;
  ctx.lineWidth = lw;
  ctx.strokeStyle = NAVY;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, y0, L * 0.22, L * 0.09, -0.08, 0, Math.PI * 2);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(L * 0.02, y0 + L * 0.04, L * 0.16, L * 0.04, -0.08, 0, Math.PI * 2);
  ctx.fillStyle = c.belly!;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(L * 0.18, y0 - L * 0.03);
  ctx.quadraticCurveTo(L * 0.3, y0 - L * 0.16, L * 0.36, y0 - L * 0.2);
  ctx.lineWidth = L * 0.06 + lw * 1.6;
  ctx.strokeStyle = NAVY;
  ctx.stroke();
  ctx.lineWidth = L * 0.06;
  ctx.strokeStyle = c.body;
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = NAVY;
  ctx.beginPath();
  ctx.ellipse(L * 0.4, y0 - L * 0.21, L * 0.07, L * 0.045, 0.2, 0, Math.PI * 2);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.stroke();
  // Horns and an eye.
  ctx.beginPath();
  ctx.moveTo(L * 0.37, y0 - L * 0.25);
  ctx.lineTo(L * 0.31, y0 - L * 0.33);
  ctx.moveTo(L * 0.41, y0 - L * 0.255);
  ctx.lineTo(L * 0.38, y0 - L * 0.34);
  ctx.strokeStyle = '#e9dfc8';
  ctx.lineWidth = Math.max(1, lw * 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(L * 0.42, y0 - L * 0.225, Math.max(0.8, L * 0.012), 0, Math.PI * 2);
  ctx.fillStyle = '#f5c542';
  ctx.fill();
  // Near wing.
  ctx.strokeStyle = NAVY;
  wing(ctx, L * 0.02, y0 - L * 0.04, L, beat, c.body, lw);
  return { canvas, ax, ay };
}

function wing(ctx: CanvasRenderingContext2D, x: number, y: number, L: number, beat: number, color: string, lw: number) {
  const tipY = y - L * (0.32 + beat * 0.5);
  ctx.beginPath();
  ctx.moveTo(x - L * 0.08, y);
  ctx.lineTo(x - L * 0.02, tipY);
  ctx.lineTo(x + L * 0.08, tipY + L * 0.06);
  ctx.quadraticCurveTo(x + L * 0.06, y - L * 0.12, x + L * 0.12, y - L * 0.01);
  ctx.quadraticCurveTo(x + L * 0.02, y - L * 0.05, x - L * 0.08, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.fill();
  ctx.stroke();
  // Ribs.
  ctx.beginPath();
  ctx.moveTo(x - L * 0.02, tipY);
  ctx.lineTo(x + L * 0.02, y - L * 0.04);
  ctx.moveTo(x + L * 0.08, tipY + L * 0.06);
  ctx.lineTo(x + L * 0.06, y - L * 0.03);
  ctx.stroke();
}

/** Zoomed far out: a dot in the animal's color. */
export function creatureColor(kind: number, tame: boolean) {
  return ((tame && TAME[kind]) || COLORS[kind]).body;
}
