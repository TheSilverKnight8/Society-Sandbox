import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button, Input, cx } from './ui';

// Small app-wide dialogs and notices: confirm, prompt, alert, notify. One host renders them.

type Dialog =
  | { kind: 'confirm'; title: string; body?: ReactNode; confirm: string; danger?: boolean; alert?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; value: string; confirm: string; resolve: (v: string | null) => void };

interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

let dialog: Dialog | null = null;
let notices: Notice[] = [];
let noticeId = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function confirmDialog(opts: { title: string; body?: ReactNode; confirm: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    dialog = { kind: 'confirm', ...opts, resolve };
    emit();
  });
}

/** A message with one OK button, for something the app refused or could not do. */
export function alertDialog(opts: { title: string; body?: ReactNode }) {
  return new Promise<void>((resolve) => {
    dialog = { kind: 'confirm', ...opts, confirm: 'OK', alert: true, resolve: () => resolve() };
    emit();
  });
}

export function promptDialog(opts: { title: string; label: string; value?: string; confirm?: string }) {
  return new Promise<string | null>((resolve) => {
    dialog = { kind: 'prompt', title: opts.title, label: opts.label, value: opts.value ?? '', confirm: opts.confirm ?? 'Save', resolve };
    emit();
  });
}

/** A short message at the bottom of the screen that goes away by itself. */
export function notify(text: string, tone: Notice['tone'] = 'info') {
  const id = ++noticeId;
  notices = [...notices.filter((n) => n.text !== text), { id, text, tone }];
  emit();
  window.setTimeout(() => {
    notices = notices.filter((n) => n.id !== id);
    emit();
  }, 5000);
}

function close() {
  dialog = null;
  emit();
}

export function DialogHost() {
  const d = useSyncExternalStore(subscribe, () => dialog);
  const n = useSyncExternalStore(subscribe, () => notices);
  return (
    <>
      {d && <DialogBox key={d.title} d={d} />}
      <div className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex flex-col items-center gap-2 px-4">
        {n.map((x) => (
          <div
            key={x.id}
            role="status"
            className={cx(
              'pointer-events-auto flex max-w-xl animate-rise items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-pop',
              x.tone === 'warn' ? 'border-warn/40 bg-surface text-ink' : 'border-line bg-navy text-on-accent',
            )}
          >
            {x.tone === 'warn' && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />}
            <span className="flex-1">{x.text}</span>
            <button
              className="opacity-70 hover:opacity-100"
              aria-label="Dismiss"
              onClick={() => {
                notices = notices.filter((m) => m.id !== x.id);
                emit();
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function DialogBox({ d }: { d: Dialog }) {
  const [value, setValue] = useState(d.kind === 'prompt' ? d.value : '');
  const input = useRef<HTMLInputElement>(null);
  const done = (ok: boolean) => {
    if (d.kind === 'confirm') d.resolve(ok);
    else d.resolve(ok && value.trim() ? value.trim() : null);
    close();
  };
  // Select the starting text once, when the dialog opens. (Doing it on every render
  // selected the text after each keystroke, so the next key replaced it.)
  useEffect(() => {
    input.current?.select();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-navy/30 p-4" onPointerDown={(e) => e.target === e.currentTarget && done(false)}>
      <form
        role="dialog"
        aria-modal
        aria-label={d.title}
        className="w-full max-w-md animate-rise rounded-2xl border border-line bg-surface p-6 shadow-pop"
        onSubmit={(e) => {
          e.preventDefault();
          done(true);
        }}
      >
        <h2 className="text-2xl">{d.title}</h2>
        {d.kind === 'confirm' && d.body && <div className="mt-2 text-sm text-muted">{d.body}</div>}
        {d.kind === 'prompt' && (
          <label className="mt-4 block space-y-1.5">
            <span className="block text-sm font-medium">{d.label}</span>
            <Input ref={input} value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {!(d.kind === 'confirm' && d.alert) && (
            <Button variant="ghost" size="sm" onClick={() => done(false)}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant={d.kind === 'confirm' && d.danger ? 'danger' : 'primary'} size="sm" disabled={d.kind === 'prompt' && !value.trim()}>
            {d.confirm}
          </Button>
        </div>
      </form>
    </div>
  );
}
