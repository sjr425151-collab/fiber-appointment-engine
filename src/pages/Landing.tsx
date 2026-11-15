import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AvailabilityResult } from '../../shared/schemas';
import { BRAND, PARTNER_DISCLOSURE } from '../../shared/content';
import { api, ApiError } from '../lib/api';
import SignupFlow, { AvailabilityBanner } from '../components/SignupFlow';
import { Check, Logo, Spinner } from '../components/ui';

const BENEFITS = [
  { title: 'Fiber all the way home', body: 'A dedicated fiber-optic line built for today’s streaming, gaming and video calls — not a legacy copper network.' },
  { title: 'Fast uploads, too', body: 'Fiber is designed for strong upload speeds, so backups, livestreams and work-from-home calls stay smooth.' },
  { title: 'Every device, every room', body: 'Plenty of headroom for smart TVs, phones, consoles and cameras running at the same time.' },
  { title: 'Local Monroe specialists', body: 'Talk with someone who knows the area, can confirm your address and walks you through install day.' },
];

const STEPS = [
  { n: '01', title: 'Check your ZIP', body: 'See whether your neighborhood is live, in the build area, or on the expansion map.' },
  { n: '02', title: 'Book a free consultation', body: 'Pick a time that works. We confirm your exact address and match you to the right plan.' },
  { n: '03', title: 'Get connected', body: 'Omni Fiber schedules your professional installation and you’re online with fiber.' },
];

const FAQ = [
  { q: 'Is the consultation really free?', a: 'Yes. There’s no cost and no obligation — it’s a conversation to confirm availability at your address and answer questions.' },
  { q: 'How do I know if fiber is available at my house?', a: 'Availability is confirmed address-by-address. Enter your ZIP for a quick read on your area, then book a consultation for a definitive answer.' },
  { q: 'What are the plans and prices?', a: 'Plans and current offers are set by Omni Fiber and can vary by address. Your specialist will walk you through the options available to you.' },
  { q: 'What if my area isn’t ready yet?', a: 'Leave your details and you’ll be on the priority list — we’ll reach out as soon as service reaches your street.' },
];

export default function Landing() {
  const [zip, setZip] = useState('');
  const [checking, setChecking] = useState(false);
  const [zipError, setZipError] = useState('');
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

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
      requestAnimationFrame(() => flowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      setZipError(err instanceof ApiError ? err.message : 'Network error. Please try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* ---------------------------------------------------------- nav -- */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo />
          <div className="flex items-center gap-6 text-sm text-slate-300">
            <a href="#how" className="hidden hover:text-white sm:inline">How it works</a>
            <a href="#faq" className="hidden hover:text-white sm:inline">FAQ</a>
            <a href="#check" className="btn-primary whitespace-nowrap px-4 py-2 text-sm">
              <span className="sm:hidden">Check</span>
              <span className="hidden sm:inline">Check availability</span>
            </a>
          </div>
        </nav>
      </header>

      {/* --------------------------------------------------------- hero -- */}
      <section id="check" className="fiber-lines relative">
        <svg className="pointer-events-none absolute inset-x-0 top-0 h-full w-full opacity-40" viewBox="0 0 1200 600" preserveAspectRatio="none" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M-50 ${420 + i * 40} C 300 ${300 + i * 30}, 700 ${520 - i * 40}, 1250 ${180 + i * 50}`} fill="none" stroke="url(#hl)" strokeWidth="1.5" className="animate-pulse-line" style={{ animationDelay: `${i * 0.7}s` }} />
          ))}
          <defs>
            <linearGradient id="hl" x1="0" x2="1">
              <stop offset="0" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
        </svg>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-fiber-400/30 bg-fiber-400/10 px-3 py-1 text-xs font-medium text-fiber-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fiber-400" /> Now expanding across {BRAND.market}
            </p>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">
              {BRAND.provider} is bringing fiber internet to <span className="text-gradient">Monroe</span>.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">
              Find out if your home qualifies and reserve a free, no-pressure consultation with a local fiber specialist.
            </p>
            <ul className="mt-6 grid gap-2 text-slate-300 sm:grid-cols-2">
              {['Free in-home consultation', 'Address-level availability check', 'Local Monroe team', 'No obligation'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-fiber-400" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="glass p-6 shadow-2xl shadow-pulse-500/10 sm:p-8">
            <h2 className="font-display text-xl font-bold">Check fiber availability</h2>
            <p className="mt-1 text-sm text-slate-400">Start with your ZIP code — it takes seconds.</p>
            <form onSubmit={check} className="mt-5 flex gap-2" noValidate>
              <label htmlFor="zip" className="sr-only">ZIP code</label>
              <input
                id="zip"
                className="input text-lg tracking-widest"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={5}
                placeholder="48161"
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))}
                aria-invalid={!!zipError}
              />
              <button className="btn-primary shrink-0 px-6" disabled={checking}>
                {checking ? <Spinner /> : 'Check'}
              </button>
            </form>
            {zipError && <p className="field-error">{zipError}</p>}
            {result && (
              <div className="mt-5">
                <AvailabilityBanner result={result} />
              </div>
            )}
            <p className="mt-5 text-xs text-slate-500">Serving Monroe (48161, 48162) and surrounding Monroe County communities.</p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- signup flow -- */}
      {result && (
        <section ref={flowRef} className="scroll-mt-20 px-4 pb-20 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <SignupFlow zip={result.zip} city={result.city ?? ''} availability={result} />
          </div>
        </section>
      )}

      {/* ----------------------------------------------------- benefits -- */}
      <section className="border-t border-white/5 bg-ink-900/50 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-2xl font-display text-3xl font-bold sm:text-4xl">Internet that keeps up with your household.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((b) => (
              <div key={b.title} className="glass p-6 transition hover:border-fiber-400/30">
                <div className="mb-4 h-10 w-10 rounded-xl bg-gradient-to-br from-fiber-400/30 to-pulse-500/30 ring-1 ring-white/10" />
                <h3 className="font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- how it works -- */}
      <section id="how" className="px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">How it works</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative">
                <span className="font-display text-5xl font-extrabold text-white/10">{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-slate-400">{s.body}</p>
              </div>
            ))}
          </div>
          <a href="#check" className="btn-primary mt-12">Check my address →</a>
        </div>
      </section>

      {/* ---------------------------------------------------------- faq -- */}
      <section id="faq" className="border-t border-white/5 bg-ink-900/50 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">Questions, answered</h2>
          <div className="mt-8 divide-y divide-white/10">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                  {f.q}
                  <span className="text-fiber-400 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- footer -- */}
      <footer className="border-t border-white/5 px-4 py-10 text-sm text-slate-500 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl space-y-3">
            <Logo />
            <p>{PARTNER_DISCLOSURE}</p>
            <p>© {new Date().getFullYear()} {BRAND.agency}. All rights reserved.</p>
          </div>
          <Link to="/admin" className="hover:text-slate-300">Team login</Link>
        </div>
      </footer>
    </div>
  );
}
