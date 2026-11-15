export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Requested-With': 'fetch',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Request failed', data.fields ?? {});
  return data as T;
}

export const TZ = 'America/Detroit';

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }, tz = TZ) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(iso));
}

export function fmtDateTime(iso: string, tz = TZ) {
  return fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, tz);
}

/** Short zone label, e.g. "EST" / "CDT", for showing appointment times. */
export function tzLabel(tz: string, at = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Format a local YYYY-MM-DD calendar date without timezone drift. */
export function fmtCalendarDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function fmtPhone(p: string) {
  return p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;
}

export const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  appointment_set: 'Appointment set',
  sold: 'Sold',
  install_scheduled: 'Install scheduled',
  installed: 'Installed',
  lost: 'Lost',
};

export const STATUS_COLORS: Record<string, string> = {
  new: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
  contacted: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  appointment_set: 'bg-violet-500/15 text-violet-300 ring-violet-400/30',
  sold: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  install_scheduled: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/30',
  installed: 'bg-green-500/20 text-green-300 ring-green-400/30',
  lost: 'bg-slate-500/15 text-slate-400 ring-slate-400/30',
};
