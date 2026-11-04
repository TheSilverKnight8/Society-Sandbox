import { hash2 } from '../lib/rng';
import { Deposit, Terrain } from '../map/terrain';
import { CREAM, NAVY, OBJ, SHADE } from './style';

// Drawings on the tiles, in the stick figures' style: navy outlines with round ends.
// The environment's marks (grass, hills, peaks, dunes, reeds, waves) are navy line art on
// cream; objects the simulation will act on (trees, deposits) have natural colors inside
// their navy outline. All sizes are in tile widths; `s` scales a drawing up when it stands
// for several tiles at once (zoomed far out).

type Ctx = CanvasRenderingContext2D;

function stroke(ctx: Ctx, color = NAVY) {
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** A colored line with a navy outline around it, like a stick figure's limb. */
function limb(ctx: Ctx, color: string) {
  const w = ctx.lineWidth;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = w * 2.4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w * 1.1;
  ctx.stroke();
  ctx.lineWidth = w;
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

/** A leafy tree: a brown trunk and a round green crown, like a stick figure's head on its body. */
export function tree(ctx: Ctx, px: number, py: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - 0.14 * s);
  limb(ctx, OBJ.trunk);
  ctx.beginPath();
  ctx.arc(px, py - 0.22 * s, 0.09 * s, 0, Math.PI * 2);
  fillStroke(ctx, OBJ.leaf);
}

/** A pine: a tall dark green triangle on a short brown trunk. */
export function pine(ctx: Ctx, px: number, py: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - 0.08 * s);
  limb(ctx, OBJ.trunk);
  ctx.beginPath();
  ctx.moveTo(px, py - 0.39 * s);
  ctx.lineTo(px + 0.09 * s, py - 0.075 * s);
  ctx.lineTo(px - 0.09 * s, py - 0.075 * s);
  ctx.closePath();
  fillStroke(ctx, OBJ.pine);
}

/** A rounded hill with its right side shaded, like the peaks. */
export function hill(ctx: Ctx, px: number, py: number, s: number) {
  const w = 0.25 * s;
  const h = 0.2 * s;
  const dome = () => {
    ctx.beginPath();
    ctx.moveTo(px - w, py);
    ctx.bezierCurveTo(px - w * 0.7, py - h * 1.3, px + w * 0.7, py - h * 1.3, px + w, py);
    ctx.closePath();
  };
  dome();
  ctx.fillStyle = CREAM;
  ctx.fill();
  // Shade the right part: clip to the dome and fill from a line just right of the top.
  ctx.save();
  dome();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(px + w * 0.12, py - h * 1.2);
  ctx.lineTo(px + w * 1.1, py - h * 1.2);
  ctx.lineTo(px + w * 1.1, py + 0.01);
  ctx.lineTo(px + w * 0.3, py + 0.01);
  ctx.closePath();
  ctx.fillStyle = SHADE;
  ctx.fill();
  ctx.restore();
  dome();
  ctx.strokeStyle = NAVY;
  ctx.stroke();
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
      if (r < 0.12) tuft(ctx, px + (hash2(x, y, 5) - 0.5) * 0.3, py + (hash2(x, y, 6) - 0.5) * 0.12, 1);
      break;
    case Terrain.Forest: {
      // About one tree a tile: a forest should still look like one.
      const count = r < 0.25 ? 2 : r < 0.82 ? 1 : 0;
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
      if (r < 0.22) hill(ctx, px + (hash2(x, y, 5) - 0.5) * 0.15, py + 0.05, 0.9 + hash2(x, y, 7) * 0.3);
      break;
    case Terrain.Mountain:
      if (r < 0.4) peak(ctx, px + (hash2(x, y, 5) - 0.5) * 0.12, py + 0.08, 0.85 + hash2(x, y, 7) * 0.35, false);
      break;
    case Terrain.Snow:
      if (r < 0.45) peak(ctx, px + (hash2(x, y, 5) - 0.5) * 0.12, py + 0.08, 0.9 + hash2(x, y, 7) * 0.35, true);
      break;
    case Terrain.Desert:
      if (r < 0.14) dunes(ctx, px, py, 1);
      break;
    case Terrain.Sand:
      if (r < 0.14) sandDots(ctx, px, py, 1, lw);
      break;
    case Terrain.Swamp:
      if (r < 0.32) reeds(ctx, px, py, 1);
      break;
    case Terrain.ShallowWater:
      if (r < 0.08) wave(ctx, px, py, 1, 0.75);
      break;
    case Terrain.DeepWater:
      if (r < 0.03) wave(ctx, px, py, 1, 0.45);
      break;
  }
}

/** Draws a larger biome drawing standing for the tiles around it (zoomed far out). */
export function biomeSparse(ctx: Ctx, t: number, x: number, y: number, h: number, px: number, py: number, s: number, lw: number) {
  const r = hash2(x, y, 9);
  switch (t) {
    case Terrain.Grassland:
      if (r < 0.25) tuft(ctx, px, py, s * 0.8);
      break;
    case Terrain.Forest: {
      const pines = h >= 5 || r < 0.3;
      const draw = pines ? pine : tree;
      draw(ctx, px - 0.09 * s, py - 0.02 * s, s * 0.75);
      draw(ctx, px + 0.08 * s, py + 0.02 * s, s * 0.75);
      break;
    }
    case Terrain.Hills:
      if (r < 0.5) hill(ctx, px, py, s * 0.8);
      break;
    case Terrain.Mountain:
      if (r < 0.7) peak(ctx, px, py, s * 0.75, false);
      break;
    case Terrain.Snow:
      peak(ctx, px, py, s * 0.8, true);
      break;
    case Terrain.Desert:
      if (r < 0.35) dunes(ctx, px, py, s * 0.8);
      break;
    case Terrain.Sand:
      if (r < 0.3) sandDots(ctx, px, py, s * 0.6, lw);
      break;
    case Terrain.Swamp:
      if (r < 0.6) reeds(ctx, px, py, s * 0.8);
      break;
    case Terrain.ShallowWater:
      if (r < 0.25) wave(ctx, px, py, s * 0.7, 0.7);
      break;
    case Terrain.DeepWater:
      if (r < 0.12) wave(ctx, px, py, s * 0.7, 0.4);
      break;
  }
}

/** A rock outline. */
function rock(ctx: Ctx, px: number, py: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.moveTo(px - r, py);
  ctx.lineTo(px - r * 0.75, py - r * 0.6);
  ctx.lineTo(px - r * 0.1, py - r * 0.85);
  ctx.lineTo(px + r * 0.7, py - r * 0.55);
  ctx.lineTo(px + r, py);
  ctx.closePath();
  fillStroke(ctx, fill);
}

/** Draws a deposit's marker on a tile. Small objects get a slightly thinner outline so their color still shows. */
export function deposit(ctx: Ctx, d: number, px: number, py: number, s0: number, lw0: number) {
  const s = s0 * 1.3;
  const lw = lw0 * 0.75;
  ctx.lineWidth = lw;
  drawDeposit(ctx, d, px, py, s, lw);
  ctx.lineWidth = lw0;
}

function drawDeposit(ctx: Ctx, d: number, px: number, py: number, s: number, lw: number) {
  switch (d) {
    case Deposit.Stone:
    case Deposit.Iron:
    case Deposit.Gold:
      rock(ctx, px - 0.06 * s, py, 0.085 * s, d === Deposit.Stone ? OBJ.stone : OBJ.oreRock);
      rock(ctx, px + 0.07 * s, py + 0.035 * s, 0.065 * s, d === Deposit.Stone ? OBJ.stone : OBJ.oreRock);
      if (d === Deposit.Iron) {
        // Rust-colored ore flecks.
        ctx.fillStyle = OBJ.iron;
        for (const [dx, dy] of [
          [-0.09, -0.03],
          [-0.04, -0.045],
          [0.07, 0.015],
        ]) {
          ctx.beginPath();
          ctx.arc(px + dx * s, py + dy * s, Math.max(lw * 0.9, 0.014 * s), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (d === Deposit.Gold) {
        // A gold glint.
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
        ctx.fillStyle = OBJ.gold;
        ctx.fill();
        ctx.lineWidth = lw * 0.6;
        ctx.strokeStyle = NAVY;
        ctx.stroke();
        ctx.lineWidth = lw;
      }
      break;
    case Deposit.Clay:
      ctx.beginPath();
      ctx.ellipse(px, py, 0.15 * s, 0.065 * s, 0, 0, Math.PI * 2);
      fillStroke(ctx, OBJ.clay);
      ctx.beginPath();
      ctx.moveTo(px - 0.07 * s, py - 0.015 * s);
      ctx.lineTo(px + 0.02 * s, py - 0.015 * s);
      ctx.moveTo(px - 0.03 * s, py + 0.02 * s);
      ctx.lineTo(px + 0.07 * s, py + 0.02 * s);
      stroke(ctx);
      break;
    case Deposit.Fish:
      // Silver fish, outlined in navy.
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
        fillStroke(ctx, OBJ.fish);
      }
      break;
    case Deposit.Berries: {
      // A green bush with red berries.
      ctx.beginPath();
      ctx.moveTo(px - 0.11 * s, py);
      ctx.arc(px - 0.055 * s, py - 0.025 * s, 0.06 * s, Math.PI * 0.9, Math.PI * 1.75);
      ctx.arc(px + 0.02 * s, py - 0.06 * s, 0.06 * s, Math.PI * 1.15, Math.PI * 1.95);
      ctx.arc(px + 0.07 * s, py - 0.02 * s, 0.05 * s, Math.PI * 1.4, Math.PI * 0.1);
      ctx.lineTo(px - 0.11 * s, py);
      ctx.closePath();
      fillStroke(ctx, OBJ.bush);
      ctx.fillStyle = OBJ.berry;
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
