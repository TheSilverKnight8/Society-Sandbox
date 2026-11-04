import { TICKS_PER_SECOND, type FromSim, type Speed, type ToSim } from './types';
import { World } from './world';

// The simulation runs here, in its own thread, so drawing the map stays smooth however
// busy the world is. The app sends it commands and gets back a snapshot of where
// everyone is after each batch of steps.

const ctx = self as unknown as {
  postMessage(msg: FromSim, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToSim>) => void) | null;
};

let world: World | null = null;
let speed: Speed = 0;
let last = performance.now();
let owed = 0;
let watching: number | null = null;
let watchingSettlement: number | null = null;
let stepTime = 0;
let stepCount = 0;
let stepMs = 0;
let lastAverage = performance.now();
let sendSoon = false;

function post(msg: FromSim, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

function sendSnapshot() {
  if (!world) return;
  const s = world.snapshot(stepMs);
  post({ type: 'snap', ...s }, [s.ids.buffer, s.pos.buffer, s.look.buffer, s.flags.buffer, s.tileChanges.buffer]);
  if (watchingSettlement !== null) post({ type: 'watchedSettlement', settlement: world.towns.details(watchingSettlement) });
  if (watching !== null) {
    const person = world.details(watching);
    const died = person ? undefined : world.deaths.get(watching);
    post({ type: 'watched', person, died });
  }
  world.deaths.clear();
}

ctx.onmessage = (e: MessageEvent<ToSim>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init':
        world = new World(m.size, m.terrain, m.elevation, m.deposit, m.state);
        speed = 0;
        owed = 0;
        sendSoon = true;
        break;
      case 'speed':
        speed = m.speed;
        last = performance.now();
        owed = 0;
        break;
      case 'place':
        world?.place(m.tiles);
        sendSoon = true;
        break;
      case 'remove':
        world?.removeOn(m.tiles);
        sendSoon = true;
        break;
      case 'removePerson':
        world?.removePerson(m.id);
        sendSoon = true;
        break;
      case 'watch':
        watching = m.id;
        sendSoon = true;
        break;
      case 'save':
        if (world) post({ type: 'saved', req: m.req, state: world.saveState(), deposit: world.deposit.slice() });
        break;
      case 'edit':
        world?.edit(m.id, m.edit);
        sendSoon = true;
        break;
      case 'order':
        world?.order(m.ids, m.order);
        sendSoon = true;
        break;
      case 'toggles':
        world?.setToggles(m.toggles);
        break;
      case 'unpair':
        world?.unpair(m.id);
        sendSoon = true;
        break;
      case 'placeBuilding':
        world?.towns.place(m.kind, m.tile);
        sendSoon = true;
        break;
      case 'removeBuildings':
        world?.towns.removeOn(m.tiles);
        sendSoon = true;
        break;
      case 'watchSettlement':
        watchingSettlement = m.id;
        sendSoon = true;
        break;
      case 'settlementOrder':
        world?.towns.order(m.id, m.order);
        sendSoon = true;
        break;
      case 'spawnTest':
        world?.spawnTest(m.n, m.x, m.y);
        sendSoon = true;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};

/** Runs the steps that are due at the current speed, a few at a time, then reports. */
function loop() {
  const now = performance.now();
  if (world && speed > 0) {
    owed += ((now - last) / 1000) * TICKS_PER_SECOND * speed;
    // If the world falls behind, it slows down rather than trying to catch up all at once.
    const steps = Math.min(Math.floor(owed), 4);
    owed = Math.min(owed - steps, 4);
    for (let k = 0; k < steps; k++) {
      const t0 = performance.now();
      world.step();
      stepTime += performance.now() - t0;
      stepCount++;
    }
    if (steps > 0) sendSoon = true;
  }
  last = now;
  if (now - lastAverage >= 1000) {
    stepMs = stepCount ? stepTime / stepCount : 0;
    stepTime = 0;
    stepCount = 0;
    lastAverage = now;
  }
  if (sendSoon) {
    sendSoon = false;
    sendSnapshot();
  }
  setTimeout(loop, 8);
}
loop();
