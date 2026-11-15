import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AvailabilityResult, Slot } from '../../shared/schemas';
import { BRAND, CONSENT_TEXT, OMNI_LINKS } from '../../shared/content';
import { api, ApiError, fmtCalendarDate, fmtDateTime } from '../lib/api';
import { attribution, sessionId, track } from '../lib/analytics';
import AvailabilityBanner from './AvailabilityBanner';
import { Check, Field, Spinner } from './ui';

type Step = 'details' | 'schedule' | 'done';

interface LeadResponse {
  leadId: string;
  bookingToken: string;
  availability: AvailabilityResult;
}

export default function SignupFlow({ zip, city, availability }: { zip: string; city: string; availability: AvailabilityResult | null }) {
  const [step, setStep] = useState<Step>('details');
  const [lead, setLead] = useState<LeadResponse | null>(null);
  const [firstName, setFirstName] = useState('');
  const [bookedAt, setBookedAt] = useState<string | null>(null);

  const wantsBooking = availability?.status !== 'not_serviceable';

  return (
    <div className="glass overflow-hidden" id="signup">
      <ol className="flex border-b border-white/10 text-sm" aria-label="Progress">
        {(['details', 'schedule', 'done'] as Step[]).map((s, i) => {
          const active = s === step;
          const doneIdx = ['details', 'schedule', 'done'].indexOf(step);
          return (
            <li key={s} aria-current={active ? 'step' : undefined} className={`flex flex-1 items-center gap-2 px-4 py-3 sm:px-6 ${active ? 'text-white' : 'text-slate-400'}`}>
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${i < doneIdx ? 'bg-fiber-400 text-ink-950' : active ? 'bg-white text-ink-950' : 'bg-white/10'}`}>
                {i < doneIdx ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="sr-only sm:not-sr-only">{['Your details', 'Pick a time', 'Confirmed'][i]}</span>
            </li>
          );
        })}
      </ol>
      <div className="p-5 sm:p-8">
        {step === 'details' && (
          <DetailsStep
            zip={zip}
            city={city}
            onDone={(r, name) => {
              setLead(r);
              setFirstName(name);
              setStep(r.availability.status === 'not_serviceable' || !wantsBooking ? 'done' : 'schedule');
            }}
          />
        )}
        {step === 'schedule' && lead && (
          <ScheduleStep
            lead={lead}
            onBooked={(start) => {
              setBookedAt(start);
              setStep('done');
            }}
            onSkip={() => setStep('done')}
          />
        )}
        {step === 'done' && <DoneStep name={firstName} bookedAt={bookedAt} />}
      </div>
    </div>
  );
}

function DetailsStep({ zip, city, onDone }: { zip: string; city: string; onDone: (r: LeadResponse, firstName: string) => void }) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    street: '',
    unit: '',
    city,
    zip,
    preferredContact: 'phone',
    currentProvider: '',
    website: '',
  });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);


  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    if (!started) {
      setStarted(true);
      track('form_start');
    }
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const r = await api<LeadResponse>('/leads', { method: 'POST', body: { ...form, consent, ...attribution(), sessionId: sessionId() } });
      track('lead_submit', { area_status: r.availability.status }, false);
      onDone(r, form.firstName);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof typeof form, label: string, props: Record<string, string> = {}) => (
    <Field label={label} error={errors[k]} htmlFor={`f-${k}`}>
      <input
        id={`f-${k}`}
        name={k}
        className="input"
        value={form[k]}
        onChange={set(k)}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `f-${k}-error` : undefined}
        {...props}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-bold">Reserve your free fiber consultation</h2>
        <p className="mt-1 text-slate-300">Takes under a minute. No obligation to get started.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {input('firstName', 'First name', { autoComplete: 'given-name' })}
        {input('lastName', 'Last name', { autoComplete: 'family-name' })}
        {input('phone', 'Mobile phone', { type: 'tel', autoComplete: 'tel', inputMode: 'tel', placeholder: '(734) 555-0123' })}
        {input('email', 'Email', { type: 'email', autoComplete: 'email' })}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        {input('street', 'Street address', { autoComplete: 'address-line1', placeholder: '123 Main St' })}
        {input('unit', 'Apt / unit', { autoComplete: 'address-line2' })}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {input('city', 'City', { autoComplete: 'address-level2' })}
        {input('zip', 'ZIP code', { inputMode: 'numeric', maxLength: '5', autoComplete: 'postal-code' })}
        <Field label="Best way to reach you" htmlFor="f-contact">
          <select id="f-contact" className="input" value={form.preferredContact} onChange={set('preferredContact')}>
            <option value="phone">Phone call</option>
            <option value="text">Text message</option>
            <option value="email">Email</option>
          </select>
        </Field>
      </div>
      {input('currentProvider', 'Current internet provider (optional)', { placeholder: 'e.g. cable, DSL, satellite' })}

      {/* Honeypot — hidden from people, irresistible to bots */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="f-website">Website</label>
        <input id="f-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </div>

      <label className="flex cursor-pointer gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-relaxed text-slate-300">
        <input type="checkbox" name="consent" aria-invalid={!!errors.consent} className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-400" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{CONSENT_TEXT}</span>
      </label>
      {errors.consent && <p className="field-error" role="alert">{errors.consent}</p>}
      {formError && !Object.keys(errors).length && <p className="field-error">{formError}</p>}

      <button type="submit" className="btn-primary w-full py-4 text-base" disabled={busy}>
        {busy ? <Spinner /> : 'Continue to scheduling →'}
      </button>
    </form>
  );
}

function ScheduleStep({ lead, onBooked, onSkip }: { lead: LeadResponse; onBooked: (start: string) => void; onSkip: () => void }) {
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ dates: string[] }>('/schedule/dates').then((r) => {
      setDates(r.dates);
      setDate(r.dates[0] ?? '');
    });
    // Runs once on mount: loading the bookable dates from the API.
  }, []);

  useEffect(() => {
    if (!date) return;
    api<{ slots: Slot[] }>(`/schedule/slots?date=${date}`).then((r) => setSlots(r.slots)).catch(() => setSlots([]));
  }, [date]);

  const grouped = useMemo(() => {
    const g = { Morning: [] as Slot[], Afternoon: [] as Slot[], Evening: [] as Slot[] };
    for (const s of slots ?? []) {
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', hour: 'numeric', hourCycle: 'h23' }).format(new Date(s.startUtc)));
      (h < 12 ? g.Morning : h < 17 ? g.Afternoon : g.Evening).push(s);
    }
    return Object.entries(g).filter(([, v]) => v.length);
  }, [slots]);

  async function book() {
    setBusy(true);
    setError('');
    try {
      await api('/appointments', { method: 'POST', body: { leadId: lead.leadId, token: lead.bookingToken, startUtc: selected, notes } });
      track('appointment_booked', {}, false);
      onBooked(selected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Please try again.');
      if (err instanceof ApiError && err.status === 409) {
        // Slot was taken by someone else — refresh the grid.
        const r = await api<{ slots: Slot[] }>(`/schedule/slots?date=${date}`);
        setSlots(r.slots);
        setSelected('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <AvailabilityBanner result={lead.availability} />
      <div>
        <h2 className="font-display text-2xl font-bold">Pick a time for your consultation</h2>
        <p className="mt-1 text-slate-300">A local specialist will confirm your address, walk through plans, and answer questions. Times shown in Eastern Time.</p>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="Choose a date">
        {dates.map((d) => {
          const [wd, rest] = fmtCalendarDate(d).split(', ');
          return (
            <button
              key={d}
              type="button"
              aria-pressed={d === date}
              onClick={() => {
                if (d === date) return;
                setSlots(null);
                setSelected('');
                setDate(d);
              }}
              className={`shrink-0 rounded-xl border px-4 py-3 text-center transition ${d === date ? 'border-fiber-400 bg-fiber-400/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/25'}`}
            >
              <span className="block text-xs uppercase tracking-wider">{wd}</span>
              <span className="block font-semibold">{rest}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-40">
        {slots === null ? (
          <div className="grid place-items-center py-10 text-slate-400">
            <Spinner />
          </div>
        ) : slots.length === 0 ? (
          <p className="py-10 text-center text-slate-400">No open times on this day — try another date.</p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([label, group]) => (
              <div key={label}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {group.map((s) => (
                    <button
                      key={s.startUtc}
                      onClick={() => setSelected(s.startUtc)}
                      aria-pressed={selected === s.startUtc}
                      className={`min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${selected === s.startUtc ? 'border-transparent bg-gradient-to-r from-fiber-400 to-pulse-500 text-ink-950' : 'border-white/10 hover:border-fiber-400/50'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Field label="Anything we should know? (optional)" htmlFor="f-notes">
        <textarea id="f-notes" className="input min-h-20" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, best entrance, questions about plans…" />
      </Field>
      {error && <p className="field-error">{error}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button className="btn-ghost" onClick={() => { track('booking_skipped'); onSkip(); }}>
          I’d rather get a call first
        </button>
        <button className="btn-primary sm:min-w-56" disabled={!selected || busy} onClick={book}>
          {busy ? <Spinner /> : selected ? `Book ${fmtDateTime(selected)}` : 'Select a time'}
        </button>
      </div>
    </div>
  );
}

function DoneStep({ name, bookedAt }: { name: string; bookedAt: string | null }) {
  return (
    <div className="py-6 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-fiber-400 to-pulse-500 text-ink-950">
        <Check className="h-8 w-8" />
      </div>
      <h2 className="mt-5 font-display text-2xl font-bold" tabIndex={-1} ref={(el) => el?.focus()}>You’re all set{name ? `, ${name}` : ''}!</h2>
      {bookedAt ? (
        <p className="mx-auto mt-2 max-w-md text-slate-300">
          Your consultation is booked for <strong className="text-white">{fmtDateTime(bookedAt)}</strong> (Eastern). We’ll reach out beforehand to confirm.
        </p>
      ) : (
        <p className="mx-auto mt-2 max-w-md text-slate-300">A local fiber specialist will contact you shortly using your preferred method.</p>
      )}
      <p className="mx-auto mt-6 max-w-md text-sm text-slate-400">
        Questions before then? Call or text{' '}
        <a href={`tel:${BRAND.phoneE164}`} onClick={() => track('call_click', { location: 'confirmation' })} className="text-cyan-200 underline underline-offset-4">
          {BRAND.phoneDisplay}
        </a>
        . You can also check your exact address on {BRAND.provider}’s{' '}
        <a href={OMNI_LINKS.availability} target="_blank" rel="noopener" onClick={() => track('outbound_click', { target: 'omni_checker', location: 'confirmation' })} className="text-cyan-200 underline underline-offset-4">
          official availability checker
        </a>
        .
      </p>
    </div>
  );
}
