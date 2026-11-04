import { hash2 } from '../lib/rng';
import { Deposit, Terrain } from '../map/terrain';
import { CREAM, NAVY, RED, SHADE, tint } from './style';

// Line drawings that say what a tile is, in the stick figures' style: navy outlines with
// round ends, cream fills, red only for small accents. All sizes are in tile widths; `s`
// scales a drawing up when it stands for several tiles at once (zoomed far out).

type Ctx = CanvasRenderingContext2D;

function stroke(ctx: Ctx, color = NAVY) {
  ctx.strokeStyle = color;
  ctx.stroke();
}

function fillStroke(ctx: Ctx, fill = CREAM) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = NAVY;
  ctx.stroke();
}

/** A tuft of grass: three blades from a short base, the outer ones bending outward. */
export function tuft(ctx: Ctx, px: number, py: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(px - 0.035 * s, py);
  ctx.quadraticCurveTo(px - 0.04 * s, py - 0.05 * s, px - 0.085 * s, py - 0.075 * s);
  ctx.moveTo(px, py);
  ctx.lineTo(px + 0.005 * s, py - 0.11 * s);
  ctx.moveTo(px + 0.035 * s, py);
  ctx.quadraticCurveTo(px + 0.045 * s, py - 0.05 * s, px + 0.09 * s, py - 0.07 * s);
  ctx.moveTo(px - 0.05 * s, py);
  ctx.lineTo(px + 0.05 * s, py);
  stroke(ctx);
}

/** A leafy tree: a ring on a stick, like a stick figure's head. */
export function tree(ctx: Ctx, px: number, py: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - 0.13 * s);
  stroke(ctx);
  ctx.beginPath();
  ctx.arc(px, py - 0.21 * s, 0.085 * s, 0, Math.PI * 2);
  fillStroke(ctx);
}

/** A pine: a tall triangle on a short trunk. */
export function pine(ctx: Ctx, px: number, py: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - 0.07 * s);
  stroke(ctx);
  ctx.beginPath();
  ctx.moveTo(px, py - 0.38 * s);
  ctx.lineTo(px + 0.085 * s, py - 0.07 * s);
  ctx.lineTo(px - 0.085 * s, py - 0.07 * s);
  ctx.closePath();
  fillStroke(ctx);
}

/** A rounded hill with its far side shaded. */
export function hill(ctx: Ctx, px: number, py: number, s: number) {
  const w = 0.2 * s;
  const h = 0.17 * s;
  ctx.beginPath();
  ctx.moveTo(px - w, py);
  ctx.quadraticCurveTo(px - w * 0.15, py - h * 1.9, px + w, py);
  ctx.closePath();
  fillStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(px + w * 0.25, py - h * 0.62);
  ctx.quadraticCurveTo(px + w * 0.7, py - h * 0.25, px + w * 0.62, py);
  stroke(ctx);
}

/** A mountain peak, its right side shaded. Snowy peaks are taller, with a snow line and a cream cap. */
export function peak(ctx: Ctx, px: number, py: number, s: number, snow: boolean) {
  const w = 0.24 * s;
  const h = (snow ? 0.5 : 0.42) * s;
  const tx = px - 0.02 * s;
  const ty = py - h;
  const mx = px + 0.04 * s; // where the shading meets the ground
  ctx.beginPath();
  ctx.moveTo(px - w, py);
  ctx.lineTo(tx, ty);
  ctx.lineTo(px + w, py);
  ctx.closePath();
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(px + w, py);
  ctx.lineTo(mx, py);
  ctx.closePath();
  ctx.fillStyle = SHADE;
  ctx.fill();
  const k = 0.42;
  const lx = tx + (px - w - tx) * k;
  const rx = tx + (px + w - tx) * k;
  const sy = ty + h * k;
  if (snow) {
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(rx, sy);
    ctx.lineTo(tx + (mx - tx) * k, sy);
    ctx.closePath();
    ctx.fillStyle = CREAM;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(px - w, py);
  ctx.lineTo(tx, ty);
  ctx.lineTo(px + w, py);
  stroke(ctx);
  if (snow) {
    ctx.beginPath();
    ctx.moveTo(lx, sy);
    ctx.lineTo(lx + (rx - lx) * 0.25, sy - h * 0.08);
    ctx.lineTo(lx + (rx - lx) * 0.5, sy + h * 0.02);
    ctx.lineTo(lx + (rx - lx) * 0.75, sy - h * 0.08);
    ctx.lineTo(rx, sy);
    stroke(ctx);
  }
}

/** Two dune crests. */
export function dunes(ctx: Ctx, px: number, py: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(px - 0.2 * s, py - 0.01 * s);
  ctx.quadraticCurveTo(px - 0.09 * s, py - 0.1 * s, px + 0.02 * s, py - 0.01 * s);
  ctx.moveTo(px - 0.02 * s, py + 0.06 * s);
  ctx.quadraticCurveTo(px + 0.09 * s, py - 0.03 * s, px + 0.2 * s, py + 0.06 * s);
  stroke(ctx);
}

/** A few dots of sand. */
export function sandDots(ctx: Ctx, px: number, py: number, s: number, lw: number) {
  ctx.fillStyle = NAVY;
  for (const [dx, dy] of [
    [-0.09, 0],
    [0.02, -0.03],
    [0.1, 0.02],
    [-0.02, 0.05],
  ]) {
    ctx.beginPath();
    ctx.arc(px + dx * s, py + dy * s, lw * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Reeds standing in still water. */
export function reeds(ctx: Ctx, px: number, py: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(px - 0.17 * s, py + 0.04 * s);
  ctx.lineTo(px - 0.04 * s, py + 0.04 * s);
  ctx.moveTo(px + 0.06 * s, py + 0.07 * s);
  ctx.lineTo(px + 0.18 * s, py + 0.07 * s);
  for (const dx of [-0.05, 0.01, 0.07]) {
    ctx.moveTo(px + dx * s, py + 0.02 * s);
    ctx.lineTo(px + dx * s + 0.01 * s, py - 0.14 * s);
  }
  stroke(ctx);
  ctx.fillStyle = NAVY;
  for (const dx of [-0.05, 0.07]) {
    ctx.beginPath();
    ctx.ellipse(px + dx * s + 0.01 * s, py - 0.13 * s, 0.014 * s, 0.035 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A small wave on water, in cream. */
export function wave(ctx: Ctx, px: number, py: number, s: number, alpha: number) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(px - 0.12 * s, py);
  ctx.quadraticCurveTo(px - 0.06 * s, py - 0.05 * s, px, py);
  ctx.quadraticCurveTo(px + 0.06 * s, py + 0.05 * s, px + 0.12 * s, py);
  stroke(ctx, CREAM);
  ctx.globalAlpha = 1;
}

/** Draws the biome drawing for one tile (full detail: about one per tile). */
export function biomeDetail(ctx: Ctx, t: number, x: number, y: number, h: number, px: number, py: number, lw: number) {
  const r = hash2(x, y, 3);
  switch (t) {
    case Terrain.Grassland:
      if (r < 0.32) tuft(ctx, px + (hash2(x, y, 5) - 0.5) * 0.3, py + (hash2(x, y, 6) - 0.5) * 0.12, 1);
      break;
    case Terrain.Forest: {
      const count = 1 + (r < 0.6 ? 1 : 0);
      const spots: [number, number][] = [];
      for (let k = 0; k < count; k++) spots.push([0.2 + hash2(x, y, 11 + k) * 0.6, 0.2 + hash2(x, y, 23 + k) * 0.6]);
      spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      const pines = h >= 5 || hash2(x, y, 31) < 0.3;
      for (const [u, v] of spots) {
        const tx = px + (u - v) * 0.5;
        const ty = py - 0.25 + (u + v) * 0.25;
        if (pines) pine(ctx, tx, ty, 1);
        else tree(ctx, tx, ty, 1);
      }
      break;
    }
    case Terrain.Hills:
      if (r < 0.55) hill(ctx, px + (hash2(x, y, 5) - 0.5) * 0.15, py + 0.05, 0.9 + hash2(x, y, 7) * 0.3);
      break;
    case Terrain.Mountain:
      if (r < 0.78) peak(ctx, px + (hash2(x, y, 5) - 0.5) * 0.12, py + 0.08, 0.85 + hash2(x, y, 7) * 0.35, false);
      break;
    case Terrain.Snow:
      if (r < 0.82) peak(ctx, px + (hash2(x, y, 5) - 0.5) * 0.12, py + 0.08, 0.9 + hash2(x, y, 7) * 0.35, true);
      break;
    case Terrain.Desert:
      if (r < 0.35) dunes(ctx, px, py, 1);
      break;
    case Terrain.Sand:
      if (r < 0.5) sandDots(ctx, px, py, 1, lw);
      break;
    case Terrain.Swamp:
      if (r < 0.7) reeds(ctx, px, py, 1);
      break;
    case Terrain.ShallowWater:
      if (r < 0.18) wave(ctx, px, py, 1, 0.75);
      break;
    case Terrain.DeepWater:
      if (r < 0.07) wave(ctx, px, py, 1, 0.45);
      break;
  }
}

/** Draws a larger biome drawing standing for the tiles around it (zoomed far out). */
export function biomeSparse(ctx: Ctx, t: number, x: number, y: number, h: number, px: number, py: number, s: number, lw: number) {
  const r = hash2(x, y, 9);
  switch (t) {
    case Terrain.Grassland:
      if (r < 0.55) tuft(ctx, px, py, s * 0.8);
      break;
    case Terrain.Forest: {
      const pines = h >= 5 || r < 0.3;
      const draw = pines ? pine : tree;
      draw(ctx, px - 0.09 * s, py - 0.02 * s, s * 0.75);
      draw(ctx, px + 0.08 * s, py + 0.02 * s, s * 0.75);
      break;
    }
    case Terrain.Hills:
      hill(ctx, px, py, s * 0.8);
      break;
    case Terrain.Mountain:
      peak(ctx, px, py, s * 0.75, false);
      break;
    case Terrain.Snow:
      peak(ctx, px, py, s * 0.8, true);
      break;
    case Terrain.Desert:
      if (r < 0.8) dunes(ctx, px, py, s * 0.8);
      break;
    case Terrain.Sand:
      if (r < 0.6) sandDots(ctx, px, py, s * 0.6, lw);
      break;
    case Terrain.Swamp:
      reeds(ctx, px, py, s * 0.8);
      break;
    case Terrain.ShallowWater:
      if (r < 0.5) wave(ctx, px, py, s * 0.7, 0.7);
      break;
    case Terrain.DeepWater:
      if (r < 0.3) wave(ctx, px, py, s * 0.7, 0.4);
      break;
  }
}

/** A rock outline. */
function rock(ctx: Ctx, px: number, py: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(px - r, py);
  ctx.lineTo(px - r * 0.75, py - r * 0.6);
  ctx.lineTo(px - r * 0.1, py - r * 0.85);
  ctx.lineTo(px + r * 0.7, py - r * 0.55);
  ctx.lineTo(px + r, py);
  ctx.closePath();
  fillStroke(ctx);
}

/** Draws a deposit's marker on a tile. */
export function deposit(ctx: Ctx, d: number, px: number, py: number, s: number, lw: number) {
  switch (d) {
    case Deposit.Stone:
    case Deposit.Iron:
    case Deposit.Gold:
      rock(ctx, px - 0.06 * s, py, 0.085 * s);
      rock(ctx, px + 0.07 * s, py + 0.035 * s, 0.065 * s);
      if (d === Deposit.Iron) {
        // Dark ore flecks.
        ctx.fillStyle = NAVY;
        for (const [dx, dy] of [
          [-0.09, -0.03],
          [-0.04, -0.045],
          [0.07, 0.015],
        ]) {
          ctx.beginPath();
          ctx.arc(px + dx * s, py + dy * s, lw * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (d === Deposit.Gold) {
        // A red glint.
        const gx = px - 0.06 * s;
        const gy = py - 0.06 * s;
        const g = 0.045 * s;
        ctx.beginPath();
        ctx.moveTo(gx, gy - g);
        ctx.lineTo(gx + g * 0.3, gy - g * 0.3);
        ctx.lineTo(gx + g, gy);
        ctx.lineTo(gx + g * 0.3, gy + g * 0.3);
        ctx.lineTo(gx, gy + g);
        ctx.lineTo(gx - g * 0.3, gy + g * 0.3);
        ctx.lineTo(gx - g, gy);
        ctx.lineTo(gx - g * 0.3, gy - g * 0.3);
        ctx.closePath();
        ctx.fillStyle = RED;
        ctx.fill();
      }
      break;
    case Deposit.Clay:
      ctx.beginPath();
      ctx.ellipse(px, py, 0.15 * s, 0.065 * s, 0, 0, Math.PI * 2);
      fillStroke(ctx, tint(0.16));
      ctx.beginPath();
      ctx.moveTo(px - 0.07 * s, py - 0.015 * s);
      ctx.lineTo(px + 0.02 * s, py - 0.015 * s);
      ctx.moveTo(px - 0.03 * s, py + 0.02 * s);
      ctx.lineTo(px + 0.07 * s, py + 0.02 * s);
      stroke(ctx);
      break;
    case Deposit.Fish:
      // Fish outlines in cream, on the water.
      for (const [dx, dy, dir] of [
        [-0.07, -0.015, 1],
        [0.07, 0.035, -1],
      ]) {
        const fx = px + dx * s;
        const fy = py + dy * s;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 0.05 * s, 0.022 * s, 0, 0, Math.PI * 2);
        ctx.moveTo(fx - dir * 0.05 * s, fy);
        ctx.lineTo(fx - dir * 0.085 * s, fy - 0.025 * s);
        ctx.lineTo(fx - dir * 0.085 * s, fy + 0.025 * s);
        ctx.closePath();
        stroke(ctx, CREAM);
      }
      break;
    case Deposit.Berries: {
      // A bush with red berries.
      ctx.beginPath();
      ctx.moveTo(px - 0.11 * s, py);
      ctx.arc(px - 0.055 * s, py - 0.025 * s, 0.06 * s, Math.PI * 0.9, Math.PI * 1.75);
      ctx.arc(px + 0.02 * s, py - 0.06 * s, 0.06 * s, Math.PI * 1.15, Math.PI * 1.95);
      ctx.arc(px + 0.07 * s, py - 0.02 * s, 0.05 * s, Math.PI * 1.4, Math.PI * 0.1);
      ctx.lineTo(px - 0.11 * s, py);
      ctx.closePath();
      fillStroke(ctx);
      ctx.fillStyle = RED;
      for (const [dx, dy] of [
        [-0.05, -0.04],
        [0.01, -0.07],
        [0.06, -0.03],
        [0.0, -0.02],
      ]) {
        ctx.beginPath();
        ctx.arc(px + dx * s, py + dy * s, 0.017 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}
