import type { TrackedEvent } from '../../shared/schemas';

/**
 * First-party conversion tracking. No cookies and no third-party scripts.
 * Every event is also pushed to window.dataLayer so a tag manager (GTM, Meta
 * Pixel via GTM, etc.) can be added later without touching components.
 */

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

export interface Attribution {
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  clickId: string;
  referrer: string;
  landingPage: string;
}

const ATTR_KEY = 'fae_attr_v1';
const SESSION_KEY = 'fae_sid';

function store(kind: 'local' | 'session') {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(kind: 'local' | 'session', key: string): T | null {
  try {
    const v = store(kind)?.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(kind: 'local' | 'session', key: string, value: unknown) {
  try {
    store(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode etc.) — tracking degrades gracefully */
  }
}

function fromUrl(): Attribution {
  const p = new URLSearchParams(window.location.search);
  const click = (['gclid', 'fbclid', 'msclkid', 'ttclid'] as const).find((k) => p.get(k));
  let referrer = '';
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    if (r && r.host !== window.location.host) referrer = r.origin + r.pathname;
  } catch {
    /* ignore */
  }
  return {
    source: p.get('src') ?? (p.get('utm_source') ? 'campaign' : referrer ? 'referral' : 'direct'),
    utmSource: p.get('utm_source') ?? '',
    utmMedium: p.get('utm_medium') ?? '',
    utmCampaign: p.get('utm_campaign') ?? '',
    utmContent: p.get('utm_content') ?? '',
    utmTerm: p.get('utm_term') ?? '',
    clickId: click ? `${click}:${p.get(click)}`.slice(0, 255) : '',
    referrer: referrer.slice(0, 500),
    landingPage: (window.location.pathname + window.location.search).slice(0, 300),
  };
}

let cached: Attribution | null = null;

/**
 * Attribution for this visitor. A new campaign/click (UTM or click ID in the
 * URL) replaces the stored one; otherwise the first touch is kept for 30 days.
 */
export function attribution(): Attribution {
  if (cached) return cached;
  const current = fromUrl();
  const stored = read<Attribution & { at: number }>('local', ATTR_KEY);
  const fresh = stored && Date.now() - stored.at < 30 * 86400000;
  const hasCampaign = current.utmSource || current.clickId;
  if (fresh && !hasCampaign) {
    const { at: _at, ...rest } = stored;
    cached = rest;
  } else {
    cached = current;
    write('local', ATTR_KEY, { ...current, at: Date.now() });
  }
  return cached;
}

export function sessionId(): string {
  let id = read<string>('session', SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    write('session', SESSION_KEY, id);
  }
  return id;
}

/** Fire a conversion event. `beacon: false` for events the server records itself. */
export function track(name: TrackedEvent, props: Record<string, string | number | boolean> = {}, beacon = true) {
  const a = attribution();
  (window.dataLayer ??= []).push({ event: name, ...props, utm_source: a.utmSource, utm_campaign: a.utmCampaign });
  if (!beacon) return;
  const body = JSON.stringify({
    name,
    props,
    sessionId: sessionId(),
    path: window.location.pathname,
    utmSource: a.utmSource,
    utmCampaign: a.utmCampaign,
  });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.('/api/events', blob)) return;
  } catch {
    /* fall through */
  }
  fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}
