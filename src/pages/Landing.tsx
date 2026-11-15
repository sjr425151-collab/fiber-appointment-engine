import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AvailabilityResult } from '../../shared/schemas';
import { BRAND, BROADBAND_DISCLOSURE, FAQ, OMNI_LINKS } from '../../shared/content';
import { PLANS, PLANS_FROM, PLANS_VERIFIED_ON } from '../../shared/plans';
import { api, ApiError } from '../lib/api';
import { attribution, track } from '../lib/analytics';
import { attachParallax } from '../lib/motion';
import HeroMedia from '../components/HeroMedia';
import AvailabilityBanner from '../components/AvailabilityBanner';
import { CallButton, hasPhone, MobileCtaBar, SiteFooter, SiteHeader, TextButton } from '../components/landing/Chrome';
import { Check, Spinner } from '../components/ui';

const SignupFlow = lazy(() => import('../components/SignupFlow'));

const TRUST = ['Free consultation', 'No obligation', 'Local Monroe specialists', 'Confirmed address by address'];

const OFFER = [
  { title: 'Address-level confirmation', body: 'We check service at your exact address — not just your ZIP — so you know where you stand.' },
  { title: 'Plan walkthrough', body: 'A specialist explains the Omni Fiber plans and offers available at your home, with no pressure.' },
  { title: 'Install guidance', body: 'Know what to expect on installation day and how to get set up quickly.' },
  { title: 'Priority list', body: 'Not live on your street yet? We’ll put you first in line and reach out when it is.' },
];

const STEPS = [
  { n: '01', title: 'Check your ZIP', body: 'See whether your neighborhood is live, in the build area, or on the expansion map.' },
  { n: '02', title: 'Book a free consultation', body: 'Pick a time that suits you. We confirm your address and match you to the right plan.' },
  { n: '03', title: 'Get connected', body: 'Omni Fiber schedules your professional installation and you’re online with fiber.' },
];

/** General technology characteristics only — no provider-specific claims. */
const COMPARE: { label: string; fiber: string; others: [string, string, string] }[] = [
  { label: 'Line into your home', fiber: 'Fiber-optic (light)', others: ['Coaxial copper', 'Phone-line copper', 'Satellite dish'] },
  { label: 'Upload speed', fiber: 'Often equal to download', others: ['Usually far below download', 'Low', 'Low'] },
  { label: 'Latency (lag)', fiber: 'Very low', others: ['Low to moderate', 'Moderate', 'Higher'] },
  { label: 'Speed over distance', fiber: 'Holds up over long runs', others: ['Shared neighborhood capacity', 'Drops with distance', 'Not distance-based'] },
  { label: 'Weather sensitivity', fiber: 'Minimal', others: ['Low', 'Low', 'Can be affected'] },
];
const OTHERS = ['Cable', 'DSL', 'Satellite'];

function FiberLines() {
  return (
    <svg className="h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="hl" x1="0" x2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset=".5" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M-50 ${560 + i * 50} C 320 ${430 + i * 30}, 720 ${640 - i * 50}, 1250 ${300 + i * 60}`}
          fill="none"
          stroke="url(#hl)"
          strokeWidth="1.6"
          className="animate-pulse-line"
          style={{ animationDelay: `${i * 1.1}s` }}
        />
      ))}
    </svg>
  );
}

export default function Landing() {
  const [zip, setZip] = useState('');
  const [checking, setChecking] = useState(false);
  const [zipError, setZipError] = useState('');
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const heroRef = useRef<HTMLElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    attribution();
    track('page_view');
  }, []);

  useEffect(() => (heroRef.current ? attachParallax(heroRef.current) : undefined), []);

  async function check(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) {
      setZipError('Enter a 5-digit ZIP code');
      return;
    }
    setZipError('');
    setChecking(true);
    try {
      const r = await api<AvailabilityResult>(`/availability?zip=${zip}`);
      setResult(r);
      track('zip_check', { status: r.status });
      setTimeout(() => flowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    } catch (err) {
      setZipError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : 'Network error. Please try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div id="top" className="min-h-screen overflow-x-clip">
      <a href="#check" className="sr-only z-50 rounded-lg bg-white px-4 py-2 text-ink-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to availability check
      </a>
      <span id="top-sentinel" className="absolute top-0 h-px w-px" aria-hidden />
      <SiteHeader />

      <main>
        {/* ------------------------------------------------------- hero -- */}
        <section ref={heroRef} id="check" aria-labelledby="hero-title" className="relative isolate flex min-h-[100svh] scroll-mt-16 items-end overflow-hidden lg:items-center">
          {/* Depth 1 — cinematic media, slowest */}
          <div data-depth="0.3" className="absolute inset-0 -z-30">
            <HeroMedia />
          </div>
          {/* Depth 2 — animated fiber light */}
          <div data-depth="0.15" className="pointer-events-none absolute inset-0 -z-20 opacity-60 mix-blend-screen motion-reduce:hidden">
            <FiberLines />
          </div>
          {/* Readability scrims (static) */}
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink-950/80 via-ink-950/35 to-ink-950 lg:bg-gradient-to-r lg:from-ink-950/95 lg:via-ink-950/60 lg:to-ink-950/10" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-ink-950 to-transparent" aria-hidden />

          {/* Depth 3 — content, moves with the page (never parallaxed, for readability) */}
          <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pb-8 pt-20 sm:px-6 sm:pb-10 sm:pt-24 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:pb-16 lg:pt-28">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-fiber-400/40 bg-ink-950/50 px-3 py-1 text-xs font-medium text-cyan-200 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-fiber-400 motion-safe:animate-pulse" /> Now expanding across {BRAND.market}
              </p>
              <h1 id="hero-title" className="mt-4 font-display text-[2.35rem] font-extrabold [@media(min-height:740px)]:text-[2.6rem] leading-[1.04] tracking-tight [text-shadow:0_2px_24px_rgb(6_9_20/0.6)] sm:text-6xl lg:text-[4.2rem]">
                {BRAND.provider} is bringing fiber internet to <span className="text-gradient">Monroe</span>.
              </h1>
              <p className="mt-4 max-w-xl text-lg text-slate-200 max-sm:[@media(max-height:720px)]:hidden sm:text-xl">
                Find out if your home qualifies and reserve a free, no-pressure consultation with a local fiber specialist.
              </p>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2 text-slate-100 sm:mt-5">
                <span className="text-sm uppercase tracking-wider text-cyan-200">1 Gig from</span>
                <span className="font-display text-3xl font-extrabold">{PLANS_FROM}</span>
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-slate-200 sm:text-base">
                {['Free installation', 'Free equipment', 'No extra taxes or fees', 'No contracts'].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-fiber-400" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass bg-ink-950/60 p-5 shadow-2xl shadow-pulse-500/10 sm:p-8">
              <h2 className="font-display text-xl font-bold">Check fiber availability</h2>
              <p className="mt-1 text-sm text-slate-300">Start with your ZIP code — it takes seconds.</p>
              <form id="zip-form" onSubmit={check} className="mt-4 flex gap-2" noValidate>
                <label htmlFor="zip" className="sr-only">
                  ZIP code
                </label>
                <input
                  id="zip"
                  name="zip"
                  className="input text-lg tracking-widest"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={5}
                  placeholder="ZIP code"
                  value={zip}
                  onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))}
                  aria-invalid={!!zipError}
                  aria-describedby={zipError ? 'zip-error' : undefined}
                />
                <button className="btn-primary shrink-0 px-6" disabled={checking}>
                  {checking ? <Spinner /> : 'Check'}
                </button>
              </form>
              {zipError && (
                <p id="zip-error" className="field-error" role="alert">
                  {zipError}
                </p>
              )}
              {result && (
                <div className="mt-4">
                  <AvailabilityBanner result={result} />
                </div>
              )}
              <p className="mt-4 text-xs text-slate-300">Monroe (48161, 48162) and surrounding Monroe County communities. Exact-address coverage is confirmed with {BRAND.provider}’s official checker.</p>
              {hasPhone && (
                <p className="mt-3 border-t border-white/10 pt-3 text-sm text-slate-300">
                  Prefer to talk? Call or text{' '}
                  <CallButton location="hero" className="inline-flex items-center gap-1 font-semibold text-cyan-200 underline-offset-4 hover:underline" />
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- signup flow -- */}
        {result && (
          <section ref={flowRef} id="signup-section" aria-label="Sign up" className="scroll-mt-20 px-4 py-12 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <Suspense
                fallback={
                  <div className="glass grid h-96 place-items-center text-slate-400">
                    <Spinner />
                  </div>
                }
              >
                <SignupFlow key={result.zip} zip={result.zip} city={result.city ?? ''} availability={result} />
              </Suspense>
            </div>
          </section>
        )}

        {/* --------------------------------------------------- trust bar -- */}
        <section aria-label="Why people book with us" className="border-y border-white/10 bg-ink-900/60">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-6 text-sm text-slate-200 sm:px-6 md:grid-cols-4">
            {TRUST.map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-fiber-400" /> {t}
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------ offer -- */}
        <section id="offer" aria-labelledby="offer-title" className="scroll-mt-16 px-4 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">The offer</p>
              <h2 id="offer-title" className="mt-3 font-display text-3xl font-bold sm:text-4xl">
                A free, no-obligation fiber consultation.
              </h2>
              <p className="mt-4 text-lg text-slate-300">
                Spend a few minutes with a local specialist and leave knowing exactly what’s available at your home.
              </p>
              <ul className="mt-8 grid gap-5 sm:grid-cols-2">
                {OFFER.map((o) => (
                  <li key={o.title}>
                    <h3 className="flex items-center gap-2 font-semibold">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-fiber-400 to-pulse-500 text-ink-950">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      {o.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-300">{o.body}</p>
                  </li>
                ))}
              </ul>
              <a href="#check" onClick={() => track('cta_click', { location: 'offer' })} className="btn-primary mt-9">
                Book my free consultation →
              </a>
            </div>
            <figure className="relative">
              <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-fiber-400/20 to-pulse-500/20 blur-2xl" aria-hidden />
              <picture>
                <source type="image/avif" srcSet="/media/home-640.avif 640w, /media/home-960.avif 960w, /media/home-1400.avif 1400w" sizes="(min-width: 1024px) 560px, 100vw" />
                <source type="image/webp" srcSet="/media/home-640.webp 640w, /media/home-960.webp 960w, /media/home-1400.webp 1400w" sizes="(min-width: 1024px) 560px, 100vw" />
                <img
                  src="/media/home-960.jpg"
                  srcSet="/media/home-640.jpg 640w, /media/home-960.jpg 960w, /media/home-1400.jpg 1400w"
                  sizes="(min-width: 1024px) 560px, 100vw"
                  width={1400}
                  height={1045}
                  loading="lazy"
                  decoding="async"
                  alt="A fiber-optic line glowing as it runs from a wall outlet to a home Wi-Fi router in a cozy living room at dusk"
                  className="aspect-[4/3] w-full rounded-3xl border border-white/10 object-cover"
                />
              </picture>
            </figure>
          </div>
        </section>

        {/* ------------------------------------------------------ plans -- */}
        <section id="plans" aria-labelledby="plans-title" className="scroll-mt-16 border-t border-white/10 px-4 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">Monroe plans</p>
            <h2 id="plans-title" className="mt-3 max-w-2xl font-display text-3xl font-bold sm:text-4xl">
              Simple pricing. Everything included.
            </h2>
            <p className="mt-4 max-w-2xl text-lg text-slate-300">
              {BRAND.provider} internet with free installation, free equipment and no contracts — and no extra taxes or fees on top of your monthly price.
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:max-w-4xl">
              {PLANS.map((p) => (
                <div key={p.name} className={`glass relative flex flex-col p-6 sm:p-8 ${p.featured ? 'border-fiber-400/50 ring-1 ring-fiber-400/40' : ''}`}>
                  <h3 className="font-display text-2xl font-bold">{p.name}</h3>
                  <p className="mt-1 text-sm text-slate-300">{p.speed}</p>
                  <p className="mt-5">
                    <span className="text-gradient font-display text-5xl font-extrabold">{p.price.replace('/mo', '')}</span>
                    <span className="text-lg text-slate-300">/mo</span>
                  </p>
                  <ul className="mt-6 space-y-2.5 text-slate-200">
                    {p.highlights.map((h) => (
                      <li key={h} className="flex gap-2">
                        <Check className="mt-0.5 h-5 w-5 shrink-0 text-fiber-400" />
                        {h}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-8">
                    <a href="#check" onClick={() => track('cta_click', { location: `plan_${p.name}` })} className={`${p.featured ? 'btn-primary' : 'btn-ghost'} w-full py-3.5`}>
                      Check availability for {p.name}
                    </a>
                    <a
                      href={OMNI_LINKS.broadbandLabels}
                      target="_blank"
                      rel="noopener"
                      onClick={() => track('outbound_click', { target: 'broadband_label', plan: p.name })}
                      className="mt-3 block text-center text-sm text-cyan-200 underline underline-offset-4"
                    >
                      Broadband Facts label for {p.name}
                      <span className="sr-only"> (opens Omni Fiber’s site in a new tab)</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <div id="broadband-facts" className="mt-8 max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-300">
              <h3 className="font-semibold text-white">Broadband Facts &amp; disclosures</h3>
              <p className="mt-2">{BROADBAND_DISCLOSURE}</p>
              <p className="mt-2">
                Monroe, MI pricing as of {PLANS_VERIFIED_ON}. Service availability is confirmed per address using {BRAND.provider}’s official{' '}
                <a href={OMNI_LINKS.availability} target="_blank" rel="noopener" onClick={() => track('outbound_click', { target: 'omni_checker', location: 'plans' })} className="text-cyan-200 underline underline-offset-4">
                  availability checker
                </a>
                . Plans and offers are set by {BRAND.provider} and may change.{' '}
                <a href={OMNI_LINKS.broadbandLabels} target="_blank" rel="noopener" onClick={() => track('outbound_click', { target: 'broadband_labels', location: 'disclosure' })} className="text-cyan-200 underline underline-offset-4">
                  View all Omni Fiber Broadband Facts labels
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------- why / compare -- */}
        <section id="compare" aria-labelledby="compare-title" className="scroll-mt-16 border-t border-white/10 bg-ink-900/50 px-4 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">Why fiber</p>
            <h2 id="compare-title" className="mt-3 max-w-2xl font-display text-3xl font-bold sm:text-4xl">
              How fiber compares to other home internet.
            </h2>

            {/* Desktop table */}
            <div className="glass mt-10 hidden overflow-hidden md:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Typical characteristics of home internet technologies</caption>
                <thead>
                  <tr className="border-b border-white/10 text-slate-300">
                    <th scope="col" className="px-5 py-4 font-medium">
                      <span className="sr-only">Characteristic</span>
                    </th>
                    <th scope="col" className="bg-fiber-400/10 px-5 py-4 font-display text-base font-bold text-white">Fiber</th>
                    {OTHERS.map((o) => (
                      <th key={o} scope="col" className="px-5 py-4 font-medium">{o}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {COMPARE.map((r) => (
                    <tr key={r.label}>
                      <th scope="row" className="px-5 py-4 font-medium text-slate-200">{r.label}</th>
                      <td className="bg-fiber-400/[0.06] px-5 py-4 font-semibold text-cyan-100">{r.fiber}</td>
                      {r.others.map((o, i) => (
                        <td key={i} className="px-5 py-4 text-slate-300">{o}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <dl className="mt-8 grid gap-3 md:hidden">
              {COMPARE.map((r) => (
                <div key={r.label} className="glass p-4">
                  <dt className="text-sm font-medium text-slate-300">{r.label}</dt>
                  <dd className="mt-1 font-semibold text-cyan-100">Fiber: {r.fiber}</dd>
                  <dd className="mt-1 text-sm text-slate-300">
                    {OTHERS.map((o, i) => `${o}: ${r.others[i]}`).join(' · ')}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-slate-400">
              General characteristics of each technology. Actual speeds and performance depend on the plan and provider — see each plan’s Broadband Facts label.
            </p>
          </div>
        </section>

        {/* ----------------------------------------------- how it works -- */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-16 px-4 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto max-w-6xl">
            <h2 id="how-title" className="font-display text-3xl font-bold sm:text-4xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="relative">
                  <span className="text-gradient font-display text-5xl font-extrabold" aria-hidden>
                    {s.n}
                  </span>
                  <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-slate-300">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* -------------------------------------------------------- faq -- */}
        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 border-t border-white/10 bg-ink-900/50 px-4 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto max-w-3xl">
            <h2 id="faq-title" className="font-display text-3xl font-bold sm:text-4xl">
              Questions, answered
            </h2>
            <div className="mt-8 divide-y divide-white/10">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="text-xl text-fiber-400 transition group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-2 text-slate-300">
                    {f.a}
                    {f.q.startsWith('What do you do') && (
                      <>
                        {' '}
                        <Link to="/privacy" className="text-cyan-200 underline underline-offset-4">
                          Read the privacy notice
                        </Link>
                        .
                      </>
                    )}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- final CTA -- */}
        <section aria-labelledby="cta-title" className="relative isolate overflow-hidden px-4 py-20 sm:px-6 lg:py-28">
          <div className="fiber-lines absolute inset-0 -z-10" aria-hidden />
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="cta-title" className="font-display text-3xl font-bold sm:text-5xl">
              Ready to see if fiber reaches <span className="text-gradient">your street</span>?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">It takes seconds to check, and the consultation is always free.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#check" onClick={() => track('cta_click', { location: 'final' })} className="btn-primary px-8 py-4 text-base">
                Check availability
              </a>
              <CallButton location="final" className="btn-ghost px-6 py-4" />
              <TextButton location="final" className="btn-ghost px-6 py-4" />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <MobileCtaBar signupOpen={!!result} />
    </div>
  );
}
