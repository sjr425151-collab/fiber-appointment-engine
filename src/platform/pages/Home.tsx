import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Cents } from '../../../shared/finance/money';
import { formatCents } from '../../../shared/finance/money';
import type { AssessmentInput, PlatformCategory } from '../../../shared/platform/assessment';
import { BENCHMARK_DISCLOSURE, quickPreview, type BenchmarkSet } from '../../../shared/platform/benchmarks';
import { PLATFORM, PLATFORM_META, PRIMARY_CTA } from '../../../shared/platform/brand';
import { HANDOFF_COPY } from '../../../shared/platform/handoff';
import { track } from '../../lib/analytics';
import { bootBenchmarks } from '../../lib/market';
import { Button, Card, CurrencyInput, Field, Money, Select, StatusChip } from '../ds';
import { HandoffForm } from '../HandoffForm';
import { editHandoff } from '../lib';

const whole = (c: Cents) => formatCents(c, { cents: false });

const categories = (b: BenchmarkSet): { name: string; body: string; benchmark: string }[] => [
  {
    name: 'Home Internet / Wi-Fi',
    body: 'Speed, equipment fees and what happens when a promotion ends.',
    benchmark: `Compared with ${whole(b.internetMonthly)}/mo`,
  },
  {
    name: 'Mobile',
    body: 'Per-line costs, kept separate from phone payments.',
    benchmark: `Compared with ${whole(b.mobilePerLine)}/mo per line`,
  },
  {
    name: 'TV / Streaming',
    body: 'Cable, satellite and streaming, side by side.',
    benchmark: `Compared with ${whole(b.tvMonthly)}/mo`,
  },
  { name: 'Electricity / Solar', body: 'Your electric bill against going solar, if you own your home.', benchmark: 'Solar pricing shown to homeowners who ask' },
  { name: 'Home Security', body: 'Monitoring costs compared, for homeowners.', benchmark: 'Pricing shown to homeowners who ask' },
];

const STEPS = [
  {
    title: 'Tell us what you pay',
    body: 'A few numbers per service. Not sure of one? Skip it. We never guess for you.',
  },
  {
    title: 'See your savings preview',
    body: 'Monthly and yearly differences, with 1-, 5- and 10-year projections and every assumption shown.',
  },
  {
    title: 'Get help saving',
    body: 'An advisor can find real prices for your address and handle the switch.',
  },
];

/** Shown in light grey in the empty form, and as a labelled example result until the customer types their own bills. */
const EXAMPLE = {
  internet: 9500,
  mobile: 16000,
  mobileLines: 2,
  tv: 12000,
  // No electricity or security here: those prices are only shown to homeowners who ask.
} as const;
const EXAMPLE_TEXT: Record<PlatformCategory, string> = {
  internet: '95.00',
  mobile: '160.00',
  tv: '120.00',
  electricity: '260.00',
  security: '60.00',
};

const ROW_LABEL: Record<PlatformCategory, string> = {
  internet: 'Home internet',
  mobile: 'Mobile',
  tv: 'TV / streaming',
  electricity: 'Electricity',
  security: 'Home security',
};

/** Instant, illustrative preview on the home page: bills in, benchmark comparison out. Nothing leaves the browser. */
function QuickPreview() {
  const navigate = useNavigate();
  const [bills, setBills] = useState<Record<PlatformCategory, Cents | null>>({
    internet: null,
    mobile: null,
    tv: null,
    electricity: null,
    security: null,
  });
  const [errors, setErrors] = useState<Partial<Record<PlatformCategory, string>>>({});
  const [lines, setLines] = useState(2);
  const [ownsHome, setOwnsHome] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  // Solar and home security are priced only for homeowners who ask.
  const extras = ownsHome && showExtras;
  const set = useMemo(() => bootBenchmarks(), []);
  const preview = useMemo(() => quickPreview({ ...bills, mobileLines: lines, ownsHome, showExtras }, set), [bills, lines, ownsHome, showExtras, set]);
  const any = preview.rows.length > 0;
  const example = useMemo(() => quickPreview(EXAMPLE, set), [set]);
  // Until the customer types a bill, the result box shows the example household, clearly labelled.
  const shown = any ? preview : example;
  const [asking, setAsking] = useState(false);
  const seen = useRef(false);
  // Funnel: the preview and the call to action have been shown (once per visit to this page).
  useEffect(() => {
    if (!any || seen.current) return;
    seen.current = true;
    track('preview_view', { from: 'home' });
    track('handoff_cta_view', { from: 'home' });
  }, [any]);

  const money = (c: PlatformCategory, label: string, hint?: string) => (
    <Field id={`qp-${c}`} label={label} hint={hint} error={errors[c]} optional>
      {(p) => (
        <CurrencyInput
          id={p.id}
          describedBy={p.describedBy}
          invalid={p.invalid}
          value={bills[c]}
          placeholder={`e.g. ${EXAMPLE_TEXT[c]}`}
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
    const categories = (['internet', 'mobile', 'tv', 'electricity', 'security'] as const).filter((c) => bills[c] && (c !== 'security' || extras));
    const answers: Partial<AssessmentInput> = { zip: '', categories };
    if (bills.internet) answers.internet = { monthlyCents: bills.internet };
    if (bills.mobile) answers.mobile = { monthlyCents: bills.mobile, lines };
    if (bills.tv) answers.tv = { monthlyCents: bills.tv };
    if (bills.electricity) answers.electricity = { monthlyCents: bills.electricity, homeownership: ownsHome ? 'own' : 'unknown', showPricing: extras };
    if (bills.security && extras) answers.security = { monthlyCents: bills.security, homeownership: 'own', showPricing: true };
    if (categories.length) editHandoff.set(answers as AssessmentInput);
    track('cta_click', {
      location: 'pf_quick_preview',
      categories: categories.length,
    });
    navigate('/savings/assess');
  }

  return (
    <Card as="div" id="preview" className="scroll-mt-4 lg:ml-auto lg:w-full lg:max-w-md">
      <h2 className="font-display text-xl font-bold text-pf-ink">Type what you pay. We’ll find a smarter option.</h2>
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
            {(p) => (
              <Select
                id={p.id}
                value={String(lines)}
                onChange={(e) => setLines(Number(e.target.value))}
                options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
                  value: String(n),
                  label: String(n),
                }))}
              />
            )}
          </Field>
        </div>
        {money('tv', 'TV / streaming')}
        {money('electricity', 'Electricity')}
        <label className="flex cursor-pointer items-start gap-3 text-sm text-pf-ink">
          <input id="qp-own" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={ownsHome} onChange={(e) => setOwnsHome(e.target.checked)} />I own my home
        </label>
        {ownsHome && (
          <label className="flex cursor-pointer items-start gap-3 text-sm text-pf-ink">
            <input id="qp-extras" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={showExtras} onChange={(e) => setShowExtras(e.target.checked)} />
            Show extra services for homeowners: solar and home security pricing
          </label>
        )}
        {extras && money('security', 'Home security', 'Monitoring only, not equipment payments.')}

        <div className={`rounded-xl p-4 ${any ? 'bg-pf-bg' : 'border border-dashed border-pf-line bg-pf-bg/60'}`} role="status" aria-live="polite">
          {!any && <p className="mb-2 text-xs font-medium text-pf-subtle">Example: internet $95, mobile $160 for 2 lines, TV $120. Type your own bills to see yours.</p>}
          <p className="text-sm text-pf-subtle">{any ? 'Potential savings' : 'Example potential savings'}</p>
          <p className="font-display text-2xl font-bold">{shown.monthlySavings > 0 ? <Money cents={shown.monthlySavings} kind="savings" perMonth /> : <span className="text-pf-ink">None against our benchmarks</span>}</p>
          {shown.monthlySavings > 0 && <p className="text-sm text-pf-muted">About {whole(shown.annualSavings)} a year</p>}
          {shown.monthlyHigher > 0 && <p className="mt-1 text-sm text-pf-warn">Where a benchmark is higher than your bill we show it as a possible extra cost and leave it out of this total.</p>}
          <ul className="mt-3 space-y-1 text-sm text-pf-muted">
            {shown.rows.map((r) => (
              <li key={r.category} className="flex justify-between gap-3">
                <span>
                  {ROW_LABEL[r.category]}
                  {r.benchmark !== null && <span className="text-pf-subtle"> vs {whole(r.benchmark)}</span>}
                </span>
                <span className={`tnum text-right ${(r.difference ?? 0) < 0 ? 'text-pf-warn' : 'text-pf-ink'}`}>
                  {r.note ?? ((r.difference ?? 0) > 0 ? `${whole(r.savings)}/mo less` : (r.difference ?? 0) < 0 ? `${whole(-(r.difference ?? 0))}/mo more` : 'Same as benchmark')}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3">
            <StatusChip status="benchmark" />
          </p>
        </div>
        <p className="text-xs text-pf-subtle">Illustrative only. {BENCHMARK_DISCLOSURE}</p>
        {!any ? (
          <Button type="submit" size="lg" className="w-full">
            {PRIMARY_CTA}
          </Button>
        ) : (
          !asking && (
            <div className="space-y-3">
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={() => {
                  track('handoff_cta_click', { from: 'home' });
                  setAsking(true);
                }}
              >
                {HANDOFF_COPY.cta}
              </Button>
              <p className="text-sm text-pf-muted">{HANDOFF_COPY.support}</p>
              <Button type="submit" variant="secondary" className="w-full">
                See my full preview
              </Button>
            </div>
          )
        )}
      </form>
      {any && asking && (
        <div className="mt-5 border-t border-pf-line pt-5">
          <HandoffForm bills={bills} mobileLines={lines} ownsHome={ownsHome} showExtras={showExtras} onCancel={() => setAsking(false)} />
        </div>
      )}
    </Card>
  );
}

export default function Home() {
  const set = useMemo(() => bootBenchmarks(), []);
  useEffect(() => {
    document.title = PLATFORM_META.title;
  }, []);
  return (
    <>
      <section className="border-b border-pf-line bg-pf-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:py-16">
          <div className="lg:pt-6">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-pf-brand">{PLATFORM.descriptor}</p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight text-pf-ink sm:text-5xl">See if your household could save 50% or more on monthly bills.</h1>
            <p className="mt-5 max-w-xl text-lg text-pf-muted">Internet, mobile, TV and electricity in one quick check. We compare, we help, you choose. No account, no pressure and no guaranteed-savings claims.</p>
            <p className="mt-3 max-w-xl text-sm text-pf-subtle">Results vary and many households will save less. Figures are illustrative comparisons, not offers or guarantees.</p>
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
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {categories(set).map((c) => (
            <li key={c.name} className="rounded-2xl border border-pf-line bg-pf-surface p-5">
              <h3 className="font-semibold text-pf-ink">{c.name}</h3>
              <p className="mt-1.5 text-sm text-pf-muted">{c.body}</p>
              <p className="mt-3 text-xs font-semibold text-pf-subtle">{c.benchmark}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-sm text-pf-subtle">{BENCHMARK_DISCLOSURE}</p>
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
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {(
            [
              ['user_reported', 'A number you gave us about your current service.'],
              ['benchmark', 'Tucker’s comparison price. An assumption for the preview, not an offer.'],
              ['pending_verification', 'A real price for your address, still to be confirmed by a representative.'],
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
