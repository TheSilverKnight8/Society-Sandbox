import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Apple, Eraser, Footprints, Hand, Maximize, Minus, Moon, Pause, Pencil, Play, Plus, RotateCcw, Save, User, X } from 'lucide-react';
import { ButtonLink, Button, IconButton, Input, Segmented, Spinner, cx } from '../components/ui';
import { alertDialog, confirmDialog, notify, promptDialog } from '../components/dialogs';
import { useApp } from '../lib/store';
import { closeWorld, openWorld, readSetup, saveRunAs, saveWorld, setWorldUnsaved } from '../lib/worlds';
import { brushTiles } from '../map/paint';
import { SimClient } from '../sim/client';
import { CLOTHES, SKINS, unpackLook } from '../sim/look';
import { MONTHS_PER_YEAR, TICKS_PER_MONTH, TICKS_PER_YEAR, type PersonDetails, type PersonEdit, type Speed } from '../sim/types';
import { Deposit } from '../map/terrain';
import { STEP } from '../render/iso';
import { IsoView } from '../render/IsoView';
import { drawPeople, pickPerson } from '../render/people';
import { BACKDROP } from '../render/style';
import type { WorldDoc } from '../world/types';

// The main screen (SPEC 4): the map, with a toolbar along the bottom in the manner of
// WorldBox's. Its Main tab holds the time controls (as WorldBox's Main tab holds pause
// and speed); the other tabs hold unit placement, disasters and effects, and imperatives
// in place of god powers.

type Tab = 'main' | 'units' | 'disasters' | 'imperatives';
type UnitTool = 'person' | 'remove';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function WorldScreenPage() {
  const { id = '' } = useParams();
  const world = useApp((s) => s.world);

  useEffect(() => {
    void openWorld(id);
  }, [id]);
  useEffect(() => () => void closeWorld(), []);

  if (world.kind === 'ready' && world.doc.id === id) return <WorldScreen doc={world.doc} />;
  let body: ReactNode = <Spinner />;
  if (world.kind === 'missing') body = <p>This setup or saved run is no longer in the app.</p>;
  else if (world.kind === 'elsewhere') body = <p>This is open in another tab or window of the app. Close it there first, then reload this page.</p>;
  else if (world.kind === 'error') body = <p className="text-warn">It could not be opened: {world.message}</p>;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      {body}
      {world.kind !== 'loading' && world.kind !== 'none' && (
        <ButtonLink to="/" size="sm">
          Back to Home
        </ButtonLink>
      )}
    </div>
  );
}

/** Builds the "used up" flags for drawing from a world's saved food stock. */
function emptyFlags(doc: WorldDoc): Uint8Array {
  const n = doc.size * doc.size;
  const out = new Uint8Array(n);
  const stock = doc.state.stock;
  if (!stock || stock.length !== n) return out;
  for (let i = 0; i < n; i++) if ((doc.deposit[i] === Deposit.Berries || doc.deposit[i] === Deposit.Fish) && stock[i] === 0) out[i] = 1;
  return out;
}

type OrderKind = 'move' | 'gather' | 'rest' | 'stop';
/** An imperative being given: waiting for who it is for, or for where (SPEC 4: either order works). */
type Pending = { kind: OrderKind; stage: 'who' | 'where' } | null;

const ORDER_LABEL: Record<OrderKind, string> = { move: 'Move', gather: 'Gather food', rest: 'Rest', stop: 'Stop' };

function WorldScreen({ doc }: { doc: WorldDoc }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<IsoView | null>(null);
  const clientRef = useRef<SimClient | null>(null);
  const navigate = useNavigate();
  const unsaved = useApp((s) => s.worldUnsaved);
  const [tab, setTab] = useState<Tab>('main');
  const [tool, setTool] = useState<UnitTool>('person');
  const [radius, setRadius] = useState(2);
  const [speed, setSpeedState] = useState<Speed>(0);
  const [tick, setTick] = useState(doc.state.tick);
  const [population, setPopulation] = useState(doc.state.people.length);
  /** The people chosen, for inspecting (one) or giving imperatives (one or more). */
  const [selection, setSelection] = useState<number[]>([]);
  const [details, setDetails] = useState<PersonDetails | null>(null);
  const [died, setDied] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  /** The tick the world was at when it was loaded or last saved. */
  const [savedTick, setSavedTick] = useState(doc.state.tick);
  const docRef = useRef(doc);
  docRef.current = doc;
  const savedTickRef = useRef(savedTick);
  savedTickRef.current = savedTick;
  const empty = useRef(emptyFlags(doc));

  const selectedSet = useRef<Set<number>>(new Set());
  const live = useRef({ tab, tool, radius, pending, selection });
  live.current = { tab, tool, radius, pending, selection };
  /** The box being dragged out to choose people, in screen pixels. */
  const box = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const atStart = tick === savedTick;
  const isSetup = doc.kind === 'setup';
  const inspected = selection.length === 1 ? selection[0] : null;

  const choose = (ids: number[]) => {
    setSelection(ids);
    selectedSet.current = new Set(ids);
    setDied(null);
    if (ids.length !== 1) setDetails(null);
    clientRef.current?.watch(ids.length === 1 ? ids[0] : null);
    viewRef.current?.redraw();
  };

  /** Gives an imperative to the chosen people, at a tile if it needs one. */
  const giveOrder = (kind: OrderKind, ids: number[], tile?: number) => {
    const client = clientRef.current;
    if (!client || !ids.length) return;
    if (kind === 'stop') client.order(ids, { kind: 'stop' });
    else client.order(ids, { kind, tile });
    setWorldUnsaved(true);
    notify(`${ORDER_LABEL[kind]}: ${ids.length === 1 ? '1 person' : `${ids.length} people`}.`);
  };
  const giveRef = useRef(giveOrder);
  giveRef.current = giveOrder;
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  // Start the simulation and the view once, when the screen opens.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const view = new IsoView(canvas, { size: doc.size, terrain: doc.terrain, elevation: doc.elevation, deposit: doc.deposit, empty: empty.current });
    const client = new SimClient();
    viewRef.current = view;
    clientRef.current = client;
    client.init(doc.size, doc.terrain, doc.elevation, doc.deposit, doc.state);
    // The panels only need to change when the month does (or when time first moves), so
    // the interface is not redrawn for every step.
    let shownMonth = -1;
    let shownAtStart = true;
    client.onSnapshot = (s) => {
      const month = Math.floor(s.tick / TICKS_PER_MONTH);
      const atStartNow = s.tick === savedTickRef.current;
      if (month !== shownMonth || atStartNow !== shownAtStart) {
        shownMonth = month;
        shownAtStart = atStartNow;
        setTick(s.tick);
      }
      if (!atStartNow) setWorldUnsaved(true);
      setPopulation(s.ids.length);
      for (const v of s.stockChanges) {
        const i = Math.abs(v) - 1;
        empty.current[i] = v > 0 ? 1 : 0;
        stockDirty.add(i);
      }
      view.redraw();
    };
    // Bushes being picked and growing back are redrawn together about once a second, not on
    // every step, since each redraw of the terrain costs far more than drawing people.
    const stockDirty = new Set<number>();
    const stockTimer = window.setInterval(() => {
      if (!stockDirty.size) return;
      view.tilesChanged(stockDirty);
      stockDirty.clear();
    }, 1000);
    // The inspect panel is refreshed a few times a second, not on every step.
    let lastWatched = 0;
    client.onWatched = (p, cause) => {
      const now = performance.now();
      if (p && now - lastWatched < 250) return;
      lastWatched = now;
      setDetails(p);
      if (!p && cause) setDied(cause);
    };
    client.onError = (m) => notify(`The simulation stopped with an error: ${m}`, 'warn');

    const placed = new Set<number>();
    const act = (t: { x: number; y: number } | null) => {
      if (!t) return;
      const { tab, tool, radius } = live.current;
      if (tab !== 'units') return;
      const i = t.y * doc.size + t.x;
      if (tool === 'person') {
        if (placed.has(i)) return;
        placed.add(i);
        client.place([i]);
      } else {
        client.remove(brushTiles(t.x, t.y, radius - 0.5, doc.size).map(([x, y]) => y * doc.size + x));
      }
      setWorldUnsaved(true);
    };

    /** People whose feet are inside a screen rectangle. */
    const inBox = (b: { x0: number; y0: number; x1: number; y1: number }) => {
      const x0 = Math.min(b.x0, b.x1);
      const x1 = Math.max(b.x0, b.x1);
      const y0 = Math.min(b.y0, b.y1);
      const y1 = Math.max(b.y0, b.y1);
      const { size, elevation } = view.src;
      return client.idsWhere(performance.now(), (x, y) => {
        const h = elevation[Math.min(size - 1, Math.floor(y)) * size + Math.min(size - 1, Math.floor(x))];
        const [sx, sy] = view.toScreen((x - y) * 0.5, (x + y) * 0.25 - h * STEP);
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      });
    };

    /** A click or a finished box in the Imperatives tab. */
    const imperativePick = (ids: number[], tile: { x: number; y: number } | null, wasBox: boolean) => {
      const { pending, selection } = live.current;
      if (pending?.stage === 'where') {
        if (!tile || wasBox) return;
        giveRef.current(pending.kind, selection, tile.y * doc.size + tile.x);
        setPending(null);
        return;
      }
      chooseRef.current(ids);
      if (pending?.stage === 'who' && ids.length) {
        if (pending.kind === 'move' || pending.kind === 'gather') setPending({ kind: pending.kind, stage: 'where' });
        else {
          giveRef.current(pending.kind, ids);
          setPending(null);
        }
      }
    };

    view.hooks = {
      onPointerDown: (p) => {
        const { tab } = live.current;
        if (tab === 'main') {
          const id = pickPerson(view, client, p.sx, p.sy, performance.now());
          chooseRef.current(id === null ? [] : [id]);
          return;
        }
        if (tab === 'imperatives') {
          box.current = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy };
          return;
        }
        placed.clear();
        act(p.tile);
      },
      onPointerMove: (p) => {
        if (live.current.tab === 'imperatives' && box.current) {
          box.current.x1 = p.sx;
          box.current.y1 = p.sy;
          view.redraw();
          return;
        }
        act(p.tile);
      },
      onPointerUp: (p) => {
        placed.clear();
        const b = box.current;
        box.current = null;
        if (live.current.tab !== 'imperatives' || !b) return;
        view.redraw();
        if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 6) imperativePick(inBox(b), null, true);
        else {
          const id = pickPerson(view, client, p.sx, p.sy, performance.now());
          imperativePick(id === null ? [] : [id], p.tile, false);
        }
      },
      objects: (ctx, v, now) => drawPeople(ctx, v, client, now, selectedSet.current),
      overlay: (ctx, v) => {
        const b = box.current;
        if (b && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) > 6) {
          ctx.fillStyle = 'rgba(252, 63, 63, 0.1)';
          ctx.strokeStyle = 'rgba(252, 63, 63, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          const x = Math.min(b.x0, b.x1);
          const y = Math.min(b.y0, b.y1);
          ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
          ctx.strokeRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
          ctx.setLineDash([]);
        }
        const h = v.hover;
        const { tab, tool, radius, pending } = live.current;
        const showTile = tab === 'imperatives' && pending?.stage === 'where';
        if (!h || (tab !== 'units' && !showTile)) return;
        ctx.beginPath();
        const r = tab === 'units' && tool === 'remove' ? radius - 0.5 : 0.5;
        for (const [x, y] of brushTiles(h.x, h.y, r, doc.size)) v.traceTile(ctx, x, y);
        ctx.fillStyle = 'rgba(252, 63, 63, 0.18)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(252, 63, 63, 0.85)';
        ctx.stroke();
      },
    };
    view.start();
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __view: view, __sim: client, __pick: pickPerson });
    return () => {
      window.clearInterval(stockTimer);
      view.destroy();
      client.destroy();
      viewRef.current = null;
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw every frame while time runs (people move between steps); otherwise only on change.
  useEffect(() => {
    if (viewRef.current) viewRef.current.animating = speed > 0;
  }, [speed]);
  useEffect(() => viewRef.current?.redraw(), [tab, tool, radius, selection, pending]);
  // Changing tabs drops a half-given imperative.
  useEffect(() => setPending(null), [tab]);

  const setSpeed = (s: Speed) => {
    clientRef.current?.setSpeed(s);
    setSpeedState(s);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        setSpeed(speed === 0 ? 1 : 0);
      } else if (e.key === '1' || e.key === '2' || e.key === '3') setSpeed(Number(e.key) as Speed);
      else if (e.key === 'Escape') {
        if (pending) setPending(null);
        else {
          choose([]);
          setTab('main');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onOrderButton = (kind: OrderKind) => {
    if (!selection.length) {
      setPending({ kind, stage: 'who' });
      return;
    }
    if (kind === 'move' || kind === 'gather') setPending({ kind, stage: 'where' });
    else {
      giveOrder(kind, selection);
      setPending(null);
    }
  };

  const currentState = async () => {
    const client = clientRef.current!;
    return client.save();
  };

  const onSaveSetup = async () => {
    setBusy(true);
    const { state, deposit } = await currentState();
    const r = await saveWorld(docRef.current, state, deposit);
    setBusy(false);
    if (!r.ok) return alertDialog({ title: 'Could not save', body: r.reason });
    setSavedTick(state.tick);
    notify('Setup saved.');
  };

  const onSaveRun = async () => {
    const d = docRef.current;
    const wasSpeed = speed;
    setSpeed(0);
    if (d.kind === 'run') {
      setBusy(true);
      const { state, deposit } = await currentState();
      const r = await saveWorld(d, state, deposit);
      setBusy(false);
      if (!r.ok) return alertDialog({ title: 'Could not save', body: r.reason });
      setSavedTick(state.tick);
      notify('Run saved.');
    } else {
      const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
      const name = await promptDialog({ title: 'Save run', label: 'Name', value: `${d.name}, year ${year}`, confirm: 'Save' });
      if (!name) return setSpeed(wasSpeed);
      setBusy(true);
      const { state, deposit } = await currentState();
      const r = await saveRunAs(d, name, state, deposit);
      setBusy(false);
      if (!r.ok) return alertDialog({ title: 'Could not save', body: r.reason });
      setSavedTick(state.tick);
      notify(`Saved as “${r.value.name}”. Saving again updates it.`);
      navigate(`/world/${r.value.id}`, { replace: true });
    }
    setSpeed(wasSpeed);
  };

  const onRestart = async () => {
    const d = docRef.current;
    const setupId = d.kind === 'setup' ? d.id : d.setupId;
    if (!setupId) return;
    if (unsaved) {
      const ok = await confirmDialog({ title: 'Start again from the setup?', body: 'Changes since the last save are lost.', confirm: 'Start again', danger: true });
      if (!ok) return;
    }
    if (d.kind === 'run') {
      setWorldUnsaved(false);
      navigate(`/world/${setupId}`);
      return;
    }
    const setup = await readSetup(setupId);
    if (!setup) return alertDialog({ title: 'The setup is gone', body: 'It was deleted, so there is nothing to start again from.' });
    setSpeed(0);
    clientRef.current?.init(setup.size, setup.terrain, setup.elevation, setup.deposit, setup.state);
    empty.current.set(emptyFlags(setup));
    viewRef.current?.replaceTiles({ size: setup.size, terrain: doc.terrain, elevation: doc.elevation, deposit: doc.deposit, empty: empty.current });
    choose([]);
    setSavedTick(setup.state.tick);
    setTick(setup.state.tick);
    setWorldUnsaved(false);
  };

  const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
  const month = Math.floor((tick % TICKS_PER_YEAR) / TICKS_PER_MONTH) % MONTHS_PER_YEAR;
  const setupAvailable = isSetup || !!doc.setupId;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: BACKDROP }}>
      <canvas ref={canvasRef} tabIndex={0} className="absolute inset-0 h-full w-full outline-none" />

      {/* Top left: the world. */}
      <div className="pointer-events-none absolute left-3 top-3 w-64 rounded-xl border border-line bg-surface/95 px-3.5 py-2.5 text-sm shadow-card">
        <p className="label-caps text-muted">{isSetup ? 'Setup' : 'Saved run'}</p>
        <p className="truncate font-display text-xl uppercase leading-tight">{doc.name}</p>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted">Date</dt>
          <dd>
            {MONTHS[month]}, year {year}
          </dd>
          <dt className="text-muted">People</dt>
          <dd>{population}</dd>
          <dt className="text-muted">Time</dt>
          <dd>{speed === 0 ? 'Paused' : `Running at ${speed}×`}</dd>
        </dl>
      </div>

      {/* Top right: view. */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-line bg-surface/95 p-1 shadow-card">
        <IconButton label="Zoom out (-)" onClick={() => viewRef.current && viewRef.current.zoomAt(viewRef.current.width / 2, viewRef.current.height / 2, 0.8)}>
          <Minus className="size-4" />
        </IconButton>
        <IconButton label="Zoom in (+)" onClick={() => viewRef.current && viewRef.current.zoomAt(viewRef.current.width / 2, viewRef.current.height / 2, 1.25)}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Show the whole map" onClick={() => viewRef.current?.fit()}>
          <Maximize className="size-4" />
        </IconButton>
      </div>

      {/* Right: the inspected person, or how many are chosen. */}
      {inspected !== null && (
        <InspectPanel
          details={details}
          died={died}
          onClose={() => choose([])}
          onEdit={(edit) => {
            clientRef.current?.edit(inspected, edit);
            setWorldUnsaved(true);
          }}
          onRemove={() => {
            clientRef.current?.removePerson(inspected);
            setWorldUnsaved(true);
            choose([]);
          }}
        />
      )}
      {selection.length > 1 && (
        <div className="absolute right-3 top-16 flex w-64 items-center justify-between rounded-xl border border-line bg-surface/97 px-3.5 py-2.5 text-sm shadow-pop">
          <span>
            <span className="font-display text-lg uppercase">{selection.length}</span> people chosen
          </span>
          <Button size="xs" variant="ghost" onClick={() => choose([])}>
            Clear
          </Button>
        </div>
      )}

      {/* Bottom: the toolbar. */}
      <div className="absolute inset-x-0 bottom-3 flex flex-col items-center px-3">
        <div className="max-w-full rounded-2xl border border-line bg-surface/97 shadow-pop">
          <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
            <TabButton active={tab === 'main'} onClick={() => setTab('main')}>
              Main
            </TabButton>
            <TabButton active={tab === 'units'} onClick={() => setTab('units')}>
              Units
            </TabButton>
            <TabButton active={false} disabled title="Disasters and effects come in Stage 6.">
              Disasters &amp; effects
            </TabButton>
            <TabButton active={tab === 'imperatives'} onClick={() => setTab('imperatives')}>
              Imperatives
            </TabButton>
            <span className="ml-auto hidden pr-2 text-xs text-muted lg:block">
              {tab === 'main'
                ? 'Click a person to inspect · Space pauses · 1 2 3 set the speed'
                : tab === 'imperatives'
                  ? 'Click a person or drag a box to choose · right drag moves'
                  : 'Left drag places · right drag moves · wheel zooms'}
            </span>
          </div>

          {tab === 'main' && (
            <div className="flex flex-wrap items-center gap-3 p-2.5">
              <div className="flex items-center gap-1">
                <Button variant={speed === 0 ? 'primary' : 'navy'} size="sm" onClick={() => setSpeed(speed === 0 ? 1 : 0)} className="w-28">
                  {speed === 0 ? <Play className="size-4" /> : <Pause className="size-4" />}
                  {speed === 0 ? 'Play' : 'Pause'}
                </Button>
                {([1, 2, 3] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={cx('h-9 w-11 rounded-lg border font-mono text-sm transition', speed === s ? 'border-navy bg-navy text-on-accent' : 'border-line text-ink hover:bg-raised')}
                    title={`${s}× speed (${s})`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <span className="h-7 w-px bg-line" />
              {isSetup && atStart ? (
                <Button size="sm" onClick={onSaveSetup} loading={busy} disabled={!unsaved}>
                  <Save className="size-4" />
                  Save setup
                </Button>
              ) : (
                <Button size="sm" onClick={onSaveRun} loading={busy}>
                  <Save className="size-4" />
                  {isSetup ? 'Save run…' : 'Save run'}
                </Button>
              )}
              {setupAvailable && (
                <Button size="sm" variant="ghost" onClick={onRestart} disabled={isSetup && atStart && !unsaved}>
                  <RotateCcw className="size-4" />
                  Start again from setup
                </Button>
              )}
              <p className="max-w-64 text-xs text-muted">
                {isSetup && atStart
                  ? 'This is the setup’s starting point. Place people in Units, save the setup, then press Play to run it.'
                  : isSetup
                    ? 'Running. Save run keeps this moment as a saved run; the setup itself stays as it was.'
                    : 'A saved run. Save run updates it.'}
              </p>
            </div>
          )}

          {tab === 'units' && (
            <div className="flex items-stretch gap-3 p-2">
              <div className="flex gap-1">
                <ToolButton active={tool === 'person'} label="Person" onClick={() => setTool('person')}>
                  <User className="size-5" />
                </ToolButton>
                <ToolButton active={tool === 'remove'} label="Remove" onClick={() => setTool('remove')}>
                  <Eraser className="size-5" />
                </ToolButton>
              </div>
              {tool === 'remove' ? (
                <div className="flex w-44 shrink-0 flex-col justify-center gap-1 border-l border-line pl-3">
                  <span className="flex justify-between text-xs text-muted">
                    <span>Brush size</span>
                    <span className="font-mono">{radius}</span>
                  </span>
                  <input
                    type="range"
                    className="slider"
                    min={1}
                    max={8}
                    value={radius}
                    style={{ ['--fill' as string]: `${((radius - 1) / 7) * 100}%` }}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    aria-label="Brush size"
                  />
                </div>
              ) : null}
              <p className="w-56 shrink-0 self-center text-xs text-muted">
                {tool === 'person' ? 'Click or drag on land to place adults, one per tile. Buildings come in Stage 3.' : 'Removes everyone inside the brush.'}
              </p>
            </div>
          )}

          {tab === 'imperatives' && (
            <div className="flex items-stretch gap-3 p-2">
              <div className="flex flex-col justify-center gap-1 pr-1">
                <span className="label-caps text-muted">Units</span>
                <span className="text-[0.6875rem] text-muted">Settlements, nations and cultures come later</span>
              </div>
              <div className="flex gap-1">
                {(['move', 'gather', 'rest', 'stop'] as const).map((k) => (
                  <ToolButton key={k} active={pending?.kind === k} label={ORDER_LABEL[k]} onClick={() => onOrderButton(k)}>
                    {k === 'move' ? <Footprints className="size-5" /> : k === 'gather' ? <Apple className="size-5" /> : k === 'rest' ? <Moon className="size-5" /> : <Hand className="size-5" />}
                  </ToolButton>
                ))}
              </div>
              <p className="w-64 shrink-0 self-center text-xs text-muted">
                {pending?.stage === 'who'
                  ? `${ORDER_LABEL[pending.kind]}: now click a person or drag a box around people. Esc cancels.`
                  : pending?.stage === 'where'
                    ? `${ORDER_LABEL[pending.kind]}: now click ${pending.kind === 'move' ? 'where to go' : 'where to look for food'}. Esc cancels.`
                    : selection.length
                      ? `${selection.length === 1 ? '1 person' : `${selection.length} people`} chosen. Pick an order.`
                      : 'Choose people first (click one, or drag a box), or pick an order first and then choose.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, disabled, title, onClick, children }: { active: boolean; disabled?: boolean; title?: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        '-mb-px rounded-t-lg border border-b-0 px-3.5 py-1.5 font-display text-[0.9375rem] uppercase tracking-[0.06em] transition disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-line bg-surface text-ink' : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function ToolButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={cx(
        'flex w-[4.6rem] shrink-0 flex-col items-center gap-1 rounded-xl border px-1 py-1.5 text-[0.6875rem] leading-tight transition',
        active ? 'border-accent bg-accent/10 text-ink' : 'border-transparent text-muted hover:bg-raised hover:text-ink',
      )}
    >
      <span className="flex size-10 items-center justify-center">{children}</span>
      <span className="w-full truncate text-center">{label}</span>
    </button>
  );
}

const TASK_TEXT: Record<string, string> = {
  idle: 'Standing',
  sleep: 'Sleeping',
  gather: 'Gathering food',
  eat: 'Eating',
};

function doingText(d: PersonDetails) {
  if (d.task === 'walk') return d.purpose === 'food' ? 'Going to gather food' : d.purpose === 'order' ? 'Following an order' : 'Walking';
  return TASK_TEXT[d.task] ?? d.task;
}

function Bar({ value, warn }: { value: number; warn: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <span className={cx('block h-full rounded-full', warn ? 'bg-accent' : 'bg-navy')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="w-7 text-right font-mono text-xs">{value}</span>
    </span>
  );
}

function InspectPanel({
  details,
  died,
  onClose,
  onEdit,
  onRemove,
}: {
  details: PersonDetails | null;
  died: string | null;
  onClose: () => void;
  onEdit: (e: PersonEdit) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const d = details;
  const needs: string[] = [];
  if (d) {
    if (d.food < 45) needs.push(d.food === 0 ? 'Starving' : 'Hungry');
    if (d.rest < 25) needs.push('Tired');
    needs.push('Shelter');
  }
  return (
    <div className="absolute right-3 top-16 max-h-[calc(100%-12rem)] w-72 overflow-y-auto rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop scrollbar-thin">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {d && (
            <span className="relative block size-9 shrink-0 overflow-hidden rounded-full border-2 border-navy" style={{ background: CLOTHES[unpackLook(d.look).clothes] }}>
              <span className="absolute left-1/2 top-1 block size-4 -translate-x-1/2 rounded-full border-2 border-navy" style={{ background: SKINS[unpackLook(d.look).skin] }} />
            </span>
          )}
          <div>
            <p className="label-caps text-muted">Person</p>
            <p className="font-display text-lg uppercase leading-tight">{d ? `No. ${d.id}` : died ? 'Died' : 'Gone'}</p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {d ? (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <dt className="text-muted">Sex</dt>
            <dd>{d.sex === 1 ? 'Male' : 'Female'}</dd>
            <dt className="text-muted">Age</dt>
            <dd>{d.ageYears}</dd>
            <dt className="text-muted">Health</dt>
            <dd>
              <Bar value={d.health} warn={d.health < 40} />
            </dd>
            <dt className="text-muted">Job</dt>
            <dd className="text-muted">None (jobs come in Stage 3)</dd>
            <dt className="text-muted">Culture</dt>
            <dd className="text-muted">None</dd>
            <dt className="text-muted">Pair</dt>
            <dd className="text-muted">None</dd>
          </dl>
          <p className="label-caps mt-3 text-muted">Needs</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <dt className="text-muted">Food</dt>
            <dd>
              <Bar value={d.food} warn={d.food < 45} />
            </dd>
            <dt className="text-muted">Rest</dt>
            <dd>
              <Bar value={d.rest} warn={d.rest < 25} />
            </dd>
            <dt className="text-muted">Shelter</dt>
            <dd className="text-xs text-muted">None yet: houses come in Stage 3</dd>
            <dt className="text-muted">Safety</dt>
            <dd className="text-xs">Safe (no threats exist yet)</dd>
          </dl>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Doing</dt>
            <dd>{doingText(d)}</dd>
            <dt className="text-muted">Unmet needs</dt>
            <dd>{needs.length ? needs.join(', ') : 'None'}</dd>
            <dt className="text-muted">Carrying</dt>
            <dd>{d.carry ? `${d.carry} food` : 'Nothing'}</dd>
            <dt className="text-muted">Order</dt>
            <dd>{d.order ? ORDER_LABEL[d.order] : 'None'}</dd>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button size="xs" variant={editing ? 'navy' : 'secondary'} onClick={() => setEditing((e) => !e)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
            <Button size="xs" variant="danger" onClick={onRemove}>
              Remove
            </Button>
          </div>
          {editing && <EditPerson details={d} onEdit={onEdit} />}
        </>
      ) : (
        <p className="mt-3 text-muted">{died ? `This person died of ${died}.` : 'This person is no longer in the world.'}</p>
      )}
    </div>
  );
}

/** Editing a person by hand (SPEC 1: everything can be modified). */
function EditPerson({ details, onEdit }: { details: PersonDetails; onEdit: (e: PersonEdit) => void }) {
  const [age, setAge] = useState(String(details.ageYears));
  const slider = (label: string, key: 'health' | 'food' | 'rest', value: number) => (
    <label className="block space-y-1">
      <span className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </span>
      <input
        type="range"
        className="slider"
        min={key === 'health' ? 1 : 0}
        max={100}
        value={value}
        style={{ ['--fill' as string]: `${value}%` }}
        onChange={(e) => onEdit({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-raised/50 p-2.5">
      {slider('Health', 'health', details.health)}
      {slider('Food', 'food', details.food)}
      {slider('Rest', 'rest', details.rest)}
      <div className="flex items-center gap-2">
        <span className="w-10 text-xs text-muted">Sex</span>
        <Segmented
          size="xs"
          value={details.sex === 1 ? 'm' : 'f'}
          onChange={(v) => onEdit({ sex: v === 'm' ? 1 : 0 })}
          options={[
            { value: 'f', label: 'Female' },
            { value: 'm', label: 'Male' },
          ]}
        />
      </div>
      <label className="flex items-center gap-2">
        <span className="w-10 text-xs text-muted">Age</span>
        <Input
          className="h-8 w-20 text-sm"
          inputMode="numeric"
          value={age}
          onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
          onBlur={() => age && onEdit({ ageYears: Number(age) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && age) onEdit({ ageYears: Number(age) });
          }}
        />
      </label>
    </div>
  );
}
