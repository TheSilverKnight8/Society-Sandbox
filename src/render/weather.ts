import type { WeatherView } from '../sim/types';
import { isoX, isoY } from './iso';
import type { IsoView } from './IsoView';
import { NAVY } from './style';

// The weather and disasters drawn over the map (Stage 6). On the ground, under people and
// buildings: a pale wash in winter, a dry tint over droughts, water over flooded land. In the
// air, over everything: rain, snow, fog and storms inside each front, flames on burning forest,
// and swarms of locusts.

/** A cheap repeatable number in [0, 1) for particle k. */
function hash(k: number) {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The screen ellipse of a circle on the ground (radius r tiles around x, y). */
function ellipse(view: IsoView, x: number, y: number, r: number, h = 4): [number, number, number, number] {
  const [cx, cy] = view.toScreen(isoX(x, y), isoY(x, y, h));
  const z = view.cam.zoom;
  return [cx, cy, r * 0.707 * z, r * 0.354 * z];
}

function onScreen(view: IsoView, cx: number, cy: number, rx: number, ry: number) {
  return cx + rx > 0 && cx - rx < view.width && cy + ry > -60 && cy - ry < view.height + 60;
}

/** On the ground: winter, droughts, floods. */
export function drawWeatherGround(ctx: CanvasRenderingContext2D, view: IsoView, w: WeatherView | null) {
  if (!w) return;
  // Winter: a cold pale wash over the land.
  if (w.season === 3) {
    ctx.fillStyle = 'rgba(238, 244, 252, 0.36)';
    ctx.fillRect(0, 0, view.width, view.height);
  }
  for (const d of w.droughts) {
    const [cx, cy, rx, ry] = ellipse(view, d.x, d.y, d.r);
    if (!onScreen(view, cx, cy, rx, ry)) continue;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, 'rgba(214, 168, 78, 0.24)');
    g.addColorStop(1, 'rgba(214, 168, 78, 0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (w.flooded.length) {
    const size = view.src.size;
    ctx.beginPath();
    for (const t of w.flooded) {
      const x = t % size;
      const y = (t - x) / size;
      const [sx, sy] = view.toScreen(isoX(x, y), isoY(x, y, view.src.elevation[t]));
      if (sx < -40 || sy < -40 || sx > view.width + 40 || sy > view.height + 40) continue;
      view.traceTile(ctx, x, y);
    }
    ctx.fillStyle = 'rgba(74, 140, 196, 0.5)';
    ctx.fill();
  }
}

/** In the air: rain, snow, fog, storms, burning forest, locusts. */
export function drawWeatherSky(ctx: CanvasRenderingContext2D, view: IsoView, w: WeatherView | null, now: number) {
  if (!w) return;
  const z = view.cam.zoom;
  const t = now / 1000;
  for (let i = 0; i < w.fronts.length; i++) {
    const f = w.fronts[i];
    const [cx, cy, rx, ry] = ellipse(view, f.x, f.y, f.r, 6);
    if (!onScreen(view, cx, cy, rx, ry + 80)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry + Math.min(80, z * 2), 0, 0, Math.PI * 2);
    ctx.clip();
    if (f.kind === 'fog') {
      // Drifting banks of fog.
      for (let k = 0; k < 14; k++) {
        const px = cx + (hash(k + i * 31) - 0.5) * 2 * rx + Math.sin(t * 0.3 + k) * z * 0.6;
        const py = cy + (hash(k * 7 + i * 13) - 0.5) * 2 * ry;
        ctx.beginPath();
        ctx.ellipse(px, py, rx * 0.35, ry * 0.4, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(246, 246, 242, 0.32)';
        ctx.fill();
      }
      ctx.restore();
      continue;
    }
    // Clouds dim the land under rain and storms a little.
    if (f.kind !== 'snow') {
      ctx.fillStyle = f.kind === 'storm' ? 'rgba(40, 52, 74, 0.2)' : 'rgba(60, 74, 96, 0.1)';
      ctx.fillRect(cx - rx, cy - ry - 80, rx * 2, ry * 2 + 160);
    }
    const count = Math.min(f.kind === 'storm' ? 420 : 300, Math.round((rx * ry) / (f.kind === 'snow' ? 260 : 180)));
    const fall = f.kind === 'snow' ? 30 : 260;
    const H = ry * 2 + 160;
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const px = cx + (hash(k + i * 1000) - 0.5) * 2 * rx;
      const phase = hash(k * 3 + i * 7 + 1) * H;
      const py = cy - ry - 80 + ((phase + t * fall) % H);
      if (f.kind === 'snow') {
        const sx = px + Math.sin(t * 1.5 + k) * 3;
        ctx.moveTo(sx + 2.3, py);
        ctx.arc(sx, py, 2.3, 0, Math.PI * 2);
      } else {
        ctx.moveTo(px, py);
        ctx.lineTo(px - 2, py + 10);
      }
    }
    if (f.kind === 'snow') {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 38, 87, 0.45)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    } else {
      ctx.strokeStyle = f.kind === 'storm' ? 'rgba(30, 56, 104, 0.7)' : 'rgba(40, 84, 150, 0.6)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    // A storm's lightning: now and then a flash and a bolt.
    if (f.kind === 'storm') {
      const beat = Math.floor(t * 1.2 + i * 3.7);
      const since = t * 1.2 + i * 3.7 - beat;
      if (hash(beat) < 0.3 && since < 0.12) {
        ctx.fillStyle = 'rgba(255, 255, 240, 0.35)';
        ctx.fillRect(cx - rx, cy - ry - 80, rx * 2, ry * 2 + 160);
        const bx = cx + (hash(beat * 3) - 0.5) * rx;
        const by = cy + (hash(beat * 5) - 0.5) * ry;
        ctx.beginPath();
        ctx.moveTo(bx, by - Math.min(140, z * 4));
        let yy = by - Math.min(140, z * 4);
        let xx = bx;
        while (yy < by) {
          yy += 10;
          xx += (hash(yy + beat) - 0.5) * 12;
          ctx.lineTo(xx, Math.min(yy, by));
        }
        ctx.strokeStyle = '#fff8c8';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.strokeStyle = NAVY;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // Burning forest: flames on each tile.
  if (w.burning.length) {
    const size = view.src.size;
    for (const tile of w.burning) {
      const x = tile % size;
      const y = (tile - x) / size;
      const [sx, sy] = view.toScreen(isoX(x + 0.5, y + 0.5), isoY(x + 0.5, y + 0.5, view.src.elevation[tile]));
      if (sx < -30 || sy < -60 || sx > view.width + 30 || sy > view.height + 30) continue;
      const s = Math.max(3, z * 0.35);
      for (let k = 0; k < 2; k++) {
        const fx = sx + (k ? 0.25 : -0.2) * s;
        const flick = 0.75 + 0.25 * Math.sin(t * 9 + tile + k * 2);
        ctx.beginPath();
        ctx.moveTo(fx - s * 0.32, sy);
        ctx.quadraticCurveTo(fx - s * 0.3, sy - s * 0.9 * flick, fx, sy - s * 1.4 * flick);
        ctx.quadraticCurveTo(fx + s * 0.3, sy - s * 0.9 * flick, fx + s * 0.32, sy);
        ctx.closePath();
        ctx.fillStyle = k ? '#f5c542' : '#e8562a';
        ctx.fill();
        ctx.lineWidth = Math.max(0.7, z * 0.015);
        ctx.strokeStyle = NAVY;
        ctx.stroke();
      }
    }
  }
  // Locusts: a cloud of dark specks.
  for (let i = 0; i < w.swarms.length; i++) {
    const sw = w.swarms[i];
    const [cx, cy, rx, ry] = ellipse(view, sw.x, sw.y, sw.r, 8);
    if (!onScreen(view, cx, cy, rx, ry)) continue;
    ctx.beginPath();
    const n = Math.min(260, Math.round((rx * ry) / 40));
    for (let k = 0; k < n; k++) {
      const a = hash(k + i * 500) * Math.PI * 2 + t * (0.6 + hash(k) * 0.8);
      const r = Math.sqrt(hash(k * 13 + i)) ;
      const px = cx + Math.cos(a) * rx * r;
      const py = cy + Math.sin(a) * ry * r - Math.abs(Math.sin(t * 3 + k)) * 6;
      ctx.moveTo(px + 1.2, py);
      ctx.arc(px, py, 1.2, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(58, 52, 30, 0.75)';
    ctx.fill();
  }
}
