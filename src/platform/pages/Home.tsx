import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Cents } from '../../../shared/finance/money';
import { formatCents } from '../../../shared/finance/money';
import type { AssessmentInput, PlatformCategory } from '../../../shared/platform/assessment';
import { BENCHMARK_DISCLOSURE, quickPreview, type BenchmarkSet } from '../../../shared/platform/benchmarks';
import { HOME_FAQ, PLATFORM, PLATFORM_META, PRIMARY_CTA } from '../../../shared/platform/brand';
import { HANDOFF_COPY } from '../../../shared/platform/handoff';
import { track } from '../../lib/analytics';
import { bootBenchmarks } from '../../lib/market';
import { attachParallax, isConstrained, prefersReducedMotion } from '../../lib/motion';
import { Button, Card, CurrencyInput, Field, Money, Select, StatusChip } from '../ds';
import { HandoffForm } from '../HandoffForm';
import { editHandoff } from '../lib';

const whole = (c: Cents) => formatCents(c, { cents: false });

const categories = (b: BenchmarkSet): { name: string; body: string; benchmark: string }[] => [
  { name: 'Home Internet / Wi-Fi', body: 'Speed, equipment fees and what happens when a promotion ends.', benchmark: `Compared with ${whole(b.internetMonthly)}/mo` },
  { name: 'Mobile', body: 'Per-line costs, kept separate from phone payments.', benchmark: `Compared with ${whole(b.mobilePerLine)}/mo per line` },
  { name: 'TV / Streaming', body: 'Cable, satellite and streaming, side by side.', benchmark: `Compared with ${whole(b.tvMonthly)}/mo` },
  { name: 'Electricity / Solar', body: 'Your electric bill against going solar, if you own your home.', benchmark: `Illustrative ${whole(b.electricityWithSolarMonthly)}/mo with solar` },
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
  const set = useMemo(() => bootBenchmarks(), []);
  const preview = useMemo(() => quickPreview({ ...bills, mobileLines: lines, ownsHome }, set), [bills, lines, ownsHome, set]);
  const any = preview.rows.length > 0;
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
    <Card as="div" className="mx-auto w-full max-w-xl shadow-pf-raised">
      <h2 id="preview-t" className="font-display text-2xl font-bold text-pf-ink">Your savings preview</h2>
      <p className="mt-1 text-sm text-pf-muted">Enter any monthly bill. It updates as you type, and nothing is sent anywhere.</p>
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
              {preview.monthlyHigher > 0 && (
                <p className="mt-1 text-sm text-pf-warn">Where a benchmark is higher than your bill we show it as a possible extra cost and leave it out of this total.</p>
              )}
              <ul className="mt-3 space-y-1 text-sm text-pf-muted">
                {preview.rows.map((r) => (
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
            </>
          )}
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
          <HandoffForm bills={bills} mobileLines={lines} ownsHome={ownsHome} onCancel={() => setAsking(false)} />
        </div>
      )}
    </Card>
  );
}

/**
 * Hero background: a still that paints immediately, then a short muted loop on
 * capable devices. People who prefer reduced motion, are saving data or are on
 * a slow connection keep the still. The video never blocks the page: its
 * source is attached only after the first paint.
 */
function HeroMedia() {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion() || isConstrained()) return;
    // Start after the page has fully loaded, so the still is always the first thing painted.
    let id = 0;
    const start = () => (id = window.setTimeout(() => setPlay(true), 1200));
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      window.clearTimeout(id);
    };
  }, []);
  return (
    <div data-depth="0.28" className="absolute inset-x-0 -top-[8%] h-[116%] will-change-transform" aria-hidden>
      <picture>
        <source type="image/webp" srcSet="/media/tucker-hero-768.webp 768w, /media/tucker-hero-1280.webp 1280w, /media/tucker-hero-1920.webp 1920w" sizes="100vw" />
        <img
          src="/media/tucker-hero-1280.jpg"
          srcSet="/media/tucker-hero-768.jpg 768w, /media/tucker-hero-1280.jpg 1280w, /media/tucker-hero-1920.jpg 1920w"
          sizes="100vw"
          width={1920}
          height={1080}
          alt=""
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-cover object-[70%_60%]"
        />
      </picture>
      {play && (
        <video className="absolute inset-0 h-full w-full object-cover object-[70%_60%]" autoPlay muted loop playsInline preload="auto" disablePictureInPicture tabIndex={-1}>
          <source src="/media/tucker-hero-720.webm" type="video/webm" media="(max-width: 900px)" />
          <source src="/media/tucker-hero-720.mp4" type="video/mp4" media="(max-width: 900px)" />
          <source src="/media/tucker-hero-1080.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  );
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  // Three depth layers move at different speeds on scroll (transform only). Off for reduced motion and constrained devices.
  useEffect(() => (ref.current ? attachParallax(ref.current) : undefined), []);
  return (
    <section ref={ref} aria-labelledby="hero-t" className="relative isolate overflow-hidden bg-[#0b1220] text-white">
      <HeroMedia />
      {/* Midground: a soft warm glow and a dark wash that keep the headline readable on every frame. */}
      <div data-depth="0.14" className="absolute inset-0 -z-0 will-change-transform" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b1220]/95 via-[#0b1220]/70 to-[#0b1220]/10" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0b1220] to-transparent" />
        <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-[#f4a35a]/15 blur-3xl" />
      </div>
      <div data-depth="-0.05" className="relative mx-auto flex min-h-[78svh] max-w-6xl flex-col justify-center px-4 py-20 will-change-transform sm:px-6 lg:min-h-[84svh]">
        <p className="font-display text-sm font-bold uppercase tracking-[0.18em] text-[#f6c48f]">{PLATFORM.descriptor}</p>
        <h1 id="hero-t" className="mt-4 max-w-2xl font-display text-[2.6rem] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          See if your household could save <span className="text-[#f6c48f]">50% or more</span> on monthly bills.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-100 sm:text-xl">
          Compare what you pay for internet, mobile, TV and electricity in one place. A preliminary estimate in about a minute, with no account and no contact details.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <a href="#preview" onClick={() => track('cta_click', { location: 'pf_hero' })} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-pf-ink shadow-pf-raised transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            {PRIMARY_CTA}
          </a>
          <a href="#how" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/40 px-7 text-base font-semibold text-white hover:bg-white/10">
            How Tucker works
          </a>
        </div>
        <p className="mt-6 max-w-xl text-sm text-slate-300">Results vary and many households will save less. Figures are illustrative comparisons, not offers or guarantees; real prices are confirmed for your address before you decide anything.</p>
      </div>
    </section>
  );
}

export default function Home() {
  useEffect(() => {
    document.title = PLATFORM_META.title;
  }, []);
  const set = useMemo(() => bootBenchmarks(), []);
  return (
    <>
      <Hero />

      <section aria-labelledby="why-t" className="border-b border-pf-line bg-pf-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <h2 id="why-t" className="font-display text-3xl font-bold leading-tight text-pf-ink sm:text-4xl">Household bills are complicated. Checking them shouldn’t be.</h2>
          <p className="text-lg leading-relaxed text-pf-muted">
            Four bills, four providers, prices that creep up when nobody is looking. Tucker puts them side by side against one clear set of comparison prices, shows you the difference, and connects you with a person who can check what is really
            available for your home.
          </p>
        </div>
      </section>

      <section aria-labelledby="cats" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="cats" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
          Four bills, one check
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories(set).map((c) => (
            <li key={c.name} className="rounded-2xl border border-pf-line bg-pf-surface p-5 shadow-pf-card transition-shadow duration-200 hover:shadow-pf-raised motion-reduce:transition-none">
              <h3 className="font-semibold text-pf-ink">{c.name}</h3>
              <p className="mt-1.5 text-sm text-pf-muted">{c.body}</p>
              <p className="mt-3 text-xs font-semibold text-pf-subtle">{c.benchmark}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-sm text-pf-subtle">{BENCHMARK_DISCLOSURE}</p>
      </section>

      <section id="preview" aria-labelledby="preview-t" className="scroll-mt-4 border-y border-pf-line bg-pf-brand-soft">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div className="lg:pt-8">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-pf-brand">Try it now</p>
            <p className="mt-3 font-display text-3xl font-bold leading-tight text-pf-ink sm:text-4xl">Type what you pay. We’ll find a smarter option.</p>
            <ul className="mt-6 space-y-3 text-pf-ink">
              {['Only the bills you want to compare', 'Monthly and yearly difference, service by service', 'A benchmark that is higher than your bill is shown too, never hidden'].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-pf-save" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-6">
              <Link to="/savings/assess" onClick={() => track('cta_click', { location: 'pf_hero_full' })} className="font-semibold text-pf-brand underline underline-offset-4">
                Prefer the step-by-step version?
              </Link>
            </p>
          </div>
          <QuickPreview />
        </div>
      </section>

      <section id="how" aria-labelledby="how-t" className="scroll-mt-4 bg-pf-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="how-t" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
            How Tucker works
          </h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-pf-line p-6">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-pf-ink font-display text-sm font-bold text-white" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-pf-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-1.5 text-pf-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="data" aria-labelledby="data-t" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-16 sm:px-6">
        <h2 id="data-t" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
          Straight answers about the numbers
        </h2>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['Estimates, not offers', 'Every figure here is a preliminary comparison. Nothing is a quote until a representative confirms it for your address.'],
              ['No guaranteed savings', 'What you could really save depends on availability, eligibility, promotions, equipment or financing terms, taxes and fees.'],
              ['Phone payments kept out', 'Mobile is compared on service only. Device installments are not counted, so the comparison stays like for like.'],
              ['Solar is illustrative', 'Energy use, roof, financing, remaining utility charges and eligibility all change the real result. A site assessment decides it.'],
            ] as const
          ).map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-pf-line bg-pf-surface p-5">
              <dt className="font-semibold text-pf-ink">{t}</dt>
              <dd className="mt-2 text-sm text-pf-muted">{d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 flex flex-wrap items-center gap-2 text-sm text-pf-subtle">
          Benchmark figures always carry this label: <StatusChip status="benchmark" />
        </p>
      </section>

      <section aria-labelledby="go-t" className="bg-pf-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="go-t" className="font-display text-2xl font-bold sm:text-3xl">
              Want real prices for your address?
            </h2>
            <p className="mt-2 max-w-xl text-slate-200">Start with your preview, then ask a representative to check what is actually available. No obligation to switch.</p>
          </div>
          <a href="#preview" onClick={() => track('cta_click', { location: 'pf_closing' })} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-white px-7 font-semibold text-pf-ink hover:bg-slate-100">
            {PRIMARY_CTA}
          </a>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-t" className="mx-auto max-w-3xl scroll-mt-4 px-4 py-16 sm:px-6">
        <h2 id="faq-t" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
          Questions people ask
        </h2>
        <div className="mt-6 divide-y divide-pf-line rounded-2xl border border-pf-line bg-pf-surface">
          {HOME_FAQ.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold text-pf-ink [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="shrink-0 text-xl text-pf-subtle transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-pf-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
