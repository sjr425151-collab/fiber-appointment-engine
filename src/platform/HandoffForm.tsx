/**
 * "Get My Exact Pricing": the short request a household sends after seeing its
 * illustrative preview. First name, phone, ZIP and consent are all that is
 * required; everything already typed (the bills) is sent along, never asked again.
 * Success is shown only after the server confirms the lead was saved.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Cents } from '../../shared/finance/money';
import type { PlatformCategory } from '../../shared/platform/assessment';
import { BEST_TIME_LABEL, BEST_TIMES, HANDOFF_COPY, handoffConsentText, handoffSchema, marketingConsentText, type HandoffResult } from '../../shared/platform/handoff';
import { attribution, sessionId, track } from '../lib/analytics';
import { api, ApiError, fmtPhone } from '../lib/api';
import { Button, Field, Select, TextInput } from './ds';
import { resultsPath } from './lib';

const CONTACT_LABEL = { phone: 'Phone call', text: 'Text message', email: 'Email' } as const;
const REQUIRED = ['firstName', 'phone', 'zip'] as const;
const OPTIONAL = ['email', 'street'] as const;

export function HandoffDone({ result, contact, phone }: { result: HandoffResult; contact: keyof typeof CONTACT_LABEL; phone?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // The form was replaced by this message: move focus here so it is announced and not lost.
  useEffect(() => ref.current?.focus(), []);
  const { outcome, representative } = result.routing;
  return (
    <div ref={ref} tabIndex={-1} role="status" className="rounded-xl bg-pf-save-soft p-4 outline-none">
      <h3 className="font-display text-xl font-bold text-pf-ink">{HANDOFF_COPY.doneTitle}</h3>
      <p className="mt-2 text-pf-ink">{HANDOFF_COPY.doneBody}</p>
      <dl className="mt-3 space-y-1 text-sm text-pf-ink">
        <div className="flex gap-2">
          <dt className="font-semibold">With:</dt>
          <dd>{representative ? `${representative}, on the Tucker team` : 'The Tucker team'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Contact by:</dt>
          <dd>
            {CONTACT_LABEL[contact]}
            {phone && contact !== 'email' ? `, ${fmtPhone(phone)}` : ''}
          </dd>
        </div>
      </dl>
      {outcome === 'unsupported' && <p className="mt-3 text-sm text-pf-ink">{HANDOFF_COPY.unsupported}</p>}
      <p className="mt-3 text-sm text-pf-muted">The figures you saw are a preliminary comparison. Your representative confirms real prices and availability for your address.</p>
      {result.results && (
        <p className="mt-3">
          <Link to={resultsPath(result.results.id, result.results.token)} className="font-semibold text-pf-brand underline underline-offset-4">
            See my full preview
          </Link>
        </p>
      )}
    </div>
  );
}

export function HandoffForm({ bills, mobileLines, ownsHome, onCancel }: { bills: Record<PlatformCategory, Cents | null>; mobileLines: number; ownsHome: boolean; onCancel: () => void }) {
  const [form, setForm] = useState({ firstName: '', phone: '', zip: '', email: '', street: '', preferredContact: 'phone', bestTime: 'anytime' });
  const [more, setMore] = useState(false);
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HandoffResult | null>(null);
  // One key for this open form: a retry or double tap can never create a second lead.
  const requestKey = useRef(crypto.randomUUID());
  const started = useRef(false);
  useEffect(() => document.getElementById('ho-firstName')?.focus(), []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    if (!started.current) {
      started.current = true;
      track('handoff_start', { from: 'home' });
    }
    setForm((f) => ({ ...f, [k]: k === 'zip' ? e.target.value.replace(/\D/g, '').slice(0, 5) : e.target.value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, consent, marketingConsent: marketing, requestKey: requestKey.current, bills, mobileLines, ownsHome, ...attribution(), landingPage: window.location.pathname, sessionId: sessionId() };
    // The same schema the server uses, so mistakes show at once.
    const parsed = handoffSchema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[String(i.path[0] ?? '_')] ??= i.message;
      setErrors({ ...fields, _: fields.bills ?? 'Please fix the highlighted fields.' });
      if (OPTIONAL.some((k) => fields[k])) setMore(true);
      const focus = [...REQUIRED, ...OPTIONAL, 'consent'].find((k) => fields[k]);
      if (focus) requestAnimationFrame(() => document.getElementById(`ho-${focus}`)?.focus());
      track('handoff_error', { kind: 'validation' });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      setResult(await api<HandoffResult>('/platform/handoff', { method: 'POST', body }));
      track('handoff_submit', { from: 'home' }, false); // recorded by the server
    } catch (err) {
      // Everything typed stays in place; sending again is safe.
      const known = err instanceof ApiError;
      if (known && OPTIONAL.some((k) => err.fields[k])) setMore(true);
      setErrors(known ? { ...err.fields, _: err.status === 429 ? 'Too many requests from this connection. Please wait a few minutes and try again.' : err.message } : { _: 'We couldn’t send your request. Check your connection and try again. Nothing you typed was lost.' });
      track('handoff_error', { kind: known ? 'server' : 'network' });
    } finally {
      setBusy(false);
    }
  }

  if (result) return <HandoffDone result={result} contact={form.preferredContact as keyof typeof CONTACT_LABEL} phone={form.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')} />;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="ho-title"
      className="space-y-4"
    >
      <div>
        <h3 id="ho-title" className="font-display text-xl font-bold text-pf-ink">
          {HANDOFF_COPY.cta}
        </h3>
        <p className="mt-1 text-sm text-pf-muted">{HANDOFF_COPY.support}</p>
      </div>
      <Field id="ho-firstName" label="First name" error={errors.firstName}>
        {(p) => <TextInput id={p.id} autoComplete="given-name" aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={form.firstName} onChange={set('firstName')} />}
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field id="ho-phone" label="Phone number" error={errors.phone}>
          {(p) => <TextInput id={p.id} type="tel" inputMode="tel" autoComplete="tel" aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={form.phone} onChange={set('phone')} />}
        </Field>
        <Field id="ho-zip" label="ZIP code" error={errors.zip}>
          {(p) => <TextInput id={p.id} inputMode="numeric" autoComplete="postal-code" maxLength={5} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={form.zip} onChange={set('zip')} />}
        </Field>
      </div>

      <button type="button" aria-expanded={more} aria-controls="ho-more" onClick={() => setMore((m) => !m)} className="min-h-11 text-left text-sm font-semibold text-pf-brand underline underline-offset-4">
        {more ? 'Hide optional details' : 'Add email, address or a best time (optional)'}
      </button>
      <div id="ho-more" hidden={!more} className="space-y-4">
        <Field id="ho-email" label="Email" optional error={errors.email}>
          {(p) => <TextInput id={p.id} type="email" autoComplete="email" aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={form.email} onChange={set('email')} />}
        </Field>
        <Field id="ho-street" label="Street address" optional hint="Helps us check what is available before we contact you." error={errors.street}>
          {(p) => <TextInput id={p.id} autoComplete="address-line1" aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={form.street} onChange={set('street')} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="ho-contact" label="Contact me by" optional>
            {(p) => <Select id={p.id} value={form.preferredContact} onChange={set('preferredContact')} options={Object.entries(CONTACT_LABEL).map(([value, label]) => ({ value, label }))} />}
          </Field>
          <Field id="ho-time" label="Best time" optional>
            {(p) => <Select id={p.id} value={form.bestTime} onChange={set('bestTime')} options={BEST_TIMES.map((t) => ({ value: t, label: BEST_TIME_LABEL[t] }))} />}
          </Field>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-pf-line p-3 text-sm text-pf-muted">
        <input
          id="ho-consent"
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          aria-invalid={!!errors.consent || undefined}
          aria-describedby={errors.consent ? 'ho-consent-err' : undefined}
        />
        <span>{handoffConsentText()}</span>
      </label>
      {errors.consent && (
        <p id="ho-consent-err" className="text-sm font-medium text-pf-cost">
          {errors.consent}
        </p>
      )}
      <label className="flex cursor-pointer items-start gap-3 px-3 text-sm text-pf-muted">
        <input id="ho-marketing" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>{marketingConsentText()}</span>
      </label>

      {errors._ && (
        <p role="alert" className="text-sm font-medium text-pf-cost">
          {errors._}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {HANDOFF_COPY.submit}
      </Button>
      <ul className="space-y-1 text-sm text-pf-muted">
        {HANDOFF_COPY.reassurance.map((r) => (
          <li key={r} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pf-save" aria-hidden />
            {r}
          </li>
        ))}
      </ul>
      <p className="text-center">
        <button type="button" onClick={onCancel} className="min-h-11 text-sm font-semibold text-pf-muted underline underline-offset-4">
          Not now
        </button>
      </p>
    </form>
  );
}
