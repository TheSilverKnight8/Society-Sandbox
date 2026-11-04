import { isWater } from '../map/terrain';
import { randomLook } from './look';
import { PathFinder } from './path';
import { TICKS_PER_YEAR, type Person, type PersonDetails, type SimState, type Snapshot } from './types';

// The running world, inside the simulation worker. Every individual is simulated in
// full each step, on screen or not (SPEC 2).
//
// Stage 2a: people stand, look around and walk short distances. Needs, jobs and the
// life cycle replace this in the next steps of Stage 2.

/** Tiles a search may look at per step, shared by everyone waiting for a path. */
const PATH_BUDGET = 60_000;
/** Walking speed on open ground, in tiles per step (1.5 tiles a second at 1x). */
const WALK_SPEED = 0.15;
/** How far people wander when they have nothing to do (stand-in until needs exist). */
const WANDER_RADIUS = 8;

/** A seeded random number generator whose state can be saved. */
class Rand {
  s: number;
  constructor(s: number) {
    this.s = s >>> 0;
  }
  next = () => {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  int(n: number) {
    return Math.floor(this.next() * n);
  }
}

interface Route {
  tiles: number[];
  step: number;
}

export class World {
  readonly size: number;
  readonly terrain: Uint8Array;
  readonly elevation: Uint8Array;
  readonly deposit: Uint8Array;
  readonly state: SimState;
  private finder: PathFinder;
  private rand: Rand;
  private byId = new Map<number, Person>();
  private routes = new Map<number, Route>();
  /** People waiting for a path, with the tile they want to reach. */
  private queue: { id: number; goal: number }[] = [];

  constructor(size: number, terrain: Uint8Array, elevation: Uint8Array, deposit: Uint8Array, state: SimState) {
    this.size = size;
    this.terrain = terrain;
    this.elevation = elevation;
    this.deposit = deposit;
    this.state = state;
    this.rand = new Rand(state.rng);
    this.finder = new PathFinder(size, terrain, elevation);
    for (const p of state.people) {
      // Routes are not saved; anyone who was walking starts again from standing.
      if (p.task === 'walk') p.task = 'idle';
      this.byId.set(p.id, p);
    }
  }

  // ---------------------------------------------------------------- stepping

  step() {
    const st = this.state;
    st.tick++;
    this.finder.expanded = 0;
    this.servePaths();
    for (const p of st.people) this.update(p);
    st.rng = this.rand.s;
  }

  private servePaths() {
    while (this.queue.length && this.finder.expanded < PATH_BUDGET) {
      const { id, goal } = this.queue.shift()!;
      const p = this.byId.get(id);
      if (!p) continue;
      const start = this.tileOf(p);
      const tiles = this.finder.find(start, goal, 6000);
      if (tiles && tiles.length) {
        this.routes.set(id, { tiles, step: 0 });
        p.task = 'walk';
      } else {
        p.wait = 10 + this.rand.int(30);
      }
    }
  }

  private update(p: Person) {
    if (p.task === 'walk') {
      this.walk(p);
      return;
    }
    if (p.wait > 0) {
      p.wait--;
      return;
    }
    // Nothing to do yet: pick a nearby spot to walk to.
    p.wait = 1 << 30; // until the path search answers
    const goal = this.randomNearby(p, WANDER_RADIUS);
    if (goal < 0) p.wait = 20;
    else this.queue.push({ id: p.id, goal });
  }

  private walk(p: Person) {
    const r = this.routes.get(p.id);
    if (!r || r.step >= r.tiles.length) {
      this.routes.delete(p.id);
      p.task = 'idle';
      p.wait = 20 + this.rand.int(50);
      return;
    }
    const size = this.size;
    const here = this.tileOf(p);
    let budget = WALK_SPEED / this.finder.cost(here);
    while (budget > 0 && r.step < r.tiles.length) {
      const next = r.tiles[r.step];
      const tx = (next % size) + 0.5;
      const ty = Math.floor(next / size) + 0.5;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        p.x = tx;
        p.y = ty;
        budget -= d;
        r.step++;
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  private tileOf(p: Person) {
    return Math.floor(p.y) * this.size + Math.floor(p.x);
  }

  private randomNearby(p: Person, radius: number): number {
    const size = this.size;
    for (let k = 0; k < 8; k++) {
      const x = Math.floor(p.x) + this.rand.int(radius * 2 + 1) - radius;
      const y = Math.floor(p.y) + this.rand.int(radius * 2 + 1) - radius;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = y * size + x;
      if (this.finder.walkable(i) && !isWater(this.terrain[i])) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- player actions

  /** Places one adult on each land tile given (SPEC 4: unit placement). Returns how many were placed. */
  place(tiles: number[]): number {
    let n = 0;
    for (const i of tiles) {
      if (i < 0 || i >= this.terrain.length || isWater(this.terrain[i]) || !this.finder.walkable(i)) continue;
      const st = this.state;
      const age = 16 + this.rand.next() * 20;
      const p: Person = {
        id: st.nextId++,
        sex: this.rand.next() < 0.5 ? 0 : 1,
        born: st.tick - Math.floor(age * TICKS_PER_YEAR),
        health: 100,
        look: randomLook(this.rand.next),
        x: (i % this.size) + 0.3 + this.rand.next() * 0.4,
        y: Math.floor(i / this.size) + 0.3 + this.rand.next() * 0.4,
        task: 'idle',
        wait: 10 + this.rand.int(40),
      };
      st.people.push(p);
      this.byId.set(p.id, p);
      n++;
    }
    return n;
  }

  /** Removes everyone standing on the given tiles. */
  removeOn(tiles: number[]) {
    const set = new Set(tiles);
    this.removeWhere((p) => set.has(this.tileOf(p)));
  }

  removePerson(id: number) {
    this.removeWhere((p) => p.id === id);
  }

  private removeWhere(test: (p: Person) => boolean) {
    const keep: Person[] = [];
    for (const p of this.state.people) {
      if (test(p)) {
        this.byId.delete(p.id);
        this.routes.delete(p.id);
      } else keep.push(p);
    }
    this.state.people = keep;
  }

  /** Development only: n people on land around (x, y). */
  spawnTest(n: number, cx: number, cy: number) {
    const tiles: number[] = [];
    const size = this.size;
    for (let k = 0; k < n * 20 && tiles.length < n; k++) {
      const r = Math.sqrt(this.rand.next()) * 60;
      const a = this.rand.next() * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      tiles.push(y * size + x);
    }
    this.place(tiles);
  }

  // ---------------------------------------------------------------- reading

  details(id: number): PersonDetails | null {
    const p = this.byId.get(id);
    if (!p) return null;
    return {
      id: p.id,
      sex: p.sex,
      ageYears: Math.max(0, Math.floor((this.state.tick - p.born) / TICKS_PER_YEAR)),
      health: Math.round(p.health),
      look: p.look,
      task: p.task,
    };
  }

  snapshot(stepMs: number): Snapshot {
    const people = this.state.people;
    const n = people.length;
    const ids = new Int32Array(n);
    const pos = new Float32Array(n * 2);
    const look = new Uint16Array(n);
    const flags = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const p = people[k];
      ids[k] = p.id;
      pos[k * 2] = p.x;
      pos[k * 2 + 1] = p.y;
      look[k] = p.look;
      let f = (p.task === 'walk' ? 1 : 0) | (p.sex === 1 ? 4 : 0);
      const r = p.task === 'walk' ? this.routes.get(p.id) : undefined;
      if (r && r.step < r.tiles.length) {
        // Facing left on screen when heading toward smaller (x - y).
        const next = r.tiles[r.step];
        const nx = (next % this.size) + 0.5;
        const ny = Math.floor(next / this.size) + 0.5;
        if (nx - ny < p.x - p.y) f |= 2;
      }
      flags[k] = f;
    }
    return { tick: this.state.tick, ids, pos, look, flags, stepMs };
  }

  /** A copy of everything that is saved. */
  saveState(): SimState {
    return { ...this.state, rng: this.rand.s, people: this.state.people.map((p) => ({ ...p, wait: p.task === 'walk' ? 0 : Math.min(p.wait, 100) })) };
  }
}
