import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { ArrowDown, ArrowUp, Dices, Eraser, Equal, Maximize, Minus, Plus, Redo2, Undo2, Waves } from 'lucide-react';
import { ButtonLink, Button, IconButton, Input, Segmented, Spinner, cx } from '../components/ui';
import { notify } from '../components/dialogs';
import { randomSeed } from '../lib/rng';
import { closeMap, mapChanged, openMap, useApp } from '../lib/store';
import { generateTiles } from '../map/generate';
import { Stroke, brushTiles, restore, type Tool, type Undo } from '../map/paint';
import { DEPOSITS, Deposit, TERRAINS, Terrain, depositDef, terrainDef } from '../map/terrain';
import { DEFAULT_GEN, MAP_SIZES, type GenSettings, type MapData } from '../map/types';
import { IsoView } from '../render/IsoView';
import { tileIcon } from '../render/icons';
import { BACKDROP } from '../render/style';

type Tab = 'terrain' | 'height' | 'resources' | 'generate';

type UndoStep = { kind: 'tiles'; undo: Undo } | { kind: 'all'; terrain: Uint8Array; elevation: Uint8Array; deposit: Uint8Array; gen: GenSettings | undefined };

const UNDO_LIMIT = 60;

export function MapEditorPage() {
  const { id = '' } = useParams();
  const open = useApp((s) => s.open);

  useEffect(() => {
    void openMap(id);
  }, [id]);
  useEffect(() => () => void closeMap(), []);

  if (open.kind === 'ready' && open.map.id === id) return <MapEditor key={id} map={open.map} />;
  let body: ReactNode = <Spinner />;
  if (open.kind === 'missing') body = <p>This map is no longer in the app.</p>;
  else if (open.kind === 'elsewhere') body = <p>This map is open in another tab or window of the app. Close it there first, then reload this page.</p>;
  else if (open.kind === 'error') body = <p className="text-warn">The map could not be opened: {open.message}</p>;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      {body}
      {open.kind !== 'loading' && open.kind !== 'none' && (
        <ButtonLink to="/" size="sm">
          Back to Home
        </ButtonLink>
      )}
    </div>
  );
}

function MapEditor({ map }: { map: MapData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<IsoView | null>(null);
  const [tab, setTab] = useState<Tab>('terrain');
  const [tool, setTool] = useState<Tool>({ kind: 'terrain', terrain: Terrain.Grassland });
  const [radius, setRadius] = useState(3);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const undoStack = useRef<UndoStep[]>([]);
  const redoStack = useRef<UndoStep[]>([]);
  const stroke = useRef<{ s: Stroke; last: { x: number; y: number } } | null>(null);

  // The view reads these through refs so it never has to be rebuilt.
  const live = useRef({ tab, tool, radius });
  live.current = { tab, tool, radius };

  const syncHistory = () => setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  const pushUndo = (step: UndoStep) => {
    undoStack.current.push(step);
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    syncHistory();
  };

  const applyStep = useCallback(
    (step: UndoStep): UndoStep => {
      const view = viewRef.current;
      if (step.kind === 'tiles') {
        const redo = restore(map, step.undo);
        view?.tilesChanged(step.undo.keys());
        mapChanged(map);
        return { kind: 'tiles', undo: redo };
      }
      const back: UndoStep = { kind: 'all', terrain: map.terrain.slice(), elevation: map.elevation.slice(), deposit: map.deposit.slice(), gen: map.gen };
      map.terrain.set(step.terrain);
      map.elevation.set(step.elevation);
      map.deposit.set(step.deposit);
      map.gen = step.gen;
      view?.replaceTiles(map);
      mapChanged(map);
      return back;
    },
    [map],
  );

  const undo = useCallback(() => {
    const step = undoStack.current.pop();
    if (!step) return;
    redoStack.current.push(applyStep(step));
    syncHistory();
  }, [applyStep]);

  const redo = useCallback(() => {
    const step = redoStack.current.pop();
    if (!step) return;
    undoStack.current.push(applyStep(step));
    syncHistory();
  }, [applyStep]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const view = new IsoView(canvas, map);
    viewRef.current = view;

    const paintTo = (t: { x: number; y: number }) => {
      const st = stroke.current;
      if (!st) return;
      // Fill in the tiles between the last point and this one, so fast strokes leave no gaps.
      const changed: number[] = [];
      for (const [x, y] of line(st.last.x, st.last.y, t.x, t.y)) changed.push(...st.s.apply(x, y, live.current.radius));
      st.last = t;
      if (changed.length) {
        view.tilesChanged(changed);
        mapChanged(map);
      }
    };

    view.hooks = {
      onPointerDown: (p) => {
        if (!p.tile || live.current.tab === 'generate') return;
        stroke.current = { s: new Stroke(map, map.size, live.current.tool), last: p.tile };
        paintTo(p.tile);
      },
      onPointerMove: (p) => {
        if (p.tile) paintTo(p.tile);
      },
      onPointerUp: () => {
        const st = stroke.current;
        stroke.current = null;
        if (st && st.s.undo.size) pushUndo({ kind: 'tiles', undo: st.s.undo });
      },
      onHover: (t) => setHover(t),
      overlay: (ctx, v) => {
        const h = v.hover;
        if (!h || live.current.tab === 'generate') return;
        ctx.beginPath();
        for (const [x, y] of brushTiles(h.x, h.y, live.current.radius - 0.5, map.size)) v.traceTile(ctx, x, y);
        ctx.fillStyle = 'rgba(252, 63, 63, 0.18)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(252, 63, 63, 0.85)';
        ctx.stroke();
      },
    };
    view.start();
    // Development only: lets automated checks reach the view.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__view = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // The brush outline follows tool and size changes.
  useEffect(() => viewRef.current?.redraw(), [tab, tool, radius]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!mod && e.key === '[') setRadius((r) => Math.max(1, r - 1));
      else if (!mod && e.key === ']') setRadius((r) => Math.min(16, r + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const regenerate = (gen: GenSettings) => {
    pushUndo({ kind: 'all', terrain: map.terrain.slice(), elevation: map.elevation.slice(), deposit: map.deposit.slice(), gen: map.gen });
    const tiles = generateTiles(map.size, gen);
    map.terrain.set(tiles.terrain);
    map.elevation.set(tiles.elevation);
    map.deposit.set(tiles.deposit);
    map.gen = gen;
    viewRef.current?.replaceTiles(map);
    mapChanged(map);
    notify('Map generated. Undo brings back the map as it was before.');
  };

  const hoverInfo = hover ? tileInfo(map, hover.x, hover.y) : null;
  const sizeLabel = MAP_SIZES.find((s) => s.size === map.size)?.label;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: BACKDROP }}>
      <canvas ref={canvasRef} tabIndex={0} className="absolute inset-0 h-full w-full outline-none" />

      {/* Top left: what is under the pointer. */}
      <div className="pointer-events-none absolute left-3 top-3 w-60 rounded-xl border border-line bg-surface/95 px-3.5 py-2.5 text-sm shadow-card">
        <p className="label-caps text-muted">
          Map mode · {sizeLabel} {map.size} × {map.size}
        </p>
        {hoverInfo ? (
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted">Tile</dt>
            <dd className="font-mono text-xs leading-5">
              {hover!.x}, {hover!.y}
            </dd>
            <dt className="text-muted">Terrain</dt>
            <dd>{hoverInfo.terrain}</dd>
            <dt className="text-muted">Elevation</dt>
            <dd>{hoverInfo.elevation}</dd>
            <dt className="text-muted">Deposit</dt>
            <dd>{hoverInfo.deposit}</dd>
          </dl>
        ) : (
          <p className="mt-1.5 text-muted">Point at the map to see a tile.</p>
        )}
      </div>

      {/* Top right: view and history. */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-line bg-surface/95 p-1 shadow-card">
        <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!history.undo}>
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!history.redo}>
          <Redo2 className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" />
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

      {/* Bottom: the toolbar. */}
      <div className="absolute inset-x-0 bottom-3 flex flex-col items-center px-3">
        <div className="max-w-full rounded-2xl border border-line bg-surface/97 shadow-pop">
          <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
            {(
              [
                ['terrain', 'Terrain'],
                ['height', 'Height'],
                ['resources', 'Resources'],
                ['generate', 'Generate'],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  if (t === 'terrain' && tool.kind !== 'terrain') setTool({ kind: 'terrain', terrain: Terrain.Grassland });
                  if (t === 'height' && tool.kind !== 'height') setTool({ kind: 'height', mode: 'raise' });
                  if (t === 'resources' && tool.kind !== 'deposit') setTool({ kind: 'deposit', deposit: Deposit.Stone });
                }}
                className={cx(
                  '-mb-px rounded-t-lg border border-b-0 px-3.5 py-1.5 font-display text-[0.9375rem] uppercase tracking-[0.06em] transition',
                  tab === t ? 'border-line bg-surface text-ink' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto hidden pr-2 text-xs text-muted lg:block">Left drag paints · right drag moves · wheel zooms · WASD moves</span>
          </div>

          {tab === 'generate' ? (
            <GeneratePanel initial={map.gen} onGenerate={regenerate} />
          ) : (
            <div className="flex items-stretch gap-3 overflow-x-auto p-2 scrollbar-thin">
              <div className="flex gap-1">
                {tab === 'terrain' &&
                  TERRAINS.map((t) => (
                    <ToolButton key={t.id} active={tool.kind === 'terrain' && tool.terrain === t.id} label={t.name} onClick={() => setTool({ kind: 'terrain', terrain: t.id })}>
                      <img src={tileIcon(t.id)} alt="" className="size-10" draggable={false} />
                    </ToolButton>
                  ))}
                {tab === 'height' &&
                  (
                    [
                      ['raise', 'Raise', <ArrowUp key="r" className="size-5" />],
                      ['lower', 'Lower', <ArrowDown key="l" className="size-5" />],
                      ['flatten', 'Flatten', <Equal key="f" className="size-5" />],
                      ['smooth', 'Smooth', <Waves key="s" className="size-5" />],
                    ] as const
                  ).map(([mode, label, icon]) => (
                    <ToolButton key={mode} active={tool.kind === 'height' && tool.mode === mode} label={label} onClick={() => setTool({ kind: 'height', mode })}>
                      <span className="flex size-10 items-center justify-center">{icon}</span>
                    </ToolButton>
                  ))}
                {tab === 'resources' &&
                  DEPOSITS.map((d) => (
                    <ToolButton key={d.id} active={tool.kind === 'deposit' && tool.deposit === d.id} label={d.id === Deposit.None ? 'Erase' : d.name} onClick={() => setTool({ kind: 'deposit', deposit: d.id })}>
                      {d.id === Deposit.None ? (
                        <span className="flex size-10 items-center justify-center">
                          <Eraser className="size-5" />
                        </span>
                      ) : (
                        <img src={tileIcon(d.on === 'water' ? Terrain.ShallowWater : Terrain.Grassland, d.id)} alt="" className="size-10" draggable={false} />
                      )}
                    </ToolButton>
                  ))}
              </div>
              <div className="flex w-44 shrink-0 flex-col justify-center gap-1 border-l border-line pl-3">
                <span className="flex justify-between text-xs text-muted">
                  <span>Brush size</span>
                  <span className="font-mono">{radius}</span>
                </span>
                <input
                  type="range"
                  className="slider"
                  min={1}
                  max={16}
                  value={radius}
                  style={{ ['--fill' as string]: `${((radius - 1) / 15) * 100}%` }}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  aria-label="Brush size"
                />
                <span className="text-[0.6875rem] text-muted">[ and ] change it</span>
              </div>
              {tab === 'height' && <p className="w-48 shrink-0 self-center text-xs text-muted">Each stroke moves a tile by one level. Each terrain keeps its own height range.</p>}
              {tab === 'resources' && <p className="w-48 shrink-0 self-center text-xs text-muted">Fish go on water; the others on land.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
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
      {children}
      <span className="w-full truncate text-center">{label}</span>
    </button>
  );
}

function GeneratePanel({ initial, onGenerate }: { initial: GenSettings | undefined; onGenerate: (g: GenSettings) => void }) {
  const [g, setG] = useState<GenSettings>(() => initial ?? { ...DEFAULT_GEN, seed: randomSeed() });
  const [busy, setBusy] = useState(false);
  const upd = (patch: Partial<GenSettings>) => setG((old) => ({ ...old, ...patch }));

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 p-3">
      <div className="space-y-1">
        <span className="block text-xs text-muted">Seed</span>
        <div className="flex gap-1">
          <Input
            className="h-9 w-32 font-mono text-sm"
            inputMode="numeric"
            value={String(g.seed)}
            onChange={(e) => {
              const v = Number(e.target.value.replace(/\D/g, '').slice(0, 10));
              if (Number.isFinite(v)) upd({ seed: v });
            }}
          />
          <IconButton label="New random seed" className="size-9 border border-line" onClick={() => upd({ seed: randomSeed() })}>
            <Dices className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="space-y-1">
        <span className="block text-xs text-muted">Shape</span>
        <Segmented
          size="sm"
          value={g.shape}
          onChange={(shape) => upd({ shape })}
          options={[
            { value: 'continent', label: 'Continent' },
            { value: 'continents', label: 'Continents' },
            { value: 'islands', label: 'Islands' },
          ]}
        />
      </div>
      <Slider label="Land" value={g.land} min={0.2} max={0.8} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(land) => upd({ land })} />
      <Slider label="Mountains" value={g.mountains} min={0} max={1} step={0.05} show={pct} onChange={(mountains) => upd({ mountains })} />
      <Slider label="Forests" value={g.forests} min={0} max={1} step={0.05} show={pct} onChange={(forests) => upd({ forests })} />
      <Slider label="Deserts" value={g.deserts} min={0} max={1} step={0.05} show={pct} onChange={(deserts) => upd({ deserts })} />
      <Slider label="Rivers" value={g.rivers} min={0} max={40} step={1} show={(v) => String(v)} onChange={(rivers) => upd({ rivers })} />
      <Slider label="Resources" value={g.resources} min={0} max={1} step={0.05} show={pct} onChange={(resources) => upd({ resources })} />
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await new Promise((r) => setTimeout(r, 30));
          onGenerate(g);
          setBusy(false);
        }}
      >
        Generate map
      </Button>
      <p className="basis-full text-xs text-muted">Generating replaces the whole map, painting included. Undo brings it back. The same seed and settings always give the same map.</p>
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block w-32 space-y-1">
      <span className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">{show(value)}</span>
      </span>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function tileInfo(map: MapData, x: number, y: number) {
  const i = y * map.size + x;
  const d = map.deposit[i];
  return {
    terrain: terrainDef(map.terrain[i]).name,
    elevation: map.elevation[i],
    deposit: d === Deposit.None ? 'None' : depositDef(d).name,
  };
}

/** Tiles on a straight line between two tiles (Bresenham), both ends included. */
function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}
