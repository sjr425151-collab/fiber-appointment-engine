/**
 * The chat window. Talks to /api/platform/chat; every figure it shows comes
 * from the server (the same benchmark calculation as the savings form).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BRAND } from '../../../shared/content';
import { formatCents, parseDollars } from '../../../shared/finance/money';
import type { ChatBills } from '../../../shared/chat/extract';
import type { QuickPreview } from '../../../shared/platform/benchmarks';
import { BEST_TIME_LABEL, BEST_TIMES, handoffConsentText, marketingConsentText } from '../../../shared/platform/handoff';
import { attribution, sessionId, track } from '../../lib/analytics';
import { api, ApiError } from '../../lib/api';
import { TuckerFace } from './ChatLauncher';

interface Card {
  preview?: QuickPreview | null;
  disclosure?: string;
  quickReplies?: string[];
  offerHuman?: boolean;
}
interface Msg {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  card: Card | null;
  createdAt: string;
}
interface ChatResponse {
  id: string;
  token?: string;
  state: { bills: ChatBills; step: string };
  status: string;
  handedOff: boolean;
  ai: boolean;
  messages: Msg[];
  handoff?: { leadId: string; repeat: boolean; routing: { outcome: string } };
}

const STORE = 'tucker-chat';
const LABEL: Record<string, string> = { internet: 'Home internet', mobile: 'Phone', tv: 'TV & streaming', electricity: 'Electricity', security: 'Home security' };
const whole = (c: number) => formatCents(c, { cents: false });

const saved = (): { id: string; token: string } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { id: string; token: string; at: number } | null;
    // Chats are kept on this device for a week at most.
    return v && Date.now() - v.at < 7 * 86_400_000 ? v : null;
  } catch {
    return null;
  }
};
const remember = (id: string, token: string) => {
  try {
    localStorage.setItem(STORE, JSON.stringify({ id, token, at: Date.now() }));
  } catch {
    /* not stored: the chat still works for this page */
  }
};
const forget = () => {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* nothing stored */
  }
};

function SavingsCard({ preview, disclosure, onEdit, busy }: { preview: QuickPreview; disclosure?: string; onEdit: (category: string, cents: number) => void; busy: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const compared = preview.rows.filter((r) => r.benchmark !== null);
  return (
    <div className="mt-2 rounded-2xl border border-pf-line bg-pf-surface p-4 text-sm shadow-pf-card">
      <p className="font-display font-bold text-pf-ink">{preview.rows.length === 1 ? `Your ${LABEL[preview.rows[0].category].toLowerCase()} savings preview` : 'Your household savings preview'}</p>
      <ul className="mt-2 divide-y divide-pf-line">
        {preview.rows.map((r) => (
          <li key={r.category} className="py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-pf-ink">{LABEL[r.category]}</span>
              <span className={`tnum ${(r.difference ?? 0) < 0 ? 'text-pf-warn' : 'text-pf-save'} font-semibold`}>
                {r.note ? '' : (r.difference ?? 0) > 0 ? `${whole(r.savings)}/mo less` : (r.difference ?? 0) < 0 ? `${whole(-(r.difference ?? 0))}/mo more` : 'Same'}
              </span>
            </div>
            {editing === r.category ? (
              <form
                className="mt-1 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const cents = parseDollars(value);
                  if (cents !== null && cents >= 0 && cents <= 1_000_000) {
                    onEdit(r.category, cents);
                    setEditing(null);
                  }
                }}
              >
                <label className="sr-only" htmlFor={`edit-${r.category}`}>
                  New monthly amount for {LABEL[r.category]}
                </label>
                <span className="text-pf-muted" aria-hidden>
                  $
                </span>
                <input id={`edit-${r.category}`} inputMode="decimal" autoFocus className="w-24 rounded-lg border border-pf-field px-2 py-1 text-pf-ink" value={value} onChange={(e) => setValue(e.target.value)} />
                <button className="rounded-lg bg-pf-brand px-3 py-1 text-white" disabled={busy}>
                  Update
                </button>
              </form>
            ) : (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-pf-muted">
                <span>
                  You pay {whole(r.current)}/mo{r.benchmark !== null ? ` · compared with ${whole(r.benchmark)}` : ''}
                </span>
                <button
                  type="button"
                  className="text-pf-brand underline underline-offset-2"
                  onClick={() => {
                    setEditing(r.category);
                    setValue((r.current / 100).toFixed(2));
                  }}
                  aria-label={`Change ${LABEL[r.category]} amount`}
                >
                  Change
                </button>
              </p>
            )}
            {r.note && <p className="mt-0.5 text-xs text-pf-subtle">{r.note}</p>}
          </li>
        ))}
      </ul>
      {compared.length > 1 && (
        <dl className="mt-2 grid grid-cols-2 gap-1 border-t border-pf-line pt-2 text-pf-muted">
          <dt>You pay now</dt>
          <dd className="tnum text-right text-pf-ink">{whole(compared.reduce((t, r) => t + r.current, 0))}/mo</dd>
          <dt>Illustrative comparison</dt>
          <dd className="tnum text-right text-pf-ink">{whole(preview.benchmarkMonthly)}/mo</dd>
        </dl>
      )}
      <div className="mt-2 rounded-xl bg-pf-save-soft p-3">
        <p className="text-pf-subtle">Potential difference</p>
        <p className="font-display text-xl font-bold text-pf-save">{preview.monthlySavings > 0 ? `${whole(preview.monthlySavings)}/month` : 'None against our benchmarks'}</p>
        {preview.monthlySavings > 0 && <p className="text-pf-ink">About {whole(preview.annualSavings)} a year</p>}
      </div>
      <p className="mt-2 text-xs text-pf-subtle">Illustrative comparison only, not an offer. {disclosure}</p>
    </div>
  );
}

function HandoffForm({ onSubmit, busy, error }: { onSubmit: (v: Record<string, unknown>) => void; busy: boolean; error: string }) {
  const [f, setF] = useState({ firstName: '', phone: '', zip: '', email: '', preferredContact: 'phone', bestTime: 'anytime' });
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const key = useRef(crypto.randomUUID());
  const field = (k: keyof typeof f, label: string, props: Record<string, string> = {}) => (
    <div>
      <label htmlFor={`ch-${k}`} className="mb-1 block text-xs font-semibold text-pf-ink">
        {label}
      </label>
      <input
        id={`ch-${k}`}
        className="w-full rounded-lg border border-pf-field px-3 py-2 text-base text-pf-ink"
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: k === 'zip' ? e.target.value.replace(/\D/g, '').slice(0, 5) : e.target.value })}
        {...props}
      />
    </div>
  );
  return (
    <form
      className="mt-2 space-y-3 rounded-2xl border border-pf-line bg-pf-surface p-4 text-sm"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({ ...f, consent, marketingConsent: marketing, requestKey: key.current, sessionId: sessionId() });
      }}
    >
      <p className="font-semibold text-pf-ink">Talk to a Real Representative</p>
      <p className="text-pf-muted">A person on the {BRAND.name} Team will contact you to check real prices for your address. Everything from this chat goes with your request.</p>
      {field('firstName', 'First name', { autoComplete: 'given-name' })}
      <div className="grid grid-cols-[1fr_6.5rem] gap-2">
        {field('phone', 'Phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
        {field('zip', 'ZIP code', { inputMode: 'numeric', autoComplete: 'postal-code' })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="ch-contact" className="mb-1 block text-xs font-semibold text-pf-ink">
            Contact me by
          </label>
          <select id="ch-contact" className="w-full rounded-lg border border-pf-field px-2 py-2 text-pf-ink" value={f.preferredContact} onChange={(e) => setF({ ...f, preferredContact: e.target.value })}>
            <option value="phone">Phone call</option>
            <option value="text">Text message</option>
            <option value="email">Email</option>
          </select>
        </div>
        <div>
          <label htmlFor="ch-time" className="mb-1 block text-xs font-semibold text-pf-ink">
            Best time
          </label>
          <select id="ch-time" className="w-full rounded-lg border border-pf-field px-2 py-2 text-pf-ink" value={f.bestTime} onChange={(e) => setF({ ...f, bestTime: e.target.value })}>
            {BEST_TIMES.map((t) => (
              <option key={t} value={t}>
                {BEST_TIME_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {f.preferredContact === 'email' && field('email', 'Email', { type: 'email', autoComplete: 'email' })}
      <label className="flex items-start gap-2 text-xs text-pf-muted">
        <input id="ch-consent" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{handoffConsentText()}</span>
      </label>
      <label className="flex items-start gap-2 text-xs text-pf-muted">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>{marketingConsentText()}</span>
      </label>
      {error && (
        <p role="alert" className="font-medium text-pf-cost">
          {error}
        </p>
      )}
      <button className="min-h-11 w-full rounded-xl bg-pf-brand font-semibold text-white disabled:opacity-60" disabled={busy}>
        {busy ? 'Sending…' : 'Request my representative'}
      </button>
    </form>
  );
}

export default function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [token, setToken] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const pending = useRef<{ text: string; clientId: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstSent = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  async function start() {
    const a = attribution();
    const r = await api<ChatResponse>('/platform/chat/sessions', { method: 'POST', body: { landingPage: window.location.pathname, utmSource: a.utmSource, utmCampaign: a.utmCampaign } });
    remember(r.id, r.token!);
    setToken(r.token!);
    setChat(r);
  }

  // Open: resume the chat saved on this device, or start one.
  useEffect(() => {
    if (!open || chat) return;
    const s = saved();
    (async () => {
      try {
        if (s) {
          const r = await api<ChatResponse>(`/platform/chat/sessions/${encodeURIComponent(s.id)}?t=${encodeURIComponent(s.token)}`);
          setToken(s.token);
          setChat(r);
          return;
        }
        await start();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          forget();
          await start().catch(() => setError('We couldn’t start the chat. Check your connection and try again.'));
        } else setError('We couldn’t start the chat. Check your connection and try again.');
      }
    })();
  }, [open, chat]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat?.messages.length, asking]);
  // Opening moves focus into the chat once it is ready: the message box with a mouse or keyboard;
  // the window itself on touch screens, so the on-screen keyboard doesn't pop up uninvited.
  const ready = !!chat;
  useEffect(() => {
    if (!open || !ready) return;
    requestAnimationFrame(() => (window.matchMedia('(pointer: fine)').matches ? inputRef.current : panelRef.current)?.focus());
  }, [open, ready]);
  // Phones: keep the window inside the visible area when the on-screen keyboard opens, so the message box stays in view.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = panelRef.current;
    if (!open || !vv || !el) return;
    const fit = () => {
      if (window.matchMedia('(min-width: 640px)').matches) {
        el.style.height = '';
        el.style.top = '';
        return;
      }
      el.style.height = `${vv.height}px`;
      el.style.top = `${vv.offsetTop}px`;
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.height = '';
      el.style.top = '';
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  async function send(message: string) {
    if (!chat || !message.trim() || busy) return;
    // The same clientId is reused on a retry, so a message is never stored or answered twice.
    if (!pending.current || pending.current.text !== message) pending.current = { text: message, clientId: crypto.randomUUID() };
    setBusy(true);
    setError('');
    const optimistic: Msg = { id: `local-${pending.current.clientId}`, role: 'user', body: message, card: null, createdAt: new Date().toISOString() };
    setChat({ ...chat, messages: [...chat.messages.filter((m) => !m.id.startsWith('local-')), optimistic] });
    setText('');
    try {
      const r = await api<ChatResponse>(`/platform/chat/sessions/${encodeURIComponent(chat.id)}/messages`, { method: 'POST', body: { t: token, text: message, clientId: pending.current.clientId } });
      pending.current = null;
      setChat(r);
      if (!firstSent.current) {
        firstSent.current = true;
        track('chat_first_message', {});
      }
    } catch (err) {
      setText(message);
      setError(err instanceof ApiError && err.status !== 429 ? err.message : 'Your message didn’t send. Check your connection and try again; nothing was lost.');
    } finally {
      setBusy(false);
    }
  }

  async function editAmount(category: string, cents: number) {
    if (!chat) return;
    setBusy(true);
    try {
      setChat(await api<ChatResponse>(`/platform/chat/sessions/${encodeURIComponent(chat.id)}/bills`, { method: 'POST', body: { t: token, bills: { [category]: cents } } }));
    } catch {
      setError('That change didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handoff(v: Record<string, unknown>) {
    if (!chat) return;
    setBusy(true);
    setHandoffError('');
    try {
      const r = await api<ChatResponse>(`/platform/chat/sessions/${encodeURIComponent(chat.id)}/handoff`, { method: 'POST', body: { t: token, ...v } });
      setChat(r);
      setAsking(false);
    } catch (err) {
      setHandoffError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : 'We couldn’t send your request. Try again; nothing you typed was lost.');
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    forget();
    setChat(null);
    setAsking(false);
    setError('');
  }

  const last = chat?.messages.at(-1);
  const quick = last?.role === 'assistant' ? (last.card?.quickReplies ?? []) : [];
  const offerHuman = !chat?.handedOff && (last?.card?.offerHuman || chat?.messages.some((m) => m.card?.preview));

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby="chat-title"
      hidden={!open}
      className="tucker-panel fixed inset-0 z-50 flex flex-col bg-pf-surface sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[400px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-pf-line sm:shadow-pf-raised"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center gap-3 border-b border-pf-line bg-pf-surface px-4 py-3">
        <span className="shrink-0 rounded-full p-[2px] ring-2 ring-pf-brand">
          <TuckerFace size={40} className="h-10 w-10" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="chat-title" className="flex items-center gap-2 font-display text-[17px] font-bold text-pf-ink">
            Tucker <span className="rounded-full bg-pf-brand-soft px-2 py-0.5 text-xs font-semibold text-pf-brand">AI assistant</span>
          </h2>
          <p className="truncate text-xs text-pf-subtle">Your home savings assistant · an AI, not a person</p>
        </div>
        <button type="button" onClick={restart} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-pf-muted hover:text-pf-ink">
          Start over
        </button>
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg text-pf-muted hover:bg-pf-bg hover:text-pf-ink" aria-label="Minimize chat">
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-label="Conversation">
        {!chat && !error && <p className="text-sm text-pf-muted">Starting the chat…</p>}
        {chat?.messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-md bg-pf-brand px-4 py-2.5 text-sm text-white' : 'max-w-[92%]'}>
              {m.role === 'assistant' && <p className="sr-only">Tucker (AI assistant) says:</p>}
              <p className={m.role === 'assistant' ? 'whitespace-pre-line rounded-2xl rounded-bl-md bg-pf-brand-soft px-4 py-2.5 text-sm text-pf-ink' : 'whitespace-pre-line'}>{m.body}</p>
              {m.card?.preview && m.card.preview.rows.length > 0 && <SavingsCard preview={m.card.preview} disclosure={m.card.disclosure} busy={busy} onEdit={editAmount} />}
            </div>
          </div>
        ))}
        {busy && !asking && (
          <p className="text-sm text-pf-subtle" role="status">
            Tucker is typing…
          </p>
        )}
        {asking && <HandoffForm onSubmit={handoff} busy={busy} error={handoffError} />}
      </div>

      {chat && (
        <div className="border-t border-pf-line bg-pf-surface px-4 py-3">
          {offerHuman && !asking && (
            <button
              type="button"
              onClick={() => {
                setAsking(true);
                track('chat_handoff_click', {});
              }}
              className="mb-2 min-h-11 w-full rounded-xl bg-pf-brand font-semibold text-white"
            >
              Talk to a Real Representative
            </button>
          )}
          {quick.length > 0 && !asking && (
            <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
              {quick.map((q) => (
                <button key={q} type="button" disabled={busy} onClick={() => send(q)} className="min-h-11 shrink-0 rounded-full border border-pf-line px-3 text-sm text-pf-ink hover:border-pf-brand">
                  {q}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="mb-2 text-sm font-medium text-pf-cost">
              {error}{' '}
              <a href="/#preview" className="underline">
                Use the savings form instead
              </a>
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Message Tucker
            </label>
            <input
              id="chat-input"
              ref={inputRef}
              className="min-h-11 flex-1 rounded-xl border border-pf-field px-3 text-base text-pf-ink"
              placeholder="e.g. internet $110, phone $180 for 3 lines"
              value={text}
              maxLength={800}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
            />
            <button className="min-h-11 rounded-xl bg-pf-brand px-4 font-semibold text-white disabled:opacity-60" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
          {!chat.handedOff && !offerHuman && (
            <button type="button" onClick={() => setAsking(true)} className="mt-2 min-h-11 text-xs font-semibold text-pf-brand underline underline-offset-2">
              Prefer a person? Talk to a representative
            </button>
          )}
        </div>
      )}
    </div>
  );
}
