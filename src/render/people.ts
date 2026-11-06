import { CLOTHES, HAIRS, SKINS, unpackLook } from '../sim/look';
import type { SimClient } from '../sim/client';
import { AgeLook, Pose, type BuildingView } from '../sim/types';
import { BUILDINGS } from '../sim/buildings';
import { drawBuilding } from './buildings';
import { STEP, isoX, isoY } from './iso';
import type { IsoView } from './IsoView';
import { NAVY } from './style';
import { NATION_COLORS } from '../sim/nations';
import { creatureColor, creatureSprite } from './creatures';

// Draws people as small stick figures in Stickman Arena's style: a round head, a tunic
// (a long dress for women), arms and legs, in skin and clothing colors inside a navy
// outline. Each look, pose and size is drawn once into a small picture and reused.
// Zoomed far out, a person is a dot in their clothing color.

/** A person's height, in tile widths. */
const HEIGHT = 0.63;
/** Below this height on screen (device pixels), people are dots. */
const MIN_FIGURE_PX = 10;
const LEGS = '#5a4232';
/** Wood, iron, mail, steel and a horse's coat, for soldiers' arms. */
const WOOD = '#8a5a34';
const IRON = '#6f747b';
const MAIL = '#9aa3ad';
const STEEL = '#d3d9e0';
const HORSE = '#9a6440';
const HORSE_DARK = '#5e3a24';
/** Elders' hair. */
const GREY = '#cfcbc4';
/** How tall children are drawn, against an adult. */
const AGE_SCALE = [1, 0.5, 0.72, 0.97];

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the feet are in the picture. */
  ax: number;
  ay: number;
}

const sprites = new Map<string, Sprite>();

/** Extra marks on a figure (Stage 6): a criminal's hood, a sick person's pallor. */
const HOOD = 1;
const SICK = 2;

function sprite(look: number, male: boolean, pose: number, frame: number, px: number, elder: boolean, carrying = false, crown = false, gear = 0, boat = false, fight = false, extra = 0): Sprite {
  const key = `${look}|${male ? 1 : 0}|${pose}|${frame}|${px}|${elder ? 1 : 0}|${carrying ? 1 : 0}|${crown ? 1 : 0}|${gear}|${boat ? 1 : 0}|${fight ? 1 : 0}|${extra}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  if (sprites.size > 4000) sprites.clear();
  const s = pose === Pose.Sleep && !boat ? drawSleeping(look, male, px, elder) : drawStanding(look, male, pose === Pose.Sleep ? Pose.Stand : pose, frame, px, elder, carrying, crown, gear, boat, fight, extra);
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
function drawSleeping(look: number, male: boolean, px: number, elder: boolean, z = true): Sprite {
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
  ctx.fillStyle = elder ? GREY : HAIRS[hair];
  ctx.fillRect(-0.46 * H, -0.24 * H, 0.1 * H, 0.3 * H);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(-0.32 * H, -0.1 * H, 0.12 * H, 0, Math.PI * 2);
  ctx.strokeStyle = NAVY;
  ctx.stroke();
  // A "z" above the head.
  if (z && H >= 18) {
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

function drawStanding(look: number, male: boolean, pose: number, frame: number, px: number, elder: boolean, carrying: boolean, crown: boolean, gear = 0, boat = false, fight = false, extra = 0): Sprite {
  const H = px;
  const lw = Math.max(1.2, H * 0.08);
  // A soldier's arms (see Snapshot.gear): weapon, armor, horse, catapult, leader's banner, nation color.
  const weapon = gear & 7;
  const armor = (gear >> 3) & 3;
  const horse = (gear & 32) !== 0;
  const engine = (gear & 64) !== 0;
  const leader = (gear & 128) !== 0;
  const soldier = gear !== 0;
  const nationC = gear >> 8 ? NATION_COLORS[(gear >> 8) - 1] : null;
  const lift = horse ? 0.34 : 0;
  // A fighter's swing or thrust reaches further out (frame 0: raised or drawn; frame 1: the blow).
  const strike = fight && frame === 1;
  const w = Math.ceil(H * (engine ? 1.3 : horse ? 1.25 : fight && soldier ? 1.35 : soldier || boat ? 0.9 : 0.7) + lw * 2);
  const h = Math.ceil(H * ((crown ? 1.22 : 1.06) + lift + (leader ? 0.36 : weapon === 1 ? 0.2 : 0)) + lw * 2);
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
  const hairC = elder ? GREY : HAIRS[hair];
  const clothC = CLOTHES[clothes];
  const work = pose === Pose.Work;
  const swing = work ? 0 : frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const limb = limbOf(ctx, H, lw);
  const limbW = Math.max(1.3, H * 0.08);
  const outline = (fill: string, width = lw) => {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  // A catapult beside an artillery soldier.
  if (engine) {
    limb(
      [
        [0.22, -0.08],
        [0.58, -0.08],
      ],
      WOOD,
      limbW * 1.4,
    );
    limb(
      [
        [0.3, -0.1],
        [0.52, -0.46],
      ],
      WOOD,
      limbW,
    );
    ctx.beginPath();
    ctx.arc(0.53 * H, -0.48 * H, 0.05 * H, 0, Math.PI * 2);
    outline('#8c8c8c', lw * 0.8);
    for (const x of [0.27, 0.53]) {
      ctx.beginPath();
      ctx.arc(x * H, -0.05 * H, 0.06 * H, 0, Math.PI * 2);
      outline(WOOD, lw * 0.8);
    }
  }
  // A horse under a rider (drawn facing right), then the rider sits higher.
  if (horse) {
    // Tail, then legs in pairs (back and front), body, neck and head.
    limb(
      [
        [-0.3, -0.4],
        [-0.38, -0.2],
      ],
      HORSE_DARK,
      limbW * 0.9,
    );
    for (const x of [-0.24, -0.17, 0.17, 0.24]) {
      const step = frame % 2 === 1 ? (x > 0 ? 0.04 : -0.04) * (Math.abs(x) > 0.2 ? 1 : -1) : 0;
      limb(
        [
          [x, -0.32],
          [x + step, 0],
        ],
        x === -0.17 || x === 0.17 ? HORSE_DARK : HORSE,
        limbW * 0.85,
      );
    }
    ctx.beginPath();
    ctx.ellipse(0, -0.38 * H, 0.3 * H, 0.11 * H, 0, 0, Math.PI * 2);
    outline(HORSE);
    ctx.beginPath();
    ctx.moveTo(0.18 * H, -0.44 * H);
    ctx.lineTo(0.3 * H, -0.66 * H);
    ctx.lineTo(0.39 * H, -0.62 * H);
    ctx.lineTo(0.3 * H, -0.36 * H);
    ctx.closePath();
    outline(HORSE);
    ctx.beginPath();
    ctx.ellipse(0.41 * H, -0.59 * H, 0.11 * H, 0.05 * H, 0.55, 0, Math.PI * 2);
    outline(HORSE);
    limb(
      [
        [0.21, -0.47],
        [0.31, -0.66],
      ],
      HORSE_DARK,
      limbW * 0.7,
    );
    if (nationC) {
      // A saddlecloth in the nation's color.
      ctx.beginPath();
      ctx.rect(-0.13 * H, -0.47 * H, 0.2 * H, 0.15 * H);
      outline(nationC, lw * 0.8);
    }
    ctx.translate(0, -lift * H);
  }
  // A leader carries their nation's banner.
  if (leader) {
    limb(
      [
        [-0.2, -0.3],
        [-0.2, -1.36],
      ],
      WOOD,
      limbW * 0.8,
    );
    ctx.beginPath();
    ctx.moveTo(-0.2 * H, -1.36 * H);
    ctx.lineTo(0.12 * H, -1.3 * H);
    ctx.lineTo(-0.2 * H, -1.14 * H);
    ctx.closePath();
    outline(nationC ?? '#fc3f3f', lw * 0.8);
  }
  // A bow or crossbow is held out in front; a spear stands beside them (thrust forward in a fight).
  if (weapon === 1 && !strike) {
    limb(
      [
        [0.2, 0.02],
        [0.2, -1.2],
      ],
      WOOD,
      limbW * 0.75,
    );
    ctx.beginPath();
    ctx.moveTo(0.16 * H, -1.18 * H);
    ctx.lineTo(0.2 * H, -1.32 * H);
    ctx.lineTo(0.24 * H, -1.18 * H);
    ctx.closePath();
    outline(STEEL, lw * 0.7);
  }

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
  // Legs (a rider's hang at the horse's side).
  const hem = male || soldier ? -0.3 : -0.07;
  if (horse) {
    limb(
      [
        [0.02, hem],
        [0.06, -0.08],
      ],
      LEGS,
      limbW,
    );
  } else {
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
  }
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
  // A sack on the back when carrying goods (SPEC 8: goods are carried by individuals).
  if (carrying) {
    ctx.beginPath();
    ctx.ellipse(0.13 * H, -0.62 * H, 0.1 * H, 0.12 * H, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#c8a26a';
    ctx.fill();
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  // Tunic, or a long dress; soldiers wear their nation's color.
  const short = male || soldier;
  ctx.beginPath();
  ctx.moveTo(-0.1 * H, -0.68 * H);
  ctx.lineTo(0.1 * H, -0.68 * H);
  ctx.lineTo((short ? 0.14 : 0.16) * H, hem * H);
  ctx.lineTo(-(short ? 0.14 : 0.16) * H, hem * H);
  ctx.closePath();
  outline(nationC ?? clothC);
  // Armor over the tunic: mail (grey, to the waist) or plate (bright steel, with a breastplate line).
  if (armor) {
    ctx.beginPath();
    ctx.moveTo(-0.11 * H, -0.69 * H);
    ctx.lineTo(0.11 * H, -0.69 * H);
    ctx.lineTo(0.125 * H, -0.44 * H);
    ctx.lineTo(-0.125 * H, -0.44 * H);
    ctx.closePath();
    outline(armor === 2 ? STEEL : MAIL);
    if (armor === 2) {
      ctx.beginPath();
      ctx.moveTo(0, -0.66 * H);
      ctx.lineTo(0, -0.47 * H);
      ctx.strokeStyle = NAVY;
      ctx.lineWidth = lw * 0.6;
      ctx.stroke();
    }
  }
  // In a boat crossing water: a wooden hull up to the waist, and an oar.
  if (boat) {
    limb(
      [
        [0.14, -0.42],
        [0.34, -0.02],
      ],
      WOOD,
      limbW * 0.8,
    );
    ctx.beginPath();
    ctx.moveTo(-0.36 * H, -0.32 * H);
    ctx.lineTo(0.36 * H, -0.32 * H);
    ctx.quadraticCurveTo(0.3 * H, -0.02 * H, 0.18 * H, 0);
    ctx.lineTo(-0.18 * H, 0);
    ctx.quadraticCurveTo(-0.3 * H, -0.02 * H, -0.36 * H, -0.32 * H);
    ctx.closePath();
    outline(WOOD);
  }
  // Head, then hair on top. (Someone sick looks pale and greenish.)
  ctx.beginPath();
  ctx.arc(0, -0.84 * H, 0.13 * H, 0, Math.PI * 2);
  ctx.fillStyle = extra & SICK ? '#c9cf9a' : skinC;
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
  // A criminal wears a dark hood over their head and shoulders.
  if (extra & HOOD && !soldier && !crown) {
    ctx.beginPath();
    ctx.moveTo(-0.17 * H, -0.66 * H);
    ctx.quadraticCurveTo(-0.2 * H, -1.02 * H, 0, -1.03 * H);
    ctx.quadraticCurveTo(0.2 * H, -1.02 * H, 0.17 * H, -0.66 * H);
    ctx.lineTo(0.09 * H, -0.7 * H);
    ctx.quadraticCurveTo(0.1 * H, -0.95 * H, 0, -0.95 * H);
    ctx.quadraticCurveTo(-0.1 * H, -0.95 * H, -0.09 * H, -0.7 * H);
    ctx.closePath();
    ctx.fillStyle = '#3d3a36';
    ctx.fill();
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  // Soldiers wear a helmet: an iron cap, or a steel helm with plate.
  if (soldier && !crown) {
    ctx.beginPath();
    ctx.arc(0, -0.86 * H, 0.14 * H, Math.PI, 0);
    ctx.closePath();
    outline(armor === 2 ? STEEL : IRON);
  }
  // A spear thrust forward.
  if (weapon === 1 && strike) {
    limb(
      [
        [-0.1, -0.5],
        [0.58, -0.56],
      ],
      WOOD,
      limbW * 0.75,
    );
    ctx.beginPath();
    ctx.moveTo(0.56 * H, -0.6 * H);
    ctx.lineTo(0.68 * H, -0.57 * H);
    ctx.lineTo(0.56 * H, -0.52 * H);
    ctx.closePath();
    outline(STEEL, lw * 0.7);
  }
  // Swords are held up in the right hand (raised overhead, then swung forward, in a fight); bows and crossbows out in front.
  if (weapon === 2) {
    const [hand, tip]: [number, number][] = fight ? (strike ? [[0.16, -0.46], [0.56, -0.38]] : [[0.12, -0.62], [0.02, -1.06]]) : [[0.15, -0.42], [0.3, -0.78]];
    limb([hand, tip], STEEL, limbW * 0.8);
    const gx = hand[0] - (tip[1] - hand[1]) * 0.25;
    const gy = hand[1] + (tip[0] - hand[0]) * 0.25;
    limb(
      [
        [hand[0] * 2 - gx, hand[1] * 2 - gy],
        [gx, gy],
      ],
      WOOD,
      limbW * 0.7,
    );
  } else if (weapon === 3 || weapon === 4) {
    ctx.beginPath();
    ctx.arc(0.08 * H, -0.5 * H, 0.2 * H, -1.1, 1.1);
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = limbW * 0.8 + lw * 1.6;
    ctx.stroke();
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = limbW * 0.8;
    ctx.stroke();
    if (weapon === 4) {
      limb(
        [
          [0.0, -0.5],
          [0.3, -0.5],
        ],
        WOOD,
        limbW,
      );
    }
    // In a fight the string is drawn back with an arrow on it, then loosed.
    const ends: [number, number][] = [
      [0.08 + 0.2 * Math.cos(-1.1), -0.5 + 0.2 * Math.sin(-1.1)],
      [0.08 + 0.2 * Math.cos(1.1), -0.5 + 0.2 * Math.sin(1.1)],
    ];
    const pull = fight && !strike ? -0.08 : ends[0][0];
    ctx.beginPath();
    ctx.moveTo(ends[0][0] * H, ends[0][1] * H);
    ctx.lineTo(pull * H, -0.5 * H);
    ctx.lineTo(ends[1][0] * H, ends[1][1] * H);
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = Math.max(0.8, lw * 0.5);
    ctx.stroke();
    if (fight && !strike) limb([[pull, -0.5], [0.34, -0.5]], WOOD, limbW * 0.45);
  }
  // A ruler wears a gold crown.
  if (crown) {
    ctx.beginPath();
    ctx.moveTo(-0.11 * H, -0.94 * H);
    ctx.lineTo(-0.12 * H, -1.1 * H);
    ctx.lineTo(-0.055 * H, -1.02 * H);
    ctx.lineTo(0, -1.12 * H);
    ctx.lineTo(0.055 * H, -1.02 * H);
    ctx.lineTo(0.12 * H, -1.1 * H);
    ctx.lineTo(0.11 * H, -0.94 * H);
    ctx.closePath();
    ctx.fillStyle = '#f2c230';
    ctx.fill();
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = lw * 0.8;
    ctx.stroke();
  }
  return { canvas, ax, ay };
}

/** Positions of people this frame, kept between frames to avoid making garbage. */
let buf = new Float32Array(0);
let order = new Int32Array(0);

/**
 * Draws everything standing on the map, back to front: people and buildings together, so
 * someone behind a house is hidden by it. People asleep in their homes are not drawn.
 */
export function drawPeople(
  ctx: CanvasRenderingContext2D,
  view: IsoView,
  client: SimClient,
  now: number,
  selected: ReadonlySet<number>,
  buildings: readonly BuildingView[] = [],
  selectedSettlement: number | null = null,
  selectedCreature: number | null = null,
) {
  const n = client.population + buildings.length + Math.ceil((client.latest?.creatures?.length ?? 0) / 5);
  if (!n) return;
  if (buf.length < n * 7) {
    buf = new Float32Array(n * 7 + 600);
    order = new Int32Array(n + 100);
  }
  const { size, elevation } = view.src;
  const z = view.cam.zoom;
  const W = view.width;
  const Hs = view.height;
  let count = 0;
  client.forEach(now, (_k, id, x, y, look, flags, gear) => {
    if (flags & 128) return; // asleep indoors
    const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
    const h = elevation[ty * size + tx];
    // A point inside a tile, at that tile's height.
    const X = isoX(x, y);
    const Y = isoY(x, y, h);
    const [sx, sy] = view.toScreen(X, Y);
    if (sx < -40 || sy < -60 || sx > W + 40 || sy > Hs + 40) return;
    const o = count * 7;
    buf[o] = sx;
    buf[o + 1] = sy;
    buf[o + 2] = x + y;
    buf[o + 3] = look;
    buf[o + 4] = flags;
    buf[o + 5] = id;
    buf[o + 6] = gear;
    order[count] = count;
    count++;
  });
  // Buildings: marked with look = -1, their index in `buildings` in the id slot, and how
  // many levels lower their lowest tile is than their highest (they stand on a stone base).
  for (let k = 0; k < buildings.length; k++) {
    const b = buildings[k];
    const bx = b.tile % size;
    const by = (b.tile - bx) / size;
    let hi = 0;
    let lo = Infinity;
    for (let y = by; y < by + b.d; y++) {
      for (let x = bx; x < bx + b.w; x++) {
        if (x >= size || y >= size) continue;
        const e = elevation[y * size + x];
        hi = Math.max(hi, e);
        lo = Math.min(lo, e);
      }
    }
    // Sorted by the footprint's middle: someone behind it is hidden, someone in front is not.
    const cx = bx + b.w / 2;
    const cy = by + b.d / 2;
    const [sx, sy] = view.toScreen(isoX(cx, cy), isoY(cx, cy, hi));
    const reach = z * (b.w + b.d) * 0.6;
    if (sx < -reach || sy < -reach || sx > W + reach || sy > Hs + reach) continue;
    const o = count * 7;
    buf[o] = sx;
    buf[o + 1] = sy;
    buf[o + 2] = cx + cy;
    buf[o + 3] = -1;
    buf[o + 4] = Math.min(3, Math.max(0, hi - (lo === Infinity ? hi : lo)));
    buf[o + 5] = k;
    buf[o + 6] = 0;
    order[count] = count;
    count++;
  }
  // Animals: marked with look = -2, their kind in the id slot and their ID in the gear slot.
  client.forEachCreature(now, (id, x, y, kind, flags) => {
    const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
    const h = kind === 6 ? 0 : elevation[ty * size + tx];
    const [sx, sy] = view.toScreen(isoX(x, y), isoY(x, y, h));
    if (sx < -120 || sy < -160 || sx > W + 120 || sy > Hs + 80 || count >= order.length) return;
    const o = count * 7;
    buf[o] = sx;
    buf[o + 1] = sy;
    // A flying dragon is drawn over everything.
    buf[o + 2] = kind === 6 ? 1e9 : x + y;
    buf[o + 3] = -2;
    buf[o + 4] = flags;
    buf[o + 5] = kind;
    buf[o + 6] = id;
    order[count] = count;
    count++;
  });
  const idx = Array.from(order.subarray(0, count)).sort((a, b) => buf[a * 7 + 2] - buf[b * 7 + 2]);

  const dpr = view.dpr;
  // Flat buildings (fields) lie on the ground: drawn first, under everyone.
  for (const k of idx) {
    const o = k * 7;
    if (buf[o + 3] !== -1) continue;
    const b = buildings[buf[o + 5]];
    if (BUILDINGS[b.kind].flat) drawBuilding(ctx, b, buf[o], buf[o + 1], z, dpr, now, 0, STEP);
  }
  const figurePx = Math.round(HEIGHT * z * dpr);
  const t = Math.floor(now / 140);
  drawFalls(ctx, view, client, now, figurePx);
  for (const k of idx) {
    const o = k * 7;
    const sx = buf[o];
    const sy = buf[o + 1];
    const look = buf[o + 3];
    const flags = buf[o + 4];
    const id = buf[o + 5];
    const gear = buf[o + 6];
    if (look === -2) {
      // An animal (id slot: its kind; gear slot: its ID).
      const tame = (flags & 4) !== 0;
      if (gear === selectedCreature && selectedCreature !== null) drawSelection(ctx, sx, sy, z);
      if (figurePx < MIN_FIGURE_PX && id !== 6) {
        const r = Math.max(1, 0.05 * z);
        ctx.beginPath();
        ctx.arc(sx, sy - r, r, 0, Math.PI * 2);
        ctx.fillStyle = creatureColor(id, tame);
        ctx.fill();
        ctx.lineWidth = Math.max(0.6, r * 0.4);
        ctx.strokeStyle = NAVY;
        ctx.stroke();
        continue;
      }
      const frame = flags & 1 ? Math.floor(t / (id === 6 ? 2 : 1) + gear) % 4 : 0;
      const sp = creatureSprite(id, frame, Math.max(6, Math.min(figurePx, 90)), (flags & 8) !== 0, tame);
      const scale = figurePx > 90 ? figurePx / 90 : 1;
      const dw = (sp.canvas.width * scale) / dpr;
      const dh = (sp.canvas.height * scale) / dpr;
      if (flags & 2) {
        ctx.save();
        ctx.translate(sx, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(sp.canvas, -(sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, dw, dh);
        ctx.restore();
      } else ctx.drawImage(sp.canvas, sx - (sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, dw, dh);
      continue;
    }
    if (look < 0) {
      const b = buildings[id];
      if (BUILDINGS[b.kind].flat) continue;
      if (b.kind === 0 && b.settlement === selectedSettlement && selectedSettlement !== null) drawSelection(ctx, sx, sy, z * 1.6);
      drawBuilding(ctx, b, sx, sy, z, dpr, now, flags, STEP);
      continue;
    }
    if (selected.has(id)) drawSelection(ctx, sx, sy, z);
    const ageLook = (flags >> 5) & 3;
    const px = Math.round(figurePx * AGE_SCALE[ageLook]);
    if (figurePx < MIN_FIGURE_PX) {
      const r = Math.max(ageLook === AgeLook.Young || ageLook === AgeLook.Child ? 1.1 : 1.6, 0.06 * z * AGE_SCALE[ageLook]);
      ctx.beginPath();
      ctx.arc(sx, sy - r, r, 0, Math.PI * 2);
      ctx.fillStyle = gear >> 8 ? NATION_COLORS[(gear >> 8) - 1] : CLOTHES[unpackLook(look).clothes];
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, r * 0.45);
      ctx.strokeStyle = NAVY;
      ctx.stroke();
      continue;
    }
    const pose = (flags >> 3) & 3;
    const fight = (flags & 2048) !== 0;
    const frame = flags & 1 ? (t + id) % 4 : pose === Pose.Work ? Math.floor((t + id) / (fight ? 3 : 2)) % 2 : 0;
    const extra = (flags & 8192 ? HOOD : 0) | (flags & 4096 ? SICK : 0);
    const sp = sprite(look, (flags & 4) !== 0, pose, frame, Math.max(6, Math.min(px, 90)), ageLook === AgeLook.Elder, (flags & 256) !== 0, (flags & 512) !== 0, gear, (flags & 1024) !== 0, fight, extra);
    const scale = px > 90 ? px / 90 : 1;
    const dw = (sp.canvas.width * scale) / dpr;
    const dh = (sp.canvas.height * scale) / dpr;
    // Facing left: the picture is mirrored (people face where they go, or the foe they fight).
    if (flags & 2) {
      ctx.save();
      ctx.translate(sx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(sp.canvas, -(sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, dw, dh);
      ctx.restore();
    } else ctx.drawImage(sp.canvas, sx - (sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, dw, dh);
  }
  drawShots(ctx, view, client, now, figurePx);
}

/** How long blows and the fallen are drawn (ms): a swing's flash, an arrow, a bolt, a stone; a body lying. */
const SHOT_MS = [220, 380, 300, 650, 700];
const FALL_MS = 6000;

/** The fallen lie where they fell, fading (drawn on the ground, under everyone). */
function drawFalls(ctx: CanvasRenderingContext2D, view: IsoView, client: SimClient, now: number, figurePx: number) {
  const { size, elevation } = view.src;
  const dpr = view.dpr;
  const falls = client.falls;
  while (falls.length && now - falls[0].at > FALL_MS) falls.shift();
  if (figurePx < MIN_FIGURE_PX) return;
  for (const f of falls) {
    const age = (now - f.at) / FALL_MS;
    const h = elevation[Math.min(size - 1, Math.floor(f.y)) * size + Math.min(size - 1, Math.floor(f.x))];
    const [sx, sy] = view.toScreen(isoX(f.x, f.y), isoY(f.x, f.y, h));
    const key = `fall|${f.look}|${f.male ? 1 : 0}|${figurePx}`;
    let sp = sprites.get(key);
    if (!sp) {
      sp = drawSleeping(f.look, f.male, Math.max(6, Math.min(figurePx, 90)), false, false);
      sprites.set(key, sp);
    }
    const scale = figurePx > 90 ? figurePx / 90 : 1;
    ctx.globalAlpha = Math.max(0, 1 - age * age);
    ctx.drawImage(sp.canvas, sx - (sp.ax * scale) / dpr, sy - (sp.ay * scale) / dpr, (sp.canvas.width * scale) / dpr, (sp.canvas.height * scale) / dpr);
    ctx.globalAlpha = 1;
  }
}

/** Blows struck: a flash where a swing lands; arrows, bolts and catapult stones flying in an arc to their mark. */
function drawShots(ctx: CanvasRenderingContext2D, view: IsoView, client: SimClient, now: number, figurePx: number) {
  const shots = client.shots;
  while (shots.length && now - shots[0].at > 700) shots.shift();
  if (!shots.length) return;
  const { size, elevation } = view.src;
  const z = view.cam.zoom;
  const at = (x: number, y: number, lift: number): [number, number] => {
    const h = elevation[Math.min(size - 1, Math.max(0, Math.floor(y))) * size + Math.min(size - 1, Math.max(0, Math.floor(x)))];
    return view.toScreen(isoX(x, y), isoY(x, y, h) - lift);
  };
  const body = (HEIGHT * 0.55);
  for (const s of shots) {
    const dur = SHOT_MS[s.kind] ?? 300;
    const t = (now - s.at) / dur;
    if (t < 0 || t > 1) continue;
    if (s.kind === 0) {
      // A swing landing: a small burst at the foe.
      const [cx, cy] = at(s.x1, s.y1, body);
      const r = Math.max(2.5, z * 0.12) * (0.6 + t);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const rr = k % 2 ? r * 0.45 : r;
        if (k) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8);
        else ctx.moveTo(cx + rr, cy);
      }
      ctx.closePath();
      ctx.globalAlpha = 1 - t * 0.6;
      ctx.fillStyle = '#fff6d8';
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, z * 0.02);
      ctx.strokeStyle = NAVY;
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    if (s.kind === 4) {
      // A dragon's fire: a burst of flame below it, spreading and fading.
      const [cx, cy] = at(s.x0, s.y0, 0);
      const r = Math.max(4, z * 0.7) * (0.4 + t);
      ctx.globalAlpha = 0.85 * (1 - t);
      for (const [color, k] of [['#e8562a', 1], ['#f5c542', 0.55]] as const) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * k, r * k * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      continue;
    }
    if (figurePx < MIN_FIGURE_PX * 0.6) continue;
    // In flight: higher in the middle, a stone higher still.
    const arc = Math.sin(Math.PI * t) * (s.kind === 3 ? 1.6 : 0.6);
    const x = s.x0 + (s.x1 - s.x0) * t;
    const y = s.y0 + (s.y1 - s.y0) * t;
    const [px, py] = at(x, y, body + arc);
    if (s.kind === 3) {
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, z * 0.08), 0, Math.PI * 2);
      ctx.fillStyle = '#8c8c8c';
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, z * 0.02);
      ctx.strokeStyle = NAVY;
      ctx.stroke();
      continue;
    }
    // An arrow or bolt pointing the way it flies.
    const t2 = Math.min(1, t + 0.05);
    const [qx, qy] = at(s.x0 + (s.x1 - s.x0) * t2, s.y0 + (s.y1 - s.y0) * t2, body + Math.sin(Math.PI * t2) * 0.6);
    const len = Math.hypot(qx - px, qy - py) || 1;
    const ux = (qx - px) / len;
    const uy = (qy - py) / len;
    const L = Math.max(4, z * (s.kind === 2 ? 0.16 : 0.22));
    ctx.beginPath();
    ctx.moveTo(px - ux * L * 0.5, py - uy * L * 0.5);
    ctx.lineTo(px + ux * L * 0.5, py + uy * L * 0.5);
    ctx.lineWidth = Math.max(1.6, z * 0.035);
    ctx.strokeStyle = NAVY;
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, z * 0.016);
    ctx.strokeStyle = '#d9c39a';
    ctx.stroke();
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


/** The animal under a screen point (or nearest within a few pixels), or null. */
export function pickCreature(view: IsoView, client: SimClient, sx: number, sy: number, now: number): number | null {
  const { size, elevation } = view.src;
  const z = view.cam.zoom;
  const H = Math.max(10, HEIGHT * z);
  let best: number | null = null;
  let bestD = Infinity;
  client.forEachCreature(now, (id, x, y, kind) => {
    const tx = Math.min(size - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(size - 1, Math.max(0, Math.floor(y)));
    const [px, py] = view.toScreen(isoX(x, y), isoY(x, y, kind === 6 ? 0 : elevation[ty * size + tx]));
    // A dragon flies high over its shadow; others stand about half a person tall.
    const cy = kind === 6 ? py - H * 2.2 : py - H * 0.3;
    const reach = kind === 6 ? H * 1.6 : Math.max(8, H * 0.5);
    const d = Math.hypot(sx - px, sy - cy);
    if (d < reach && d < bestD) {
      bestD = d;
      best = id;
    }
  });
  return best;
}
