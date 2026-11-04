import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Eraser, Maximize, Minus, Pause, Play, Plus, RotateCcw, Save, User, X } from 'lucide-react';
import { ButtonLink, Button, IconButton, Spinner, cx } from '../components/ui';
import { alertDialog, confirmDialog, notify, promptDialog } from '../components/dialogs';
import { useApp } from '../lib/store';
import { closeWorld, openWorld, readSetup, saveRunAs, saveWorld, setWorldUnsaved } from '../lib/worlds';
import { brushTiles } from '../map/paint';
import { SimClient } from '../sim/client';
import { CLOTHES, SKINS, unpackLook } from '../sim/look';
import { MONTHS_PER_YEAR, TICKS_PER_MONTH, TICKS_PER_YEAR, type PersonDetails, type Speed } from '../sim/types';
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
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState<PersonDetails | null>(null);
  const [busy, setBusy] = useState(false);
  /** The tick the world was at when it was loaded or last saved. */
  const [savedTick, setSavedTick] = useState(doc.state.tick);
  const docRef = useRef(doc);
  docRef.current = doc;
  const savedTickRef = useRef(savedTick);
  savedTickRef.current = savedTick;

  const live = useRef({ tab, tool, radius, selected });
  live.current = { tab, tool, radius, selected };
  const atStart = tick === savedTick;
  const isSetup = doc.kind === 'setup';

  // Start the simulation and the view once, when the screen opens.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const view = new IsoView(canvas, { size: doc.size, terrain: doc.terrain, elevation: doc.elevation, deposit: doc.deposit });
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
      view.redraw();
    };
    client.onWatched = (p) => setDetails(p);
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

    view.hooks = {
      onPointerDown: (p) => {
        const { tab } = live.current;
        if (tab === 'main') {
          const id = pickPerson(view, client, p.sx, p.sy, performance.now());
          setSelected(id);
          client.watch(id);
          if (id === null) setDetails(null);
          return;
        }
        placed.clear();
        act(p.tile);
      },
      onPointerMove: (p) => act(p.tile),
      onPointerUp: () => placed.clear(),
      objects: (ctx, v, now) => drawPeople(ctx, v, client, now, live.current.selected),
      overlay: (ctx, v) => {
        const h = v.hover;
        const { tab, tool, radius } = live.current;
        if (!h || tab !== 'units') return;
        ctx.beginPath();
        const r = tool === 'person' ? 0.5 : radius - 0.5;
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
  useEffect(() => viewRef.current?.redraw(), [tab, tool, radius, selected]);

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
        setSelected(null);
        setDetails(null);
        clientRef.current?.watch(null);
        setTab('main');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
    setSelected(null);
    setDetails(null);
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

      {/* Right: the inspected person. */}
      {selected !== null && (
        <InspectPanel
          details={details}
          onClose={() => {
            setSelected(null);
            setDetails(null);
            clientRef.current?.watch(null);
          }}
          onRemove={() => {
            if (selected === null) return;
            clientRef.current?.removePerson(selected);
            setWorldUnsaved(true);
            setSelected(null);
            setDetails(null);
            clientRef.current?.watch(null);
          }}
        />
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
            <TabButton active={false} disabled title="Imperatives come with the systems they give orders to (Stages 2 to 5).">
              Imperatives
            </TabButton>
            <span className="ml-auto hidden pr-2 text-xs text-muted lg:block">
              {tab === 'main' ? 'Click a person to inspect · Space pauses · 1 2 3 set the speed' : 'Left drag places · right drag moves · wheel zooms'}
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

function InspectPanel({ details, onClose, onRemove }: { details: PersonDetails | null; onClose: () => void; onRemove: () => void }) {
  return (
    <div className="absolute right-3 top-16 w-64 rounded-xl border border-line bg-surface/97 p-3.5 text-sm shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {details && (
            <span className="relative block size-9 shrink-0 overflow-hidden rounded-full border-2 border-navy" style={{ background: CLOTHES[unpackLook(details.look).clothes] }}>
              <span className="absolute left-1/2 top-1 block size-4 -translate-x-1/2 rounded-full border-2 border-navy" style={{ background: SKINS[unpackLook(details.look).skin] }} />
            </span>
          )}
          <div>
            <p className="label-caps text-muted">Person</p>
            <p className="font-display text-lg uppercase leading-tight">{details ? `No. ${details.id}` : 'Gone'}</p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {details ? (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Sex</dt>
            <dd>{details.sex === 1 ? 'Male' : 'Female'}</dd>
            <dt className="text-muted">Age</dt>
            <dd>{details.ageYears}</dd>
            <dt className="text-muted">Health</dt>
            <dd>{details.health} / 100</dd>
            <dt className="text-muted">Job</dt>
            <dd className="text-muted">None</dd>
            <dt className="text-muted">Culture</dt>
            <dd className="text-muted">None</dd>
            <dt className="text-muted">Pair</dt>
            <dd className="text-muted">None</dd>
            <dt className="text-muted">Doing</dt>
            <dd>{details.task === 'walk' ? 'Walking' : 'Standing'}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted">Needs, jobs, cultures and pairs arrive in the next steps.</p>
          <Button size="xs" variant="danger" className="mt-3" onClick={onRemove}>
            Remove
          </Button>
        </>
      ) : (
        <p className="mt-3 text-muted">This person is no longer in the world.</p>
      )}
    </div>
  );
}
