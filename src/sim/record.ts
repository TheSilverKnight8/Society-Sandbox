import { type RecordEntry, type RecordKind } from './types';
import type { World } from './world';

// The record of events (SPEC 5: the sim leaves behind a record of events; SPEC 10: writing it is
// a rule). Settlements founded, growing and abandoned; nations formed and fallen and their rulers;
// cultures formed, broken away and extinct; wars, battles won and peace; disasters; crimes; beasts.
// Kept with the run (the oldest entries go once there are very many), and sent to the app as
// they are written.

/** Most entries kept. */
const MAX_ENTRIES = 3000;

export class EventRecord {
  private w: World;
  /** Entries written since the app last heard. */
  private fresh: RecordEntry[] = [];

  constructor(w: World) {
    this.w = w;
    w.state.record ??= [];
  }

  get list(): RecordEntry[] {
    return this.w.state.record!;
  }

  /** Writes an entry (when the rule is on). */
  add(kind: RecordKind, text: string, tile?: number) {
    if (!this.w.toggles.record) return;
    const e: RecordEntry = { tick: this.w.state.tick, kind, text, tile };
    const list = this.list;
    list.push(e);
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    this.fresh.push(e);
  }

  /** Entries written since the last snapshot (taken by it). */
  take(): RecordEntry[] | undefined {
    if (!this.fresh.length) return undefined;
    const out = this.fresh;
    this.fresh = [];
    return out;
  }
}
