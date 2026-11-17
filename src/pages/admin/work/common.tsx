/** Small shared pieces for the Agent Workspace screens. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DISPOSITION_LABEL, NO_DISPOSITION_LABEL, OUTCOME_LABEL, QUALIFICATION_LABEL, type Disposition, type Outcome, type Qualification } from '../../../../shared/team/workspace';
import { ApiError } from '../../../lib/api';

/** The viewer's own time zone (follow-ups are shown and bucketed in it). */
export const myTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
};
export const rid = () => crypto.randomUUID();
/** Has this moment passed? */
export const isPast = (iso: string) => new Date(iso).getTime() < Date.now();
export const when = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) =>
  new Intl.DateTimeFormat('en-US', opts).format(new Date(iso));
export function ago(iso: string | null): string {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (Math.abs(m) < 1) return 'just now';
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  const abs = Math.abs(m);
  const s = abs < 60 ? fmt(abs, 'min') : abs < 1440 ? fmt(Math.round(abs / 60), 'hour') : fmt(Math.round(abs / 1440), 'day');
  return m >= 0 ? `${s} ago` : `in ${s}`;
}
export const errorText = (err: unknown, fallback = 'That didn’t save. Check your connection and try again; nothing was lost.') => (err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : fallback);

/** `datetime-local` value for a Date in the browser's zone. */
export const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Pill({ children, tone = 'slate', title }: { children: ReactNode; tone?: 'slate' | 'sky' | 'amber' | 'emerald' | 'rose' | 'violet'; title?: string }) {
  const tones = {
    slate: 'bg-white/5 text-slate-300 ring-white/15',
    sky: 'bg-sky-500/15 text-sky-200 ring-sky-400/30',
    amber: 'bg-amber-500/15 text-amber-200 ring-amber-400/30',
    emerald: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
    rose: 'bg-rose-500/15 text-rose-200 ring-rose-400/30',
    violet: 'bg-violet-500/15 text-violet-200 ring-violet-400/30',
  };
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}
export const DispositionPill = ({ code }: { code: string }) => <Pill tone={code ? 'sky' : 'violet'}>{code ? (DISPOSITION_LABEL[code as Disposition] ?? code) : NO_DISPOSITION_LABEL}</Pill>;
export const QualificationPill = ({ q }: { q: string }) =>
  q && q !== 'unknown' ? <Pill tone={q === 'qualified' ? 'emerald' : q === 'not_qualified' || q === 'ineligible' ? 'rose' : 'amber'}>{QUALIFICATION_LABEL[q as Qualification] ?? q}</Pill> : null;
export const OutcomePill = ({ o }: { o: string }) => (o ? <Pill tone={o === 'won' ? 'emerald' : 'rose'}>{OUTCOME_LABEL[o as Outcome] ?? o}</Pill> : null);

/**
 * A dialog: a bottom sheet on phones, a centred panel on larger screens.
 * Escape closes it and focus returns to what opened it.
 */
export function Sheet({ title, open, onClose, children, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus());
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      before?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-ink-900 p-5 shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button type="button" data-close onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A short confirmation that disappears by itself, announced to screen readers. */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.tone === 'error' ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 sm:bottom-6">
      {msg && <p className={`pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-medium shadow-xl ${msg.tone === 'ok' ? 'bg-emerald-500 text-ink-950' : 'bg-rose-500 text-white'}`}>{msg.text}</p>}
    </div>
  );
  return { toast: (text: string, tone: 'ok' | 'error' = 'ok') => setMsg({ text, tone }), toastNode: node };
}

/** Recently opened leads, kept on this device only. */
const RECENT = 'tucker-recent-leads';
export function rememberLead(id: string, name: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as { id: string; name: string; at: string }[]).filter((x) => x.id !== id);
    localStorage.setItem(RECENT, JSON.stringify([{ id, name, at: new Date().toISOString() }, ...list].slice(0, 8)));
  } catch {
    /* not stored */
  }
}
export function recentLeads(): { id: string; name: string; at: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]');
  } catch {
    return [];
  }
}
/** The lead list the person last opened a lead from, for "Next lead". */
const QUEUE = 'tucker-work-queue';
export function rememberQueue(ids: string[], label: string) {
  try {
    sessionStorage.setItem(QUEUE, JSON.stringify({ ids, label }));
  } catch {
    /* not stored */
  }
}
export function nextInQueue(id: string): { next: string | null; label: string } {
  try {
    const q = JSON.parse(sessionStorage.getItem(QUEUE) ?? 'null') as { ids: string[]; label: string } | null;
    if (!q) return { next: null, label: '' };
    const i = q.ids.indexOf(id);
    return { next: i >= 0 && i < q.ids.length - 1 ? q.ids[i + 1] : null, label: q.label };
  } catch {
    return { next: null, label: '' };
  }
}
