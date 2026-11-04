import { BUILDINGS, BuildingKind } from '../sim/buildings';
import type { BuildingView } from '../sim/types';
import { NAVY } from './style';

// Buildings, drawn as objects (Caleb: objects get the colors of what they are; everything
// keeps a navy outline) at their real footprint, WorldBox-like sizes (hut 2x2, house 2x3,
// storehouse 3x3), with walls taller than a person: wattle huts with tall thatch roofs,
// timber-framed houses with a chimney, a plank storehouse with big doors, and the campfire
// at a settlement's middle. A building being put up shows its posts and its walls rising,
// with a pile of wood and stone beside it. Where the ground under it is uneven it stands
// on a stone base. Each kind, turn, stage of building and size is drawn once into a
// picture and reused.

const C = {
  wattle: '#b58b5a',
  wattleLine: '#8f6a40',
  thatch: '#d6b25a',
  thatchDark: '#b8913f',
  thatchLine: '#a07a32',
  plaster: '#efe3c8',
  timber: '#6b4423',
  plank: '#9c6b3c',
  plankLine: '#7a5230',
  shingle: '#6e4a2a',
  shingleDark: '#553820',
  door: '#4a3424',
  window: '#3c3a44',
  shutter: '#7a5232',
  stone: '#b8b2a7',
  stoneDark: '#97918a',
  log: '#8b5a2b',
  flame: '#f08a24',
  flameHot: '#ffd23f',
  logWall: '#94653a',
  logLine: '#6e4626',
  soil: '#a77b4f',
  furrow: '#86603a',
  sprout: '#7fb24f',
  crop: '#5f9f47',
  wheat: '#e2bb4c',
  wheatDark: '#c39a32',
  fence: '#8b5a2b',
  net: '#d8cdb4',
  hull: '#7a5232',
  ore: '#a5583c',
  rock: '#9a948b',
  rockDark: '#7d776f',
  mineDark: '#2b2622',
  daub: '#d9b98c',
  tile: '#9c4a36',
  tileDark: '#7c3a2a',
  brick: '#b5654a',
  glow: '#ff9a3c',
  awning: '#c8433a',
  canvas: '#efe3c8',
  coin: '#f2c230',
};

/** Shapes, in tile widths. `wall` and `roof` are heights; the walls stand `inset` in from the footprint's edge. */
interface Shape {
  wall: number;
  roof: number;
  inset: number;
  roofKind: 'pyramid' | 'gable';
  wallColor: string;
  roofColor: string;
  roofShade: string;
  roofLine: string;
}

const SHAPES: Partial<Record<BuildingKind, Shape>> = {
  [BuildingKind.Hut]: { wall: 0.34, roof: 0.62, inset: 0.22, roofKind: 'pyramid', wallColor: C.wattle, roofColor: C.thatch, roofShade: C.thatchDark, roofLine: C.thatchLine },
  [BuildingKind.House]: { wall: 0.58, roof: 0.62, inset: 0.18, roofKind: 'gable', wallColor: C.plaster, roofColor: C.thatch, roofShade: C.thatchDark, roofLine: C.thatchLine },
  [BuildingKind.Storehouse]: { wall: 0.72, roof: 0.6, inset: 0.16, roofKind: 'gable', wallColor: C.plank, roofColor: C.shingle, roofShade: C.shingleDark, roofLine: C.shingleDark },
  [BuildingKind.Woodcutter]: { wall: 0.42, roof: 0.42, inset: 0.26, roofKind: 'gable', wallColor: C.logWall, roofColor: C.shingle, roofShade: C.shingleDark, roofLine: C.shingleDark },
  [BuildingKind.Quarry]: { wall: 0.38, roof: 0.3, inset: 0.24, roofKind: 'gable', wallColor: C.stone, roofColor: C.shingle, roofShade: C.shingleDark, roofLine: C.shingleDark },
  [BuildingKind.FishingHut]: { wall: 0.36, roof: 0.5, inset: 0.3, roofKind: 'pyramid', wallColor: '#a8784a', roofColor: C.thatch, roofShade: C.thatchDark, roofLine: C.thatchLine },
  [BuildingKind.Smithy]: { wall: 0.42, roof: 0.36, inset: 0.24, roofKind: 'gable', wallColor: C.stone, roofColor: C.shingle, roofShade: C.shingleDark, roofLine: C.shingleDark },
  [BuildingKind.Pottery]: { wall: 0.38, roof: 0.46, inset: 0.3, roofKind: 'pyramid', wallColor: C.daub, roofColor: C.thatch, roofShade: C.thatchDark, roofLine: C.thatchLine },
  [BuildingKind.Mint]: { wall: 0.6, roof: 0.42, inset: 0.24, roofKind: 'gable', wallColor: C.stone, roofColor: C.tile, roofShade: C.tileDark, roofLine: C.tileDark },
  [BuildingKind.Townhouse]: { wall: 0.92, roof: 0.66, inset: 0.16, roofKind: 'gable', wallColor: C.plaster, roofColor: C.tile, roofShade: C.tileDark, roofLine: C.tileDark },
};

type P = [number, number];

/** A point at offset (u, v) in tiles from the footprint's middle, raised by h, in the sprite's units (tile widths). */
const pt = (u: number, v: number, h = 0): P => [(u - v) / 2, (u + v) / 4 - h];

function poly(ctx: CanvasRenderingContext2D, pts: P[], fill: string) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, a: P, b: P, color: string, width = 1) {
  const w0 = ctx.lineWidth;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = w0 * width;
  ctx.stroke();
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = w0;
}

/** A colored line with a navy outline (a beam, a log, a post). */
function beam(ctx: CanvasRenderingContext2D, a: P, b: P, color: string, width: number) {
  const w0 = ctx.lineWidth;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineWidth = w0 * (width + 1.4);
  ctx.strokeStyle = NAVY;
  ctx.stroke();
  ctx.lineWidth = w0 * width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineWidth = w0;
  ctx.strokeStyle = NAVY;
}

function shade(hex: string, k: number) {
  const v = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, c * k)));
  return `rgb(${f((v >> 16) & 255)},${f((v >> 8) & 255)},${f(v & 255)})`;
}

/**
 * A point on one of the two visible walls: the front-left wall runs along +v (u from -a to a),
 * the front-right wall along +u (v from b to -b). `t` 0..1 along the wall, `h` up from the ground.
 */
function onLeft(a: number, b: number, t: number, h: number): P {
  return pt(-a + 2 * a * t, b, h);
}
function onRight(a: number, b: number, t: number, h: number): P {
  return pt(a, b - 2 * b * t, h);
}

/** A rectangle on a wall: from t0 to t1 along it, h0 to h1 up. */
function wallRect(ctx: CanvasRenderingContext2D, on: (t: number, h: number) => P, t0: number, t1: number, h0: number, h1: number, fill: string) {
  poly(ctx, [on(t0, h0), on(t1, h0), on(t1, h1), on(t0, h1)], fill);
}

function drawHouseLike(ctx: CanvasRenderingContext2D, kind: BuildingKind, sh: Shape, w: number, d: number, rise: number, roofUp: number, plinth: number) {
  const a = w / 2 - sh.inset;
  const b = d / 2 - sh.inset;
  const wall = sh.wall * rise;
  const L = (h: number) => pt(-a, b, h);
  const B = (h: number) => pt(a, b, h);
  const R = (h: number) => pt(a, -b, h);
  const T = (h: number) => pt(-a, -b, h);
  // A stone base where the ground is uneven.
  if (plinth > 0) {
    poly(ctx, [L(-plinth), B(-plinth), B(0), L(0)], C.stone);
    poly(ctx, [B(-plinth), R(-plinth), R(0), B(0)], C.stoneDark);
  }
  // Walls: front-left and front-right.
  poly(ctx, [L(0), B(0), B(wall), L(wall)], shade(sh.wallColor, 0.95));
  poly(ctx, [B(0), R(0), R(wall), B(wall)], shade(sh.wallColor, 0.8));
  const left = (t: number, h: number) => onLeft(a, b, t, h);
  const right = (t: number, h: number) => onRight(a, b, t, h);
  const lenL = 2 * a;
  const lenR = 2 * b;
  if (rise > 0.3) {
    if (kind === BuildingKind.Hut) {
      // Woven wattle.
      for (const k of [0.3, 0.6]) {
        line(ctx, left(0.04, wall * k), left(0.96, wall * k), C.wattleLine, 0.8);
        line(ctx, right(0.04, wall * k), right(0.96, wall * k), C.wattleLine, 0.8);
      }
    } else if (kind === BuildingKind.Storehouse) {
      // Planks.
      for (let k = 1; k < 5; k++) {
        const h = (wall * k) / 5;
        line(ctx, left(0.02, h), left(0.98, h), C.plankLine, 0.8);
        line(ctx, right(0.02, h), right(0.98, h), C.plankLine, 0.8);
      }
    } else if (kind === BuildingKind.Woodcutter) {
      // Stacked logs.
      for (let k = 1; k < 4; k++) {
        const h = (wall * k) / 4;
        line(ctx, left(0.0, h), left(1, h), C.logLine, 1.1);
        line(ctx, right(0.0, h), right(1, h), C.logLine, 1.1);
      }
    } else if (kind === BuildingKind.Townhouse) {
      // A stone ground floor, a timber-framed upper floor.
      const lower = wall * 0.45;
      wallRect(ctx, left, 0, 1, 0, lower, C.stone);
      wallRect(ctx, right, 0, 1, 0, lower, C.stoneDark);
      for (const [on, len] of [
        [left, lenL],
        [right, lenR],
      ] as const) {
        const posts = Math.max(2, Math.round(len / 0.6));
        if (rise >= 1) {
          for (let k = 0; k <= posts; k++) beam(ctx, on(k / posts, lower), on(k / posts, wall), C.timber, 1.4);
          beam(ctx, on(0, lower), on(1, lower), C.timber, 1.8);
          beam(ctx, on(0, wall - 0.01), on(1, wall - 0.01), C.timber, 1.4);
        }
        for (const t of [0.33, 0.66]) line(ctx, on(0.02, lower * t), on(0.98, lower * t), C.stoneDark, 0.8);
      }
    } else if (kind === BuildingKind.Smithy || kind === BuildingKind.Mint) {
      for (let k = 1; k < 4; k++) {
        const h = (wall * k) / 4;
        line(ctx, left(0.02, h), left(0.98, h), C.stoneDark, 0.8);
        line(ctx, right(0.02, h), right(0.98, h), C.stoneDark, 0.8);
      }
    } else if (kind === BuildingKind.Quarry) {
      // Cut stone blocks, staggered.
      for (let k = 1; k < 3; k++) {
        const h = (wall * k) / 3;
        line(ctx, left(0.02, h), left(0.98, h), C.stoneDark, 0.9);
        line(ctx, right(0.02, h), right(0.98, h), C.stoneDark, 0.9);
      }
      for (let r = 0; r < 3; r++) {
        for (const t of r % 2 ? [0.25, 0.75] : [0.5]) {
          line(ctx, left(t, (wall * r) / 3), left(t, (wall * (r + 1)) / 3), C.stoneDark, 0.9);
          line(ctx, right(t, (wall * r) / 3), right(t, (wall * (r + 1)) / 3), C.stoneDark, 0.9);
        }
      }
    } else if (kind === BuildingKind.FishingHut) {
      for (let k = 1; k < 4; k++) {
        const h = (wall * k) / 4;
        line(ctx, left(0.03, h), left(0.97, h), C.plankLine, 0.8);
        line(ctx, right(0.03, h), right(0.97, h), C.plankLine, 0.8);
      }
    } else if (kind === BuildingKind.House && rise >= 1) {
      // Timber framing: posts, a rail and braces.
      for (const [on, len] of [
        [left, lenL],
        [right, lenR],
      ] as const) {
        const posts = Math.max(2, Math.round(len / 0.7));
        for (let k = 0; k <= posts; k++) beam(ctx, on(k / posts, 0), on(k / posts, wall), C.timber, 1.4);
        beam(ctx, on(0, wall * 0.5), on(1, wall * 0.5), C.timber, 1.2);
        beam(ctx, on(0, wall - 0.01), on(1, wall - 0.01), C.timber, 1.4);
        beam(ctx, on(0, wall * 0.5), on(1 / posts, wall), C.timber, 1);
      }
    }
  }
  if (rise >= 1) {
    // A door on the front-left wall, a little taller than a person.
    const doorW = kind === BuildingKind.Storehouse ? 0.5 : 0.24;
    const doorH = kind === BuildingKind.Storehouse ? 0.55 : 0.44;
    const dt = 0.5 - doorW / lenL / 2;
    wallRect(ctx, left, dt, dt + doorW / lenL, 0, doorH, C.door);
    if (kind === BuildingKind.Storehouse) line(ctx, left(0.5, 0), left(0.5, doorH), NAVY, 1);
    if (kind === BuildingKind.Smithy) {
      // The forge's glow through an opening in the right wall.
      wallRect(ctx, right, 0.3, 0.7, wall * 0.15, wall * 0.55, C.glow);
    }
    if (kind === BuildingKind.Townhouse || kind === BuildingKind.Mint) {
      const rows = kind === BuildingKind.Townhouse ? [wall * 0.18, wall * 0.62] : [wall * 0.45];
      for (const h0 of rows) {
        for (const [on, len, ts] of [
          [left, lenL, lenL > 1.2 ? [0.2, 0.82] : [0.82]],
          [right, lenR, lenR > 1.4 ? [0.25, 0.5, 0.75] : [0.5]],
        ] as const) {
          for (const t of ts) {
            if (on === left && Math.abs(t - 0.5) < 0.2 && h0 < wall * 0.3) continue; // the door
            const ww = 0.13 / len;
            wallRect(ctx, on, t - ww / 2, t + ww / 2, h0, h0 + 0.15, C.window);
          }
        }
      }
    }
    // Windows with shutters (not on a hut or a storehouse).
    if (kind === BuildingKind.House) {
      const win = (on: (t: number, h: number) => P, t: number, len: number) => {
        const ww = 0.16 / len;
        wallRect(ctx, on, t - ww / 2, t + ww / 2, wall * 0.42, wall * 0.42 + 0.14, C.window);
        wallRect(ctx, on, t - ww / 2 - 0.07 / len, t - ww / 2, wall * 0.42, wall * 0.42 + 0.14, C.shutter);
      };
      if (lenL > 1.2) {
        win(left, 0.2, lenL);
        win(left, 0.82, lenL);
      }
      win(right, 0.3, lenR);
      if (lenR > 1.4) win(right, 0.72, lenR);
    }
  }
  if (roofUp <= 0) {
    // Not roofed yet: the top of the walls.
    poly(ctx, [L(wall), B(wall), R(wall), T(wall)], shade(sh.wallColor, 1.05));
    return;
  }
  const o = 0.08; // eaves overhang
  const rh = sh.roof * roofUp;
  if (sh.roofKind === 'pyramid') {
    const apex = pt(0, 0, wall + rh);
    const eL = pt(-a - o, b + o, wall - 0.02);
    const eB = pt(a + o, b + o, wall - 0.02);
    const eR = pt(a + o, -b - o, wall - 0.02);
    poly(ctx, [eL, eB, apex], sh.roofColor);
    poly(ctx, [eB, eR, apex], sh.roofShade);
    // Thatch lines.
    for (const k of [0.35, 0.65]) {
      const p1: P = [eL[0] + (apex[0] - eL[0]) * k, eL[1] + (apex[1] - eL[1]) * k];
      const p2: P = [eB[0] + (apex[0] - eB[0]) * k, eB[1] + (apex[1] - eB[1]) * k];
      const p3: P = [eR[0] + (apex[0] - eR[0]) * k, eR[1] + (apex[1] - eR[1]) * k];
      line(ctx, p1, p2, sh.roofLine, 0.8);
      line(ctx, p2, p3, sh.roofLine, 0.8);
    }
    return;
  }
  // A gable roof, its ridge along the longer side.
  if (w >= d) {
    // Ridge along u: the front slope faces +v; the gable end is on the right (+u) wall.
    const r0 = pt(-a - o, 0, wall + rh);
    const r1 = pt(a + o, 0, wall + rh);
    poly(ctx, [B(wall), R(wall), pt(a, 0, wall + rh)], shade(sh.wallColor, 0.8));
    if (kind === BuildingKind.House) beam(ctx, B(wall), pt(a, 0, wall + rh * 0.98), C.timber, 1);
    const eL = pt(-a - o, b + o, wall - 0.04);
    const eB = pt(a + o, b + o, wall - 0.04);
    poly(ctx, [eL, eB, r1, r0], sh.roofColor);
    for (const k of [0.33, 0.66]) {
      line(ctx, [eL[0] + (r0[0] - eL[0]) * k, eL[1] + (r0[1] - eL[1]) * k], [eB[0] + (r1[0] - eB[0]) * k, eB[1] + (r1[1] - eB[1]) * k], sh.roofLine, 0.8);
    }
    if ((kind === BuildingKind.House || kind === BuildingKind.Townhouse || kind === BuildingKind.Smithy) && roofUp >= 1) chimney(ctx, pt(-a * 0.55, -0.02, wall + rh * 0.55), rh);
  } else {
    // Ridge along v: the front slope faces +u; the gable end is on the left (+v) wall.
    const r0 = pt(0, -b - o, wall + rh);
    const r1 = pt(0, b + o, wall + rh);
    poly(ctx, [L(wall), B(wall), pt(0, b, wall + rh)], shade(sh.wallColor, 0.95));
    if (kind === BuildingKind.House) beam(ctx, B(wall), pt(0, b, wall + rh * 0.98), C.timber, 1);
    const eB = pt(a + o, b + o, wall - 0.04);
    const eR = pt(a + o, -b - o, wall - 0.04);
    poly(ctx, [eB, eR, r0, r1], sh.roofShade);
    for (const k of [0.33, 0.66]) {
      line(ctx, [eB[0] + (r1[0] - eB[0]) * k, eB[1] + (r1[1] - eB[1]) * k], [eR[0] + (r0[0] - eR[0]) * k, eR[1] + (r0[1] - eR[1]) * k], sh.roofLine, 0.8);
    }
    if ((kind === BuildingKind.House || kind === BuildingKind.Townhouse || kind === BuildingKind.Smithy) && roofUp >= 1) chimney(ctx, pt(0.02, -b * 0.55, wall + rh * 0.55), rh);
  }
}

/** A stone chimney standing on the roof. */
function chimney(ctx: CanvasRenderingContext2D, base: P, rh: number) {
  const w = 0.07;
  const h = rh * 0.75;
  poly(
    ctx,
    [
      [base[0] - w, base[1]],
      [base[0], base[1] + w / 2],
      [base[0], base[1] + w / 2 - h],
      [base[0] - w, base[1] - h],
    ],
    C.stone,
  );
  poly(
    ctx,
    [
      [base[0], base[1] + w / 2],
      [base[0] + w, base[1]],
      [base[0] + w, base[1] - h],
      [base[0], base[1] + w / 2 - h],
    ],
    C.stoneDark,
  );
  poly(
    ctx,
    [
      [base[0] - w, base[1] - h],
      [base[0], base[1] + w / 2 - h],
      [base[0] + w, base[1] - h],
      [base[0], base[1] - w / 2 - h],
    ],
    '#4a4642',
  );
}

/** Props beside a finished workplace that say what it is. Drawn in front of its walls. */
function drawProps(ctx: CanvasRenderingContext2D, kind: BuildingKind, w: number, d: number) {
  const a = w / 2;
  const b = d / 2;
  if (kind === BuildingKind.Woodcutter) {
    // A pile of logs (ends showing) by the right wall, and a chopping block with an axe.
    const base = pt(a - 0.1, b - 0.55);
    for (const [dx, dy] of [
      [0, 0],
      [0.1, 0.05],
      [0.2, 0.1],
      [0.05, -0.08],
      [0.15, -0.03],
    ]) {
      ctx.beginPath();
      ctx.ellipse(base[0] + dx, base[1] + dy, 0.05, 0.05, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#c99a62';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(base[0] + dx, base[1] + dy, 0.018, 0, Math.PI * 2);
      ctx.strokeStyle = C.logLine;
      ctx.stroke();
      ctx.strokeStyle = NAVY;
    }
    const blk = pt(-a + 0.3, b - 0.05);
    poly(ctx, [[blk[0] - 0.06, blk[1]], [blk[0] + 0.06, blk[1]], [blk[0] + 0.06, blk[1] - 0.07], [blk[0] - 0.06, blk[1] - 0.07]], C.log);
    ctx.beginPath();
    ctx.ellipse(blk[0], blk[1] - 0.07, 0.06, 0.025, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#c99a62';
    ctx.fill();
    ctx.stroke();
    beam(ctx, [blk[0] - 0.01, blk[1] - 0.08], [blk[0] + 0.1, blk[1] - 0.22], C.log, 1.2);
    poly(ctx, [[blk[0] - 0.03, blk[1] - 0.07], [blk[0] + 0.03, blk[1] - 0.1], [blk[0] + 0.01, blk[1] - 0.04]], '#b8bcc4');
  } else if (kind === BuildingKind.Quarry) {
    // Cut blocks stacked in front.
    const base = pt(a - 0.15, b - 0.2);
    const cube = (x: number, y: number, s: number) => {
      poly(ctx, [[x - s, y], [x, y + s / 2], [x, y + s / 2 - s * 0.8], [x - s, y - s * 0.8]], C.stone);
      poly(ctx, [[x, y + s / 2], [x + s, y], [x + s, y - s * 0.8], [x, y + s / 2 - s * 0.8]], C.stoneDark);
      poly(ctx, [[x - s, y - s * 0.8], [x, y + s / 2 - s * 0.8], [x + s, y - s * 0.8], [x, y - s / 2 - s * 0.8]], '#cfcac1');
    };
    cube(base[0] - 0.08, base[1], 0.08);
    cube(base[0] + 0.1, base[1] + 0.06, 0.08);
    cube(base[0] + 0.01, base[1] - 0.06, 0.08);
  } else if (kind === BuildingKind.Smithy) {
    // An anvil on a block in front of the door.
    const p0 = pt(-a + 0.35, b + 0.1);
    poly(ctx, [[p0[0] - 0.05, p0[1]], [p0[0] + 0.05, p0[1]], [p0[0] + 0.05, p0[1] - 0.08], [p0[0] - 0.05, p0[1] - 0.08]], C.log);
    poly(ctx, [[p0[0] - 0.1, p0[1] - 0.08], [p0[0] + 0.08, p0[1] - 0.08], [p0[0] + 0.06, p0[1] - 0.13], [p0[0] - 0.13, p0[1] - 0.13]], '#55585e');
  } else if (kind === BuildingKind.Pottery) {
    // A kiln beside it, and pots set out to dry.
    const k0 = pt(a - 0.15, -b + 0.4);
    ctx.beginPath();
    ctx.moveTo(k0[0] - 0.16, k0[1]);
    ctx.quadraticCurveTo(k0[0] - 0.16, k0[1] - 0.32, k0[0], k0[1] - 0.32);
    ctx.quadraticCurveTo(k0[0] + 0.16, k0[1] - 0.32, k0[0] + 0.16, k0[1]);
    ctx.closePath();
    ctx.fillStyle = C.brick;
    ctx.fill();
    ctx.stroke();
    poly(ctx, [[k0[0] - 0.05, k0[1]], [k0[0] + 0.05, k0[1]], [k0[0] + 0.05, k0[1] - 0.09], [k0[0] - 0.05, k0[1] - 0.09]], C.glow);
    const pots = pt(-a + 0.4, b + 0.12);
    for (const [dx, dy, col] of [
      [0, 0, '#c9845a'],
      [0.11, 0.04, '#b5654a'],
      [-0.1, 0.05, '#d9a06c'],
    ] as const) {
      const x = pots[0] + dx;
      const y = pots[1] + dy;
      ctx.beginPath();
      ctx.moveTo(x - 0.025, y - 0.1);
      ctx.quadraticCurveTo(x - 0.07, y - 0.05, x - 0.035, y);
      ctx.lineTo(x + 0.035, y);
      ctx.quadraticCurveTo(x + 0.07, y - 0.05, x + 0.025, y - 0.1);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === BuildingKind.Mint) {
    // A sign with a gold coin by the door.
    const s0 = onLeft(a - 0.24, b - 0.24, 0.22, 0.42);
    beam(ctx, [s0[0], s0[1]], [s0[0] - 0.14, s0[1] + 0.03], C.timber, 1);
    ctx.beginPath();
    ctx.arc(s0[0] - 0.12, s0[1] + 0.1, 0.055, 0, Math.PI * 2);
    ctx.fillStyle = C.coin;
    ctx.fill();
    ctx.stroke();
  } else if (kind === BuildingKind.FishingHut) {
    // A drying rack with a net, and a small boat pulled up.
    const r0 = pt(a - 0.05, -b + 0.35);
    const r1 = pt(a - 0.05, b - 0.35);
    beam(ctx, r0, [r0[0], r0[1] - 0.32], C.log, 1.2);
    beam(ctx, r1, [r1[0], r1[1] - 0.32], C.log, 1.2);
    poly(ctx, [[r0[0], r0[1] - 0.3], [r1[0], r1[1] - 0.3], [r1[0], r1[1] - 0.08], [r0[0], r0[1] - 0.08]], C.net);
    ctx.beginPath();
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      ctx.moveTo(r0[0] + (r1[0] - r0[0]) * t, r0[1] - 0.3 + (r1[1] - r0[1]) * t);
      ctx.lineTo(r0[0] + (r1[0] - r0[0]) * t, r0[1] - 0.08 + (r1[1] - r0[1]) * t);
    }
    ctx.moveTo(r0[0], r0[1] - 0.19);
    ctx.lineTo(r1[0], r1[1] - 0.19);
    ctx.strokeStyle = '#a8a08a';
    ctx.stroke();
    ctx.strokeStyle = NAVY;
    beam(ctx, [r0[0], r0[1] - 0.31], [r1[0], r1[1] - 0.31], C.log, 1.2);
    const bt = pt(-a + 0.25, b + 0.05);
    ctx.beginPath();
    ctx.moveTo(bt[0] - 0.22, bt[1] - 0.06);
    ctx.quadraticCurveTo(bt[0], bt[1] + 0.1, bt[0] + 0.22, bt[1] - 0.06);
    ctx.lineTo(bt[0] - 0.22, bt[1] - 0.06);
    ctx.closePath();
    ctx.fillStyle = C.hull;
    ctx.fill();
    ctx.stroke();
  }
}

/** A market: stalls with striped awnings and goods set out, around an open square. */
function drawMarket(ctx: CanvasRenderingContext2D, w: number, d: number, progress: number) {
  const a = w / 2 - 0.1;
  const b = d / 2 - 0.1;
  // The square's paving.
  poly(ctx, [pt(-a, b), pt(a, b), pt(a, -b), pt(-a, -b)], '#d8cfbf');
  const stalls: [number, number][] = [
    [-a * 0.55, -b * 0.55],
    [a * 0.4, -b * 0.6],
    [-a * 0.6, b * 0.35],
    [a * 0.45, b * 0.4],
  ];
  const n = progress >= 1 ? 4 : Math.floor(progress * 4);
  const goods = ['#e2bb4c', '#c9845a', '#7fb24f', '#b8b2a7'];
  stalls.slice(0, n).forEach(([u, v], k) => {
    const sw = 0.36;
    const sd = 0.26;
    const H = 0.34;
    // Table.
    poly(ctx, [pt(u - sw, v + sd, 0.12), pt(u + sw, v + sd, 0.12), pt(u + sw, v - sd, 0.12), pt(u - sw, v - sd, 0.12)], C.plank);
    poly(ctx, [pt(u - sw, v + sd, 0), pt(u + sw, v + sd, 0), pt(u + sw, v + sd, 0.12), pt(u - sw, v + sd, 0.12)], C.plankLine);
    // Goods on it.
    for (let j = 0; j < 4; j++) {
      const p0 = pt(u - sw * 0.6 + j * sw * 0.4, v, 0.15);
      ctx.beginPath();
      ctx.arc(p0[0], p0[1], 0.035, 0, Math.PI * 2);
      ctx.fillStyle = goods[(j + k) % goods.length];
      ctx.fill();
      ctx.stroke();
    }
    // Posts and a striped awning.
    for (const [du, dv] of [
      [-sw, sd],
      [sw, sd],
    ]) beam(ctx, pt(u + du, v + dv, 0), pt(u + du, v + dv, H), C.timber, 1);
    const stripes = 4;
    for (let j = 0; j < stripes; j++) {
      const u0 = u - sw + (2 * sw * j) / stripes;
      const u1 = u - sw + (2 * sw * (j + 1)) / stripes;
      poly(ctx, [pt(u0, v + sd, H), pt(u1, v + sd, H), pt(u1, v - sd, H + 0.12), pt(u0, v - sd, H + 0.12)], j % 2 ? C.canvas : C.awning);
    }
  });
}

/** A mine: a rocky mound with a timbered entrance and a cart of ore. */
function drawMine(ctx: CanvasRenderingContext2D, w: number, d: number, progress: number) {
  const a = w / 2 - 0.12;
  const b = d / 2 - 0.12;
  const h = 0.55 * Math.min(1, 0.4 + progress);
  // The mound: a low pyramid of rock with a rounded top.
  const L = pt(-a, b);
  const B = pt(a, b);
  const R = pt(a, -b);
  const top = pt(-0.1, -0.1, h);
  poly(ctx, [L, B, [top[0] + 0.04, top[1] + 0.02], [top[0] - 0.08, top[1]]], C.rock);
  poly(ctx, [B, R, [top[0] + 0.06, top[1] - 0.02], [top[0] + 0.04, top[1] + 0.02]], C.rockDark);
  // Rocks on it.
  for (const [u, v, s] of [
    [-0.2, 0.25, 0.06],
    [0.25, 0.1, 0.05],
    [0.05, -0.3, 0.05],
  ]) {
    const p = pt(u, v, h * 0.35);
    ctx.beginPath();
    ctx.ellipse(p[0], p[1], s, s * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.stone;
    ctx.fill();
    ctx.stroke();
  }
  if (progress < 0.6) return;
  // Entrance on the front-left face.
  const e = pt(-0.05, b - 0.02);
  const ew = 0.13;
  const eh = 0.3;
  poly(ctx, [[e[0] - ew, e[1] - ew / 2], [e[0] + ew, e[1] + ew / 2], [e[0] + ew, e[1] + ew / 2 - eh], [e[0] - ew, e[1] - ew / 2 - eh]], C.mineDark);
  beam(ctx, [e[0] - ew, e[1] - ew / 2], [e[0] - ew, e[1] - ew / 2 - eh], C.timber, 1.8);
  beam(ctx, [e[0] + ew, e[1] + ew / 2], [e[0] + ew, e[1] + ew / 2 - eh], C.timber, 1.8);
  beam(ctx, [e[0] - ew - 0.03, e[1] - ew / 2 - eh], [e[0] + ew + 0.03, e[1] + ew / 2 - eh], C.timber, 1.8);
  if (progress < 1) return;
  // Rails and a cart of ore.
  const c0 = pt(-0.05, b + 0.1);
  beam(ctx, [c0[0] - 0.05, c0[1] - 0.02], [c0[0] - 0.2, c0[1] + 0.06], '#777', 0.8);
  beam(ctx, [c0[0] + 0.05, c0[1] + 0.02], [c0[0] - 0.1, c0[1] + 0.1], '#777', 0.8);
  const cx = c0[0] - 0.1;
  const cy = c0[1] + 0.03;
  poly(ctx, [[cx - 0.1, cy - 0.12], [cx + 0.1, cy - 0.12], [cx + 0.07, cy - 0.02], [cx - 0.07, cy - 0.02]], C.plank);
  for (const [dx, dy] of [
    [-0.05, -0.14],
    [0.02, -0.16],
    [0.06, -0.13],
  ]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 0.03, 0, Math.PI * 2);
    ctx.fillStyle = C.ore;
    ctx.fill();
    ctx.stroke();
  }
  for (const dx of [-0.05, 0.05]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy, 0.025, 0, Math.PI * 2);
    ctx.fillStyle = '#555';
    ctx.fill();
    ctx.stroke();
  }
}

/** A farm: a fenced field of tilled soil whose crop grows and ripens; sheaves wait at its corner after a harvest. */
function drawFarm(ctx: CanvasRenderingContext2D, w: number, d: number, look: number, progress: number) {
  const a = w / 2 - 0.05;
  const b = d / 2 - 0.05;
  poly(ctx, [pt(-a, b), pt(a, b), pt(a, -b), pt(-a, -b)], C.soil);
  // Furrows along the longer side.
  const along = w >= d;
  const n = Math.round((along ? d : w) * 3);
  ctx.beginPath();
  for (let k = 1; k < n; k++) {
    const f = -1 + (2 * k) / n;
    const p0 = along ? pt(-a + 0.05, f * b) : pt(f * a, -b + 0.05);
    const p1 = along ? pt(a - 0.05, f * b) : pt(f * a, b - 0.05);
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
  }
  ctx.strokeStyle = C.furrow;
  ctx.stroke();
  ctx.strokeStyle = NAVY;
  const crop = progress < 1 ? 0 : look & 3;
  if (crop > 0) {
    // Plants along each furrow.
    const per = Math.round((along ? w : d) * 4);
    for (let k = 1; k < n; k++) {
      const f = -1 + (2 * k) / n;
      for (let j = 0; j < per; j++) {
        const g = -1 + (2 * (j + 0.5)) / per;
        const p = along ? pt(g * (a - 0.08), f * b) : pt(f * a, g * (b - 0.08));
        if (crop === 1) {
          line(ctx, [p[0], p[1]], [p[0], p[1] - 0.05], C.sprout, 1.1);
        } else {
          const tall = crop === 3 ? 0.13 : 0.09;
          const col = crop === 3 ? C.wheat : C.crop;
          ctx.beginPath();
          ctx.moveTo(p[0] - 0.03, p[1]);
          ctx.lineTo(p[0] - 0.035, p[1] - tall * 0.8);
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(p[0], p[1] - tall);
          ctx.moveTo(p[0] + 0.03, p[1]);
          ctx.lineTo(p[0] + 0.035, p[1] - tall * 0.8);
          ctx.strokeStyle = col;
          const w0 = ctx.lineWidth;
          ctx.lineWidth = w0 * 1.2;
          ctx.stroke();
          ctx.lineWidth = w0;
          ctx.strokeStyle = NAVY;
          if (crop === 3) {
            ctx.beginPath();
            ctx.ellipse(p[0], p[1] - tall, 0.014, 0.03, 0, 0, Math.PI * 2);
            ctx.fillStyle = C.wheatDark;
            ctx.fill();
          }
        }
      }
    }
  }
  // A low fence of posts and two rails around the field (going up side by side while it is being built).
  const corners: P[] = [pt(-a, -b), pt(a, -b), pt(a, b), pt(-a, b)];
  const fenceH = 0.12;
  const sides = progress >= 1 ? 4 : Math.floor(progress * 4);
  if (progress < 1) drawPiles(ctx, w, d);
  for (let k = 0; k < sides; k++) {
    const p0 = corners[k];
    const p1 = corners[(k + 1) % 4];
    const len = k % 2 === 0 ? w : d;
    const posts = Math.max(2, Math.round(len * 1.5));
    for (let j = 0; j <= posts; j++) {
      const t = j / posts;
      const p: P = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
      beam(ctx, p, [p[0], p[1] - fenceH], C.fence, 0.9);
    }
    for (const hh of [fenceH * 0.45, fenceH * 0.9]) beam(ctx, [p0[0], p0[1] - hh], [p1[0], p1[1] - hh], C.fence, 0.7);
  }
  // Sheaves waiting to be carried to the store.
  if (look & 4) {
    const c = pt(a - 0.35, b - 0.25);
    for (const [dx, dy] of [
      [0, 0],
      [0.13, 0.05],
      [-0.1, 0.06],
    ]) {
      const x = c[0] + dx;
      const y = c[1] + dy;
      poly(ctx, [[x - 0.05, y], [x + 0.05, y], [x + 0.025, y - 0.16], [x - 0.025, y - 0.16]], C.wheat);
      line(ctx, [x - 0.035, y - 0.07], [x + 0.035, y - 0.07], C.wheatDark, 1.2);
    }
  }
}

function drawCampfire(ctx: CanvasRenderingContext2D, frame: number) {
  // Stones in a ring.
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(ang) * 0.17, Math.sin(ang) * 0.085, 0.045, 0.028, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.stone;
    ctx.fill();
    ctx.stroke();
  }
  // Crossed logs.
  beam(ctx, [-0.12, 0.04], [0.11, -0.04], C.log, 2.2);
  beam(ctx, [-0.1, -0.04], [0.12, 0.035], C.log, 2.2);
  // Flame.
  const tip = frame ? -0.34 : -0.3;
  const lean = frame ? 0.02 : -0.02;
  ctx.beginPath();
  ctx.moveTo(-0.08, -0.01);
  ctx.quadraticCurveTo(-0.1, -0.14, lean, tip);
  ctx.quadraticCurveTo(0.1, -0.14, 0.08, -0.01);
  ctx.closePath();
  ctx.fillStyle = C.flame;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.04, -0.02);
  ctx.quadraticCurveTo(-0.05, -0.1, lean * 0.6, tip + 0.1);
  ctx.quadraticCurveTo(0.05, -0.1, 0.04, -0.02);
  ctx.closePath();
  ctx.fillStyle = C.flameHot;
  ctx.fill();
}

/** Piles of wood and stone beside a building site, in front of its right wall. */
function drawPiles(ctx: CanvasRenderingContext2D, w: number, d: number) {
  const base = pt(w / 2 - 0.05, d / 2 - 0.05);
  for (let k = 0; k < 3; k++) beam(ctx, [base[0] - 0.12, base[1] - k * 0.035], [base[0] + 0.06, base[1] + 0.06 - k * 0.035], C.log, 1.8);
  for (const [dx, dy] of [
    [0.16, 0.0],
    [0.24, 0.03],
    [0.2, -0.03],
  ]) {
    ctx.beginPath();
    ctx.ellipse(base[0] + dx, base[1] + dy, 0.045, 0.028, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.stone;
    ctx.fill();
    ctx.stroke();
  }
}

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the footprint's middle (at ground level) is in the picture. */
  ax: number;
  ay: number;
  pixels: number;
}

const cache = new Map<string, Sprite>();
let cachePixels = 0;
const CACHE_PIXELS = 30_000_000;

function sprite(b: BuildingView, step: number, frame: number, px: number, plinth: number): Sprite {
  const key = `${b.kind}|${b.w}x${b.d}|${step}|${frame}|${px}|${plinth}|${b.look}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cachePixels > CACHE_PIXELS) {
    cache.clear();
    cachePixels = 0;
  }
  const { w, d } = b;
  const sh = SHAPES[b.kind];
  const tall = sh ? sh.wall + sh.roof : b.kind === BuildingKind.Mine ? 0.7 : b.kind === BuildingKind.Market ? 0.6 : 0.4;
  const halfW = (w + d) / 4 + 0.3;
  const up = (w + d) / 8 + tall + 0.3;
  const down = (w + d) / 8 + plinth + 0.25;
  const cw = Math.ceil(halfW * 2 * px);
  const ch = Math.ceil((up + down) * px);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  const ax = cw / 2;
  const ay = up * px;
  ctx.setTransform(px, 0, 0, px, ax, ay);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, px * 0.03) / px;
  ctx.strokeStyle = NAVY;
  if (b.kind === BuildingKind.Farm) drawFarm(ctx, w, d, b.look, step / 10);
  else if (b.kind === BuildingKind.Market) {
    drawMarket(ctx, w, d, step / 10);
    if (step < 10) drawPiles(ctx, w, d);
  }
  else if (b.kind === BuildingKind.Mine) {
    drawMine(ctx, w, d, step / 10);
    if (step < 10) drawPiles(ctx, w, d);
  } else if (b.kind === BuildingKind.Campfire || !sh) drawCampfire(ctx, frame);
  else {
    const progress = step / 10;
    if (progress >= 1) {
      drawHouseLike(ctx, b.kind, sh, w, d, 1, 1, plinth);
      drawProps(ctx, b.kind, w, d);
    } else {
      // Being built: posts at the corners and along the walls, walls rising, then the roof.
      const rise = Math.min(1, progress / 0.7);
      const roofUp = progress < 0.7 ? 0 : (progress - 0.7) / 0.3;
      const a = w / 2 - sh.inset;
      const bb = d / 2 - sh.inset;
      // Back posts first, so the walls cover them.
      beam(ctx, pt(-a, -bb), pt(-a, -bb, sh.wall), C.log, 1.6);
      if (rise > 0.05) drawHouseLike(ctx, b.kind, sh, w, d, rise, roofUp, plinth);
      for (const [u, v] of [
        [-a, bb],
        [a, bb],
        [a, -bb],
      ]) {
        beam(ctx, pt(u, v), pt(u, v, sh.wall), C.log, 1.6);
      }
      drawPiles(ctx, w, d);
    }
  }
  const s = { canvas, ax, ay, pixels: cw * ch };
  cache.set(key, s);
  cachePixels += s.pixels;
  return s;
}

/**
 * Draws one building with its footprint's middle (at the height of its highest tile) at screen
 * point (sx, sy); z is screen pixels per tile width; plinth is how many levels lower its lowest tile is.
 */
export function drawBuilding(ctx: CanvasRenderingContext2D, b: BuildingView, sx: number, sy: number, z: number, dpr: number, now: number, plinthLevels: number, step: number) {
  // Pictures are made at a few sizes and scaled a little, so zooming does not make a new picture every frame.
  const want = z * dpr;
  const px = Math.max(8, Math.min(220, Math.round(Math.pow(1.18, Math.round(Math.log(Math.max(8, want)) / Math.log(1.18))))));
  const prog = b.progress >= 1 ? 10 : Math.min(9, Math.floor(b.progress * 10));
  const frame = b.kind === BuildingKind.Campfire ? Math.floor(now / 260 + b.id) % 2 : 0;
  const sp = sprite(b, prog, frame, px, plinthLevels * step);
  const scale = want / px;
  ctx.drawImage(sp.canvas, sx - (sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, (sp.canvas.width * scale) / dpr, (sp.canvas.height * scale) / dpr);
}

export function buildingName(kind: BuildingKind) {
  return BUILDINGS[kind].name;
}
