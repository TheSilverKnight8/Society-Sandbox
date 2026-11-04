import type { MouseEvent, ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { AlertTriangle, Castle, Check, Hourglass, Loader2, Map as MapIcon } from 'lucide-react';
import { AppMark } from '../graphics/AppMark';
import { CroswellLogo, CroswellMark } from '../graphics/Logo';
import { APP_NAME } from '../config';
import { flushSaves, getState, useApp } from '../lib/store';
import { setWorldUnsaved } from '../lib/worlds';
import { confirmDialog } from './dialogs';
import { cx } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex items-center gap-2 rounded-xl px-3 py-1.5 font-display text-[1.0625rem] uppercase tracking-[0.05em] transition',
    isActive ? 'bg-accent text-on-accent' : 'text-ink hover:bg-raised',
  );

/**
 * The frame around every screen. Home is a page: stripes at the top, and the full logo
 * beside the bottom stripes. Map mode is a work area, so it fills the screen and keeps a
 * slim stripe with the C mark at the bottom.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const open = useApp((s) => s.open);
  const world = useApp((s) => s.world);
  const navigate = useNavigate();
  const isHome = !pathname.startsWith('/map/') && !pathname.startsWith('/world/');

  /** Leaving a world with unsaved changes asks first. */
  const guard = (to: string) => async (e: MouseEvent) => {
    if (!getState().worldUnsaved) return;
    e.preventDefault();
    const ok = await confirmDialog({ title: 'Leave without saving?', body: 'Changes since the last save are lost.', confirm: 'Leave', danger: true });
    if (!ok) return;
    setWorldUnsaved(false);
    navigate(to);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <NavLink to="/" onClick={guard('/')} className="mr-3 flex items-center gap-2.5">
          <AppMark size={32} />
          <span className="font-display text-xl uppercase leading-none tracking-wide">{APP_NAME}</span>
        </NavLink>
        <nav className="flex min-w-0 items-center gap-1">
          <NavLink to="/" end onClick={guard('/')} className={navClass}>
            Home
          </NavLink>
          {world.kind === 'ready' && (
            <NavLink to={`/world/${world.doc.id}`} className={navClass}>
              {world.doc.kind === 'setup' ? <Castle className="size-4" /> : <Hourglass className="size-4" />}
              <span className="max-w-64 truncate">{world.doc.name}</span>
            </NavLink>
          )}
          {open.kind === 'ready' && (
            <NavLink to={`/map/${open.map.id}`} className={navClass}>
              <MapIcon className="size-4" />
              <span className="max-w-64 truncate">{open.map.name}</span>
            </NavLink>
          )}
        </nav>
        <div className="flex-1" />
        {open.kind === 'ready' && <SaveIndicator />}
        {world.kind === 'ready' && <WorldSaveState />}
      </header>

      {isHome ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="stripes stripes-tl mt-5 shrink-0" aria-hidden />
          <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-14 pt-8 lg:px-10">{children}</main>
          <footer className="mb-5 shrink-0">
            <div className="relative">
              <div className="stripes stripes-br" aria-hidden />
              {/* The logo sits in the gap between the left edge and the bars, centered.
                  The longest bar reaches 77% of the way, which leaves 23%. */}
              <div className="absolute inset-y-0 left-0 flex w-[23%] items-center justify-center">
                <CroswellLogo className="w-[85%] max-w-[15rem] text-ink" />
              </div>
            </div>
          </footer>
        </div>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
          <footer className="relative shrink-0 border-t border-line bg-bg py-1.5">
            <div className="stripes stripes-br stripes-sm" aria-hidden />
            <div className="absolute inset-y-0 left-0 flex w-[23%] items-center justify-center">
              <CroswellMark className="h-5 text-ink" />
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

function WorldSaveState() {
  const unsaved = useApp((s) => s.worldUnsaved);
  return (
    <span className={cx('flex items-center gap-1.5 text-sm', unsaved ? 'text-warn' : 'text-muted')} aria-live="polite">
      {unsaved ? <AlertTriangle className="size-4" /> : <Check className="size-4" />}
      {unsaved ? 'Not saved' : 'Saved'}
    </span>
  );
}

function SaveIndicator() {
  const save = useApp((s) => s.save);
  if (save.state === 'error')
    return (
      <button onClick={() => void flushSaves()} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-warn hover:bg-raised" title={save.message}>
        <AlertTriangle className="size-4" />
        Could not save. Try again
      </button>
    );
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted" aria-live="polite">
      {save.state === 'saving' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      {save.state === 'saving' ? 'Saving' : 'Saved'}
    </span>
  );
}
