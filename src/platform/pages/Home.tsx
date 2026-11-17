import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Cents } from '../../../shared/finance/money';
import { formatCents } from '../../../shared/finance/money';
import type { AssessmentInput, PlatformCategory } from '../../../shared/platform/assessment';
import { BENCHMARK_DISCLOSURE, BENCHMARKS, quickPreview } from '../../../shared/platform/benchmarks';
import { PLATFORM, PLATFORM_META, PRIMARY_CTA } from '../../../shared/platform/brand';
import { track } from '../../lib/analytics';
import { Button, Card, CurrencyInput, Field, Money, Select, StatusChip } from '../ds';
import { editHandoff } from '../lib';

const whole = (c: Cents) => formatCents(c, { cents: false });

const CATEGORIES: { name: string; body: string; benchmark: string }[] = [
  { name: 'Home Internet / Wi-Fi', body: 'Speed, equipment fees and what happens when a promotion ends.', benchmark: `Compared with ${whole(BENCHMARKS.internetMonthly)}/mo` },
  { name: 'Mobile', body: 'Per-line costs, kept separate from phone payments.', benchmark: `Compared with ${whole(BENCHMARKS.mobilePerLine)}/mo per line` },
  { name: 'TV / Streaming', body: 'Cable, satellite and streaming, side by side.', benchmark: `Compared with ${whole(BENCHMARKS.tvMonthly)}/mo` },
  { name: 'Electricity / Solar', body: 'Your electric bill against going solar, if you own your home.', benchmark: `Illustrative ${whole(BENCHMARKS.electricityWithSolarMonthly)}/mo with solar` },
];

const STEPS = [
  { title: 'Tell us what you pay', body: 'A few numbers per service. Not sure of one? Skip it. We never guess for you.' },
  { title: 'See your savings preview', body: 'Monthly and yearly differences, with 1-, 5- and 10-year projections and every assumption shown.' },
  { title: 'Get help if you want it', body: 'An advisor can find real prices for your address and handle the switch. You choose.' },
];

const ROW_LABEL: Record<PlatformCategory, string> = { internet: 'Home internet', mobile: 'Mobile', tv: 'TV / streaming', electricity: 'Electricity' };

/** Instant, illustrative preview on the home page: bills in, benchmark comparison out. Nothing leaves the browser. */
function QuickPreview() {
  const navigate = useNavigate();
  const [bills, setBills] = useState<Record<PlatformCategory, Cents | null>>({ internet: null, mobile: null, tv: null, electricity: null });
  const [errors, setErrors] = useState<Partial<Record<PlatformCategory, string>>>({});
  const [lines, setLines] = useState(2);
  const [ownsHome, setOwnsHome] = useState(false);
  const preview = useMemo(() => quickPreview({ ...bills, mobileLines: lines, ownsHome }), [bills, lines, ownsHome]);
  const any = preview.rows.length > 0;

  const money = (c: PlatformCategory, label: string, hint?: string) => (
    <Field id={`qp-${c}`} label={label} hint={hint} error={errors[c]} optional>
      {(p) => (
        <CurrencyInput
          id={p.id}
          describedBy={p.describedBy}
          invalid={p.invalid}
          value={bills[c]}
          onChange={(cents, err) => {
            setBills((b) => ({ ...b, [c]: cents }));
            setErrors((e) => ({ ...e, [c]: err }));
          }}
        />
      )}
    </Field>
  );

  function continueToFull() {
    // Carry the numbers into the full preview so nothing is typed twice.
    const categories = (['internet', 'mobile', 'tv', 'electricity'] as const).filter((c) => bills[c]);
    const answers: Partial<AssessmentInput> = { zip: '', categories };
    if (bills.internet) answers.internet = { monthlyCents: bills.internet };
    if (bills.mobile) answers.mobile = { monthlyCents: bills.mobile, lines };
    if (bills.tv) answers.tv = { monthlyCents: bills.tv };
    if (bills.electricity) answers.electricity = { monthlyCents: bills.electricity, homeownership: ownsHome ? 'own' : 'unknown' };
    if (categories.length) editHandoff.set(answers as AssessmentInput);
    track('cta_click', { location: 'pf_quick_preview', categories: categories.length });
    navigate('/savings/assess');
  }

  return (
    <Card as="div" className="lg:ml-auto lg:w-full lg:max-w-md">
      <h2 className="font-display text-xl font-bold text-pf-ink">Quick savings preview</h2>
      <p className="mt-1 text-sm text-pf-muted">Enter any monthly bill. No contact details needed.</p>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          continueToFull();
        }}
      >
        {money('internet', 'Home internet / Wi-Fi')}
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          {money('mobile', 'Mobile', 'Plan only, not phone payments.')}
          <Field id="qp-lines" label="Lines">
            {(p) => <Select id={p.id} value={String(lines)} onChange={(e) => setLines(Number(e.target.value))} options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: String(n) }))} />}
          </Field>
        </div>
        {money('tv', 'TV / streaming')}
        {money('electricity', 'Electricity')}
        <label className="flex cursor-pointer items-start gap-3 text-sm text-pf-ink">
          <input id="qp-own" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={ownsHome} onChange={(e) => setOwnsHome(e.target.checked)} />
          I own my home (needed to compare solar)
        </label>

        <div className="rounded-xl bg-pf-bg p-4" role="status" aria-live="polite">
          {!any ? (
            <p className="text-sm text-pf-muted">Your preview appears here as you type.</p>
          ) : (
            <>
              <p className="text-sm text-pf-subtle">Potential savings</p>
              <p className="font-display text-2xl font-bold">
                {preview.monthlySavings > 0 ? <Money cents={preview.monthlySavings} kind="savings" perMonth /> : <span className="text-pf-ink">None against our benchmarks</span>}
              </p>
              {preview.monthlySavings > 0 && <p className="text-sm text-pf-muted">About {whole(preview.annualSavings)} a year</p>}
              <ul className="mt-3 space-y-1 text-sm text-pf-muted">
                {preview.rows.map((r) => (
                  <li key={r.category} className="flex justify-between gap-3">
                    <span>
                      {ROW_LABEL[r.category]}
                      {r.benchmark !== null && <span className="text-pf-subtle"> vs {whole(r.benchmark)}</span>}
                    </span>
                    <span className="tnum text-right text-pf-ink">{r.note ?? (r.savings > 0 ? `${whole(r.savings)}/mo less` : 'At or below benchmark')}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                <StatusChip status="benchmark" />
              </p>
            </>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full">
          {PRIMARY_CTA}
        </Button>
        <p className="text-xs text-pf-subtle">Illustrative only. {BENCHMARK_DISCLOSURE}</p>
      </form>
    </Card>
  );
}

export default function Home() {
  useEffect(() => {
    document.title = PLATFORM_META.title;
  }, []);
  return (
    <>
      <section className="border-b border-pf-line bg-pf-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:py-16">
          <div className="lg:pt-6">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-pf-brand">{PLATFORM.descriptor}</p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight text-pf-ink sm:text-5xl">See what your household could save on its monthly bills.</h1>
            <p className="mt-5 max-w-xl text-lg text-pf-muted">
              Internet, mobile, TV and electricity in one quick check. We compare, we help, you choose. No account, no pressure and no guaranteed-savings claims.
            </p>
            <ul className="mt-6 space-y-2 text-pf-ink">
              {['Free, and takes about a minute', 'No contact details to see your preview', 'Every number labelled by where it came from'].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-pf-save" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-6">
              <Link to="/savings/assess" onClick={() => track('cta_click', { location: 'pf_hero_full' })} className="font-semibold text-pf-brand underline underline-offset-4">
                Skip to the full preview
              </Link>
            </p>
          </div>
          <QuickPreview />
        </div>
      </section>

      <section aria-labelledby="cats" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 id="cats" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
          Four bills, one check
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => (
            <li key={c.name} className="rounded-2xl border border-pf-line bg-pf-surface p-5">
              <h3 className="font-semibold text-pf-ink">{c.name}</h3>
              <p className="mt-1.5 text-sm text-pf-muted">{c.body}</p>
              <p className="mt-3 text-xs font-semibold text-pf-subtle">{c.benchmark}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-sm text-pf-subtle">{BENCHMARK_DISCLOSURE} Where we have a real plan on file for your address, we show that instead.</p>
      </section>

      <section id="how" aria-labelledby="how-t" className="scroll-mt-4 border-y border-pf-line bg-pf-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how-t" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="font-display text-sm font-bold text-pf-brand">Step {i + 1}</span>
                <h3 className="mt-1 text-lg font-semibold text-pf-ink">{s.title}</h3>
                <p className="mt-1.5 text-pf-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="data" aria-labelledby="data-t" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-14 sm:px-6">
        <h2 id="data-t" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
          You’ll always know where a number came from
        </h2>
        <p className="mt-3 max-w-2xl text-pf-muted">Each price carries a label, so a comparison assumption is never mistaken for an offer.</p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['user_reported', 'A number you gave us about your current service.'],
              ['benchmark', 'Tucker’s comparison price. An assumption for the preview, not an offer.'],
              ['pending_verification', 'A real plan on file, still to be confirmed at your exact address.'],
              ['manually_verified', 'Checked by our team with the provider, with a date.'],
            ] as const
          ).map(([s, d]) => (
            <div key={s} className="rounded-2xl border border-pf-line bg-pf-surface p-4">
              <dt>
                <StatusChip status={s} />
              </dt>
              <dd className="mt-2 text-sm text-pf-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
