import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  assessmentSchema,
  CATEGORY_LABEL,
  PLATFORM_CATEGORIES,
  PRIORITIES,
  type AssessmentInput,
  type PlatformCategory,
  upgradeLegacy,
} from '../../../shared/platform/assessment';
import { formatCents, type Cents } from '../../../shared/finance/money';
import { api, ApiError } from '../../lib/api';
import { attribution, sessionId, track } from '../../lib/analytics';
import { Button, Callout, Card, ChoiceCards, CurrencyInput, Field, Select, Stepper, TextInput } from '../ds';
import { draftStore, editHandoff, resultsPath } from '../lib';
import { PLATFORM } from '../../../shared/platform/brand';

type Answers = Partial<AssessmentInput> & { zip: string; categories: PlatformCategory[] };
type Errors = Record<string, string>;

const DEFAULTS: Record<PlatformCategory, unknown> = {
  internet: { provider: '', monthlyCents: null, equipmentFeeCents: null, technology: 'unknown', downloadMbps: null, dataCap: 'unknown', promoEnds: 'unknown', promoRegularCents: null, contractMonthsRemaining: 0, earlyTerminationCents: null, reliabilityConcerns: false },
  mobile: { carrier: '', monthlyCents: null, lines: 2, deviceFinancingCents: null, dataNeed: 'unlimited', international: false },
  tv: { provider: '', serviceType: 'cable', monthlyCents: null, equipmentFeeCents: null, otherStreamingCents: null, mustHave: [] },
  electricity: { utility: '', monthlyCents: null, monthlyKwh: null, rateType: 'unknown', homeownership: 'unknown', roofSun: 'unknown' },
};

const CAT_DESC: Record<PlatformCategory, string> = {
  internet: 'Home Wi-Fi / broadband',
  mobile: 'Cell phone plans',
  tv: 'Cable, satellite or live streaming',
  electricity: 'Your electric bill — and whether solar could lower it',
};

const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = {
  lower_cost: 'Pay less each month',
  faster_speed: 'Faster internet',
  no_contract: 'No contracts',
  reliability: 'More reliable service',
  simple_switch: 'Easy switch with little hassle',
};

const PROVIDER_SUGGESTIONS: Record<string, string[]> = {
  internet: ['Comcast Xfinity', 'AT&T', 'Spectrum', 'Frontier', 'Omni Fiber', 'T-Mobile Home Internet', 'Verizon', 'Starlink'],
  mobile: ['Verizon', 'AT&T', 'T-Mobile', 'Cricket', 'Metro by T-Mobile', 'Visible', 'Mint Mobile'],
  tv: ['Xfinity TV', 'DIRECTV', 'DISH', 'YouTube TV', 'Hulu + Live TV', 'Sling TV'],
  electricity: ['DTE Energy', 'Consumers Energy'],
};

/** Stable DOM id for a field, so the error summary can link to it. */
const fid = (key: string) => `pf-f-${key.replace(/\./g, '-')}`;

/** Fills in any field a hand-off left out (the home page preview only knows the bill amounts). */
function withDefaults(a: Answers): Answers {
  const out: Answers = { ...a, zip: a.zip ?? '', categories: a.categories ?? [] };
  for (const c of out.categories) (out as Record<string, unknown>)[c] = { ...(DEFAULTS[c] as object), ...((a[c] as object | undefined) ?? {}) };
  return out;
}

const int = (s: string) => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

export default function Assess() {
  const navigate = useNavigate();
  // Read once on mount (taking the edit hand-off consumes it).
  const [initial] = useState(() => {
    // Older answers may carry the retired "solar" category; fold it into electricity.
    const edit = editHandoff.take();
    if (edit) return { answers: withDefaults(upgradeLegacy(edit) as Answers), step: 0, remember: false, edit: true };
    const d = draftStore.load();
    return d ? { answers: upgradeLegacy(d.answers) as Answers, step: Math.min(d.step, 1), remember: true, edit: false } : { answers: { zip: '', categories: [] } as Answers, step: 0, remember: false, edit: false };
  });
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [step, setStep] = useState(initial.step);
  const [remember, setRemember] = useState(initial.remember);
  const [unknown, setUnknown] = useState<Partial<Record<PlatformCategory, boolean>>>({});
  // Two kinds of errors: format errors reported by inputs as you type (cleared
  // when fixed), and rule errors computed fresh each time you press Continue.
  const [formatErrors, setFormatErrors] = useState<Errors>({});
  const [ruleErrors, setRuleErrors] = useState<Errors>({});
  const errors: Errors = { ...ruleErrors, ...Object.fromEntries(Object.entries(formatErrors).filter(([, v]) => v)) };
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when a step was opened with "Edit" from Review, to offer a direct way back.
  const [fromReview, setFromReview] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const steps = ['Your area', 'Services', ...answers.categories.map((c) => CATEGORY_LABEL[c]), 'Priorities', 'Review'];
  const current = steps[Math.min(step, steps.length - 1)];
  const catForStep = (i: number): PlatformCategory | null => (i >= 2 && i < 2 + answers.categories.length ? answers.categories[i - 2] : null);
  const cat = catForStep(step);

  useEffect(() => {
    track('assessment_start');
    // Arriving from "Edit my answers" on results: move focus to the heading.
    if (initial.edit) headingRef.current?.focus();
  }, [initial.edit]);

  useEffect(() => {
    document.title = `Step ${step + 1} of ${steps.length}: ${current} – ${PLATFORM.name}`;
  }, [step, steps.length, current]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    track('assessment_step', { step, name: current });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (remember) draftStore.save(answers, step);
    else draftStore.clear();
  }, [answers, step, remember]);

  const setCat = (c: PlatformCategory, patch: Record<string, unknown>) =>
    setAnswers((a) => ({ ...a, [c]: { ...(a[c] as Record<string, unknown>), ...patch } }));
  const fieldErr = (k: string, msg?: string) => {
    setFormatErrors((e) => ({ ...e, [k]: msg ?? '' }));
    if (!msg) setRuleErrors((e) => ({ ...e, [k]: '' })); // fixing a field clears its message right away
  };

  function validateStep(i: number): Errors {
    const e: Errors = {};
    if (i === 0 && !/^\d{5}$/.test(answers.zip.trim())) e.zip = 'Enter a 5-digit ZIP code';
    if (i === 1 && !answers.categories.length) e.categories = 'Choose at least one service';
    const c = catForStep(i);
    if (c) {
      const v = answers[c] as Record<string, unknown>;
      for (const [k, msg] of Object.entries(formatErrors)) if (k.startsWith(`${c}.`) && msg) e[k] = msg;
      // Keep a format error ("Enter a dollar amount…") rather than replacing it with "Enter your bill".
      if (v.monthlyCents === null && !unknown[c] && !e[`${c}.monthlyCents`]) e[`${c}.monthlyCents`] = 'Enter your monthly bill, or choose “I don’t know”';
      if (c === 'mobile' && !(Number(v.lines) >= 1 && Number(v.lines) <= 10)) e['mobile.lines'] = 'Choose how many lines';
      if (c === 'electricity' && (v.homeownership === 'unknown' || !v.homeownership)) e['electricity.homeownership'] = 'Choose whether you own or rent';
      if (c === 'internet' && Number.isNaN(v.downloadMbps)) e['internet.downloadMbps'] = 'Enter a whole number, e.g. 300';
      if (c === 'electricity' && Number.isNaN(v.monthlyKwh)) e['electricity.monthlyKwh'] = 'Enter a whole number, e.g. 750';
    }
    return e;
  }

  function next(toReview = false) {
    const e = validateStep(step);
    setRuleErrors(e);
    if (Object.values(e).some(Boolean)) {
      requestAnimationFrame(() => document.getElementById('pf-error-summary')?.focus());
      return;
    }
    if (step === 1) {
      // Initialise answers for newly selected categories; drop unselected ones (data minimisation).
      setAnswers((a) => {
        const out: Answers = { zip: a.zip, categories: PLATFORM_CATEGORIES.filter((c) => a.categories.includes(c)), priorities: a.priorities };
        for (const c of out.categories) (out as Record<string, unknown>)[c] = a[c] ?? DEFAULTS[c];
        return out;
      });
    }
    if (toReview || current === 'Priorities') setFromReview(false);
    // After step 1 the list of steps may change; Review is always last.
    setStep((s) => (toReview ? steps.length - 1 : Math.min(s + 1, steps.length - 1)));
  }

  async function submit() {
    setBusy(true);
    setSubmitError('');
    const parsed = assessmentSchema.safeParse(answers);
    if (!parsed.success) {
      setSubmitError('Some answers need attention. Use “Edit” on the sections below.');
      setBusy(false);
      return;
    }
    try {
      const a = attribution();
      const r = await api<{ id: string; token: string }>('/platform/assessments', {
        method: 'POST',
        body: { assessment: answers, sessionId: sessionId(), utmSource: a.utmSource, utmCampaign: a.utmCampaign, landingPage: a.landingPage, referrer: a.referrer },
      });
      track('assessment_complete', { categories: answers.categories.length }, false);
      draftStore.clear();
      navigate(resultsPath(r.id, r.token));
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'We couldn’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // The summary is a snapshot taken when Continue was pressed (rule errors), so it
  // never changes on each keystroke; fixing a field removes its entry.
  const visibleErrors = Object.entries(ruleErrors).filter(([k, v]) => v && (step < 2 ? !k.includes('.') : cat ? k.startsWith(`${cat}.`) : false));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <Stepper steps={steps} current={Math.min(step, steps.length - 1)} />
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 font-display text-2xl font-bold text-pf-ink outline-none sm:text-3xl">
        {headingFor(current, cat)}
      </h1>

      {visibleErrors.length > 0 && (
        <div id="pf-error-summary" tabIndex={-1} aria-labelledby="pf-error-summary-title" className="mt-4 rounded-xl border border-pf-cost bg-pf-cost-soft p-4 text-sm text-pf-cost outline-none">
          <p id="pf-error-summary-title" className="font-semibold">
            Please fix {visibleErrors.length === 1 ? 'this' : 'these'}:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {visibleErrors.map(([k, v]) => (
              <li key={k}>
                <a
                  href={`#${fid(k)}`}
                  className="inline-block py-1 underline underline-offset-2"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(fid(k))?.focus();
                  }}
                >
                  {v}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="mt-6 space-y-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (current === 'Review') submit();
          else next();
        }}
      >
        {step === 0 && (
          <>
            <Field id={fid('zip')} label="ZIP code" hint="We use it to find plans and providers that serve your area." error={errors.zip}>
              {(p) => (
                <TextInput
                  id={p.id}
                  aria-describedby={p.describedBy}
                  aria-invalid={p.invalid || undefined}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={5}
                  className="max-w-40 tracking-widest"
                  value={answers.zip}
                  onChange={(e) => setAnswers((a) => ({ ...a, zip: e.target.value.replace(/\D/g, '') }))}
                />
              )}
            </Field>
            <div className="rounded-xl border border-pf-line bg-pf-surface p-4 text-sm">
              <label className="flex cursor-pointer items-start gap-3 font-semibold text-pf-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-[var(--color-pf-brand)]"
                  checked={remember}
                  aria-describedby="remember-help"
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember my answers on this device
              </label>
              <p id="remember-help" className="mt-1 pl-8 text-pf-muted">
                Lets you come back and finish later. Stored only in this browser — turn it off any time to delete it.
              </p>
            </div>
          </>
        )}

        {step === 1 && (
          <ChoiceCards
            id={fid('categories')}
            legend="Which household services should we look at?"
            hint="Pick any — you can skip the rest."
            multiple
            value={answers.categories}
            onChange={(v) => setAnswers((a) => ({ ...a, categories: v }))}
            error={errors.categories}
            options={PLATFORM_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c], description: CAT_DESC[c] }))}
          />
        )}

        {cat && (
          <CategoryFields
            key={cat}
            category={cat}
            value={answers[cat] as Record<string, unknown>}
            set={(patch) => setCat(cat, patch)}
            errors={errors}
            setError={fieldErr}
            unknown={!!unknown[cat]}
            setUnknown={(u) => {
              setUnknown((x) => ({ ...x, [cat]: u }));
              if (u) {
                setCat(cat, { monthlyCents: null });
                fieldErr(`${cat}.monthlyCents`);
              }
            }}
          />
        )}

        {current === 'Priorities' && (
          <ChoiceCards
            legend="What matters most to you? (optional)"
            hint="This changes which options we point out first — never the math."
            multiple
            value={(answers.priorities ?? []) as (typeof PRIORITIES)[number][]}
            onChange={(v) => setAnswers((a) => ({ ...a, priorities: v }))}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          />
        )}

        {current === 'Review' && (
          <Review
            answers={answers}
            onEdit={(i) => {
              setFromReview(true);
              setStep(i);
            }}
          />
        )}

        {submitError && (
          <p role="alert" className="text-sm font-medium text-pf-cost">
            {submitError}
          </p>
        )}

        {/* Primary action first in the DOM so tab order matches the mobile layout. */}
        <div className="flex flex-col gap-3 border-t border-pf-line pt-6 sm:flex-row-reverse sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button type="submit" size="lg" loading={busy}>
              {current === 'Review' ? 'See my results' : 'Continue'}
            </Button>
            {/* Not on Services: newly chosen services still need their own questions. */}
            {fromReview && current !== 'Review' && step !== 1 && (
              <Button type="button" variant="secondary" size="lg" onClick={() => next(true)}>
                Save and back to review
              </Button>
            )}
          </div>
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function headingFor(step: string, cat: PlatformCategory | null) {
  if (cat) return `About your ${CATEGORY_LABEL[cat].toLowerCase()}`;
  return (
    {
      'Your area': 'Where is your home?',
      Services: 'What do you pay for?',
      Priorities: 'What matters most?',
      Review: 'Check your answers',
    } as Record<string, string>
  )[step];
}

function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-pf-line bg-pf-surface p-4">
      <summary className="cursor-pointer font-semibold text-pf-brand">More details (optional) — makes the comparison more accurate</summary>
      <div className="mt-4 space-y-5">{children}</div>
    </details>
  );
}

function CategoryFields({
  category: c,
  value: v,
  set,
  errors,
  setError,
  unknown,
  setUnknown,
}: {
  category: PlatformCategory;
  value: Record<string, unknown>;
  set: (p: Record<string, unknown>) => void;
  errors: Errors;
  setError: (k: string, msg?: string) => void;
  unknown: boolean;
  setUnknown: (u: boolean) => void;
}) {
  const money = (key: string, label: string, hint?: string, optional = true) => (
    <Field id={fid(`${c}.${key}`)} label={label} hint={hint} error={errors[`${c}.${key}`]} optional={optional}>
      {(p) => (
        <CurrencyInput
          id={p.id}
          describedBy={p.describedBy}
          invalid={p.invalid}
          value={(v[key] as Cents | null) ?? null}
          onChange={(cents, err) => {
            set({ [key]: cents });
            setError(`${c}.${key}`, err);
          }}
        />
      )}
    </Field>
  );
  const text = (key: string, label: string, opts: { hint?: string; list?: string } = {}) => (
    <Field label={label} hint={opts.hint} optional>
      {(p) => <TextInput id={p.id} aria-describedby={p.describedBy} list={opts.list} value={String(v[key] ?? '')} onChange={(e) => set({ [key]: e.target.value })} autoComplete="off" />}
    </Field>
  );
  const select = (key: string, label: string, options: [string, string][], numeric = false) => (
    <Field id={fid(`${c}.${key}`)} label={label} error={errors[`${c}.${key}`]}>
      {(p) => (
        <Select
          id={p.id}
          aria-describedby={p.describedBy}
          value={String(v[key])}
          onChange={(e) => set({ [key]: numeric ? Number(e.target.value) : e.target.value })}
          options={options.map(([value, l]) => ({ value, label: l }))}
        />
      )}
    </Field>
  );
  const number = (key: string, label: string, hint?: string) => (
    <Field id={fid(`${c}.${key}`)} label={label} hint={hint} optional error={errors[`${c}.${key}`]}>
      {(p) => (
        <TextInput
          id={p.id}
          aria-describedby={p.describedBy}
          aria-invalid={p.invalid || undefined}
          inputMode="numeric"
          className="max-w-40"
          defaultValue={v[key] === null || v[key] === undefined ? '' : String(v[key])}
          onChange={(e) => {
            const n = int(e.target.value);
            set({ [key]: n });
            setError(`${c}.${key}`, Number.isNaN(n) ? 'Enter a whole number' : undefined);
          }}
        />
      )}
    </Field>
  );
  const monthly = (label: string, hint: string) => (
    <div className="space-y-2">
      {!unknown && money('monthlyCents', label, hint, false)}
      <label className="flex items-center gap-2 text-sm text-pf-ink">
        <input type="checkbox" className="h-5 w-5 accent-[var(--color-pf-brand)]" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />
        I don’t know the amount
      </label>
      {unknown && <Callout tone="info">No problem — we’ll show what we can and ask for this number before calculating savings. It’s usually on your bill or in your account app.</Callout>}
    </div>
  );
  const datalist = PROVIDER_SUGGESTIONS[c] && (
    <datalist id={`${c}-providers`}>
      {PROVIDER_SUGGESTIONS[c].map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </datalist>
  );

  switch (c) {
    case 'internet':
      return (
        <div className="space-y-5">
          {datalist}
          {text('provider', 'Current provider', { list: 'internet-providers' })}
          {monthly('Monthly internet bill', 'The total you pay each month, including taxes and fees if you know them.')}
          {money('equipmentFeeCents', 'Monthly equipment fee', 'Router or modem rental, if it’s charged separately.')}
          <Advanced>
            {select('technology', 'Connection type', [
              ['unknown', 'Not sure'],
              ['cable', 'Cable'],
              ['fiber', 'Fiber'],
              ['dsl', 'DSL'],
              ['fixed_wireless', 'Fixed wireless'],
              ['5g_home', '5G home internet'],
              ['satellite', 'Satellite'],
            ])}
            {number('downloadMbps', 'Download speed (Mbps)', 'From your plan name or a speed test.')}
            {select('dataCap', 'Is there a monthly data cap?', [
              ['unknown', 'Not sure'],
              ['yes', 'Yes'],
              ['no', 'No'],
            ])}
            {select('promoEnds', 'Is your current price a promotion?', [
              ['unknown', 'Not sure'],
              ['none', 'No, it’s the regular price'],
              ['within_3', 'Yes — ends within 3 months'],
              ['within_12', 'Yes — ends within a year'],
              ['over_12', 'Yes — ends in more than a year'],
            ])}
            {['within_3', 'within_12', 'over_12'].includes(String(v.promoEnds)) && money('promoRegularCents', 'Price after the promotion ends', 'If your bill or provider tells you.')}
            {number('contractMonthsRemaining', 'Months left on a contract', 'Leave blank if you’re month-to-month.')}
            {Number(v.contractMonthsRemaining) > 0 && money('earlyTerminationCents', 'Early cancellation fee', 'What you’d pay to cancel today.')}
            <label className="flex items-center gap-2 text-sm text-pf-ink">
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-pf-brand)]" checked={!!v.reliabilityConcerns} onChange={(e) => set({ reliabilityConcerns: e.target.checked })} />
              My connection drops or slows down often
            </label>
          </Advanced>
        </div>
      );
    case 'mobile':
      return (
        <div className="space-y-5">
          {datalist}
          {text('carrier', 'Current carrier', { list: 'mobile-providers' })}
          {select('lines', 'Number of lines', Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1} ${i ? 'lines' : 'line'}`]), true)}
          {monthly('Monthly service cost', 'For all lines, not counting phone payments (device installments).')}
          {select('dataNeed', 'How much data does your household use?', [
            ['unlimited', 'Unlimited / not sure'],
            ['heavy', 'A lot (streaming on the go)'],
            ['moderate', 'Some (maps, social, music)'],
            ['light', 'Very little (mostly Wi-Fi)'],
          ])}
          <Advanced>
            {money('deviceFinancingCents', 'Monthly phone payments', 'We keep these out of comparisons — they continue on any plan.')}
            <label className="flex items-center gap-2 text-sm text-pf-ink">
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-pf-brand)]" checked={!!v.international} onChange={(e) => set({ international: e.target.checked })} />
              We call or text internationally
            </label>
          </Advanced>
        </div>
      );
    case 'tv':
      return (
        <div className="space-y-5">
          {datalist}
          {select('serviceType', 'Type of TV service', [
            ['cable', 'Cable TV'],
            ['satellite', 'Satellite TV'],
            ['live_streaming', 'Live TV streaming (e.g. YouTube TV)'],
            ['streaming_only', 'Streaming apps only'],
          ])}
          {text('provider', 'Current provider', { list: 'tv-providers' })}
          {monthly('Monthly TV bill', 'Without internet, if it’s bundled and you know the split.')}
          {money('equipmentFeeCents', 'Monthly box / DVR fees')}
          <Advanced>
            {money('otherStreamingCents', 'Other streaming subscriptions (total per month)', 'Netflix, Disney+, etc. We count them in your spending and keep them.')}
            <ChoiceCards
              legend="Channels you can’t live without"
              multiple
              columns={3}
              value={(v.mustHave as string[]) ?? []}
              onChange={(x) => set({ mustHave: x })}
              options={[
                { value: 'local_channels', label: 'Local channels' },
                { value: 'sports', label: 'Sports' },
                { value: 'news', label: 'News' },
                { value: 'kids', label: 'Kids' },
                { value: 'premium_movies', label: 'Premium movies' },
              ]}
            />
          </Advanced>
        </div>
      );
    case 'electricity':
      return (
        <div className="space-y-5">
          {datalist}
          {text('utility', 'Electric utility', { list: 'electricity-providers' })}
          {monthly('Average monthly electric bill', 'A typical month — or your yearly total divided by 12.')}
          <ChoiceCards
            id={fid('electricity.homeownership')}
            legend="Do you own or rent your home?"
            hint="We compare rooftop solar as your electricity option. It usually needs you to own the home."
            value={v.homeownership === 'own' || v.homeownership === 'rent' ? [v.homeownership] : []}
            onChange={(x) => set({ homeownership: x[0] })}
            error={errors['electricity.homeownership']}
            columns="pair"
            options={[
              { value: 'own', label: 'Own' },
              { value: 'rent', label: 'Rent' },
            ]}
          />
          {v.homeownership === 'own' &&
            select('roofSun', 'How much sun does your roof get?', [
              ['unknown', 'Not sure'],
              ['mostly_sunny', 'Mostly sunny'],
              ['some_shade', 'Some shade'],
              ['heavy_shade', 'Heavily shaded'],
            ])}
          <Advanced>
            {number('monthlyKwh', 'Average monthly usage (kWh)', 'Shown on your bill. Makes the solar estimate more accurate.')}
            {select('rateType', 'Rate plan', [
              ['unknown', 'Not sure'],
              ['standard', 'Standard'],
              ['time_of_use', 'Time of use'],
            ])}
          </Advanced>
        </div>
      );
  }
}

const ROOF_LABEL: Record<string, string> = { mostly_sunny: 'Mostly sunny', some_shade: 'Some shade', heavy_shade: 'Heavily shaded', unknown: 'Not sure' };

function Review({ answers, onEdit }: { answers: Answers; onEdit: (step: number) => void }) {
  const fmt = (c: unknown) => (typeof c === 'number' ? formatCents(c) : 'Not sure');
  return (
    <div className="space-y-4">
      <Card as="div">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-pf-subtle">ZIP code</p>
            <p className="font-semibold text-pf-ink">{answers.zip}</p>
          </div>
          <Button type="button" variant="ghost" onClick={() => onEdit(0)} aria-label="Edit ZIP code">
            Edit
          </Button>
        </div>
      </Card>
      {answers.categories.map((c, i) => {
        const v = answers[c] as Record<string, unknown>;
        const rows: [string, string][] = [
          ['Provider', String(v.provider ?? v.carrier ?? v.utility ?? '') || '—'],
          ['Monthly', fmt(v.monthlyCents)],
          ...(c === 'mobile' ? ([['Lines', String(v.lines)]] as [string, string][]) : []),
          ...(c === 'electricity'
            ? ([
                ['Home', v.homeownership === 'own' ? 'Own' : v.homeownership === 'rent' ? 'Rent' : 'Not answered'],
                ...(v.homeownership === 'own' ? [['Roof sun', ROOF_LABEL[String(v.roofSun)] ?? 'Not sure']] : []),
              ] as [string, string][])
            : []),
        ];
        return (
          <Card as="div" key={c}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-pf-ink">{CATEGORY_LABEL[c]}</h2>
                <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
                  {rows.map(([k, val]) => (
                    <div key={k} className="contents">
                      <dt className="text-pf-subtle">{k}</dt>
                      <dd className="tnum text-pf-ink">{val}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <Button type="button" variant="ghost" onClick={() => onEdit(2 + i)} aria-label={`Edit ${CATEGORY_LABEL[c]}`}>
                Edit
              </Button>
            </div>
          </Card>
        );
      })}
      <p className="text-sm text-pf-muted">
        We don’t ask for your name or contact details to show results. Your answers are saved with a private link so you can come back to them.
      </p>
    </div>
  );
}
