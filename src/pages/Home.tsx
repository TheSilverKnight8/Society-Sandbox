import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Castle, Download, FileUp, Hourglass, Map as MapIcon, Plus, Trash2 } from 'lucide-react';
import { alertDialog, confirmDialog, notify } from '../components/dialogs';
import { Button, Card, IconButton, Input, Segmented, Select, Spinner } from '../components/ui';
import { randomSeed } from '../lib/rng';
import { createMap, deleteMap, exportMap, importMap, useApp } from '../lib/store';
import { DEFAULT_GEN, DEFAULT_SIZE, MAP_SIZES, type MapMeta } from '../map/types';
import { createSetup, deleteWorld } from '../lib/worlds';
import { TICKS_PER_YEAR } from '../sim/types';
import type { WorldMeta } from '../world/types';

export function Home() {
  const boot = useApp((s) => s.boot);
  const maps = useApp((s) => s.maps);
  const worlds = useApp((s) => s.worlds);
  const storage = useApp((s) => s.storage);
  const [creating, setCreating] = useState(false);
  const [creatingSetup, setCreatingSetup] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const setups = worlds.filter((w) => w.kind === 'setup');
  const runs = worlds.filter((w) => w.kind === 'run');

  const onImport = async (file: File) => {
    const r = await importMap(file);
    if (!r.ok) await alertDialog({ title: 'Could not import', body: r.reason });
    else notify(`Imported “${r.value.name}”.`);
  };

  if (boot.kind === 'loading') return <Spinner />;
  if (boot.kind === 'error') return <p className="text-warn">The app could not open its storage in this browser: {boot.message}</p>;

  return (
    <div className="animate-rise space-y-14">
      <section>
        <p className="label-caps text-accent">Medieval society simulation</p>
        <h1 className="mt-1 text-5xl">Setups</h1>
        <p className="mt-3 max-w-2xl text-muted">A setup is a starting point built on a map. Open one to place people, save it, then run scenarios through it.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setCreatingSetup(true)} disabled={maps.length === 0} title={maps.length === 0 ? 'Make a map first' : undefined}>
            <Plus className="size-4" />
            New setup
          </Button>
        </div>
        <div className="mt-6">
          {setups.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <Castle className="size-8 text-muted" />
              <p className="text-muted">{maps.length === 0 ? 'No setups yet. Make a map below first, then a setup from it.' : 'No setups yet. Make one with New setup.'}</p>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {setups.map((w) => (
                <WorldCard key={w.id} meta={w} onOpen={() => navigate(`/world/${w.id}`)} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-4xl">Saved runs</h2>
        <p className="mt-3 max-w-2xl text-muted">A run saved part-way through. Each one stands on its own.</p>
        <div className="mt-6">
          {runs.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <Hourglass className="size-8 text-muted" />
              <p className="text-muted">No saved runs yet. Start a setup running and use Save run.</p>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {runs.map((w) => (
                <WorldCard key={w.id} meta={w} onOpen={() => navigate(`/world/${w.id}`)} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-4xl">Maps</h2>
        <p className="mt-3 max-w-2xl text-muted">
          Maps are made here, in Map mode: generated, painted by hand, or both. A setup keeps its own copy of the map's terrain, so editing a map later does not change setups already made from it.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New map
          </Button>
          <Button onClick={() => fileInput.current?.click()}>
            <FileUp className="size-4" />
            Import map
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onImport(f);
            }}
          />
        </div>
        <div className="mt-6">
          {maps.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <MapIcon className="size-8 text-muted" />
              <p className="text-muted">No maps yet. Make one with New map.</p>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {maps.map((m) => (
                <MapCard key={m.id} meta={m} onOpen={() => navigate(`/map/${m.id}`)} />
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="text-sm text-muted">
        Saved in this browser on this computer
        {storage.usage !== null && <> · {formatBytes(storage.usage)} used</>}
        {storage.persisted === true && <> · Chrome keeps this storage even when the disk runs low</>}
        {storage.persisted === false && maps.length + worlds.length > 0 && <> · Chrome may clear this storage if the disk runs low; exported map files are full copies</>}
      </p>

      {creating && <NewMapDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/map/${id}`)} />}
      {creatingSetup && <NewSetupDialog maps={maps} onClose={() => setCreatingSetup(false)} onCreated={(id) => navigate(`/world/${id}`)} />}
    </div>
  );
}

function WorldCard({ meta, onOpen }: { meta: WorldMeta; onOpen: () => void }) {
  const year = Math.floor(meta.tick / TICKS_PER_YEAR) + 1;
  return (
    <Card className="group overflow-hidden">
      <button className="block w-full bg-[#f6e7cf] p-3" onClick={onOpen} aria-label={`Open ${meta.name}`}>
        {meta.thumbnail ? <img src={meta.thumbnail} alt="" className="aspect-[2/1] w-full object-contain transition group-hover:scale-[1.02]" /> : <div className="aspect-[2/1] w-full" />}
      </button>
      <div className="flex items-start gap-2 border-t border-line px-4 py-3">
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <h3 className="truncate text-xl">{meta.name}</h3>
          <p className="mt-1 text-xs text-muted">
            {meta.kind === 'run' ? <>Year {year} · </> : null}
            {meta.population} {meta.population === 1 ? 'person' : 'people'} · map: {meta.mapName}
            {meta.kind === 'run' && meta.setupName ? <> · from {meta.setupName}</> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">Saved {new Date(meta.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>
        </button>
        <IconButton
          label={meta.kind === 'setup' ? 'Delete setup' : 'Delete saved run'}
          className="hover:text-danger"
          onClick={async () => {
            const ok = await confirmDialog({ title: `Delete “${meta.name}”?`, body: 'It is removed from this browser. This cannot be undone.', confirm: 'Delete', danger: true });
            if (!ok) return;
            const r = await deleteWorld(meta.id);
            if (!r.ok) await alertDialog({ title: 'Could not delete', body: r.reason });
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </Card>
  );
}

function NewSetupDialog({ maps, onClose, onCreated }: { maps: MapMeta[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [mapId, setMapId] = useState(maps[maps.length - 1]?.id ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async () => {
    if (!name.trim() || !mapId || busy) return;
    setBusy(true);
    const r = await createSetup(name, mapId);
    setBusy(false);
    if (!r.ok) {
      await alertDialog({ title: 'Could not make the setup', body: r.reason });
      return;
    }
    onClose();
    onCreated(r.value);
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-navy/30 p-4" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        role="dialog"
        aria-modal
        aria-label="New setup"
        className="w-full max-w-lg animate-rise rounded-2xl border border-line bg-surface p-6 shadow-pop"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-2xl">New setup</h2>
        <label className="mt-4 block space-y-1.5">
          <span className="block text-sm font-medium">Name</span>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="mt-4 block space-y-1.5">
          <span className="block text-sm font-medium">Map</span>
          <Select value={mapId} onChange={(e) => setMapId(e.target.value)}>
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.size} × {m.size})
              </option>
            ))}
          </Select>
          <span className="block text-xs text-muted">The setup keeps its own copy of the map as it is now; its terrain cannot change afterwards.</span>
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || !mapId} loading={busy}>
            Make setup
          </Button>
        </div>
      </form>
    </div>
  );
}

function MapCard({ meta, onOpen }: { meta: MapMeta; onOpen: () => void }) {
  const sizeLabel = MAP_SIZES.find((s) => s.size === meta.size)?.label ?? `${meta.size}`;
  return (
    <Card className="group overflow-hidden">
      <button className="block w-full bg-[#f6e7cf] p-3" onClick={onOpen} aria-label={`Open ${meta.name} in Map mode`}>
        {meta.thumbnail ? <img src={meta.thumbnail} alt="" className="aspect-[2/1] w-full object-contain transition group-hover:scale-[1.02]" /> : <div className="aspect-[2/1] w-full" />}
      </button>
      <div className="flex items-start gap-2 border-t border-line px-4 py-3">
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <h3 className="truncate text-xl">{meta.name}</h3>
          <p className="mt-1 text-xs text-muted">
            {sizeLabel} · {meta.size} × {meta.size} · edited {new Date(meta.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </p>
        </button>
        <IconButton
          label="Export map file"
          onClick={async () => {
            const r = await exportMap(meta.id);
            if (!r.ok) await alertDialog({ title: 'Could not export', body: r.reason });
          }}
        >
          <Download className="size-4" />
        </IconButton>
        <IconButton
          label="Delete map"
          className="hover:text-danger"
          onClick={async () => {
            const ok = await confirmDialog({ title: `Delete “${meta.name}”?`, body: 'The map is removed from this browser. This cannot be undone.', confirm: 'Delete', danger: true });
            if (!ok) return;
            const r = await deleteMap(meta.id);
            if (!r.ok) await alertDialog({ title: 'Could not delete', body: r.reason });
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </Card>
  );
}

function NewMapDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(String(DEFAULT_SIZE));
  const [start, setStart] = useState<'generated' | 'blank'>('generated');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    // Let the button show it is working before generation takes the main thread.
    await new Promise((r) => setTimeout(r, 30));
    const r = await createMap({ name, size: Number(size), gen: start === 'generated' ? { ...DEFAULT_GEN, seed: randomSeed() } : null });
    setBusy(false);
    if (!r.ok) {
      await alertDialog({ title: 'Could not make the map', body: r.reason });
      return;
    }
    onClose();
    onCreated(r.value);
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-navy/30 p-4" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        role="dialog"
        aria-modal
        aria-label="New map"
        className="w-full max-w-lg animate-rise rounded-2xl border border-line bg-surface p-6 shadow-pop"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-2xl">New map</h2>
        <label className="mt-4 block space-y-1.5">
          <span className="block text-sm font-medium">Name</span>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="mt-4 space-y-1.5">
          <span className="block text-sm font-medium">Size</span>
          <Segmented
            value={size}
            onChange={setSize}
            className="w-full"
            options={MAP_SIZES.map((s) => ({ value: String(s.size), label: s.label, title: `${s.note} tiles` }))}
          />
          <p className="text-xs text-muted">{MAP_SIZES.find((s) => String(s.size) === size)?.note} tiles. The size cannot be changed later.</p>
        </div>
        <div className="mt-4 space-y-1.5">
          <span className="block text-sm font-medium">Start from</span>
          <Segmented
            value={start}
            onChange={setStart}
            className="w-full"
            options={[
              { value: 'generated', label: 'Generated' },
              { value: 'blank', label: 'Blank sea' },
            ]}
          />
          <p className="text-xs text-muted">
            {start === 'generated' ? 'A random map you can regenerate with other settings and paint over in Map mode.' : 'All water, to paint land into by hand.'}
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!name.trim()} loading={busy}>
            Make map
          </Button>
        </div>
      </form>
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
