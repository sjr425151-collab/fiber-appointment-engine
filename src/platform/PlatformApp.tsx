import './platform.css';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { PLATFORM, PRIMARY_CTA } from '../../shared/platform/brand';
import { bootFlags } from '../lib/market';
import { Mark, Wordmark } from '../components/ui';

const Home = lazy(() => import('./pages/Home'));
const Assess = lazy(() => import('./pages/Assess'));
const Results = lazy(() => import('./pages/Results'));
const DesignSystem = lazy(() => import('./pages/DesignSystem'));

function Shell({ children }: { children: ReactNode }) {
  const flags = bootFlags();
  return (
    <div className="pf flex min-h-screen flex-col font-sans">
      <a href="#pf-main" className="sr-only z-50 rounded-lg bg-pf-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="border-b border-pf-line bg-pf-surface">
        {flags.env !== 'production' && (
          <div role="note" className="bg-pf-sample px-4 py-2 text-center text-sm font-medium text-white">
            {flags.env === 'staging' ? 'Staging preview' : 'Development build'} — not the live site.
            {flags.sampleData && ' Offers marked “Sample data” are illustrative only.'}
          </div>
        )}
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-pf-ink sm:text-lg">
            <Mark />
            <Wordmark />
          </Link>
          <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-4">
            <a href="/#how" className="hidden rounded-lg px-2 py-2 text-pf-muted hover:text-pf-ink sm:inline">
              How it works
            </a>
            <a href="/#data" className="hidden rounded-lg px-2 py-2 text-pf-muted hover:text-pf-ink md:inline">
              Our data
            </a>
            <Link to="/savings/assess" className="inline-flex min-h-11 items-center rounded-xl bg-pf-brand px-3 font-semibold sm:px-4 text-white hover:bg-pf-brand-strong">
              {PRIMARY_CTA}
            </Link>
          </div>
        </nav>
      </header>
      <main id="pf-main" className="flex-1">
        <Suspense
          fallback={
            <div className="grid min-h-[50vh] place-items-center text-pf-muted" role="status">
              Loading…
            </div>
          }
        >
          {children}
        </Suspense>
      </main>
      <footer className="border-t border-pf-line bg-pf-surface px-4 py-8 text-sm text-pf-muted sm:px-6">
        <div className="mx-auto max-w-6xl space-y-3">
          <p>
            <strong className="text-pf-ink">{PLATFORM.name}</strong> is operated by {PLATFORM.operator}. We may be paid by providers when a
            household switches; payment never changes how options are ranked, and every price shows where it came from and when it was checked.
          </p>
          <p>Savings shown are estimates based on what you tell us and the prices on file. Future price increases are hypothetical scenarios, not predictions.</p>
          <p>
            <Link to="/privacy" className="underline underline-offset-4">
              Privacy notice
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

function NotFound() {
  useEffect(() => {
    document.title = `Page not found – ${PLATFORM.name}`;
  }, []);
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="font-display text-3xl font-bold text-pf-ink">We can’t find that page</h1>
      <p className="mt-3 text-pf-muted">The link may be old or mistyped. Your savings preview is one tap away.</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Link to="/" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-pf-brand px-5 font-semibold text-white hover:bg-pf-brand-strong">
          Go to the home page
        </Link>
        <Link to="/savings/assess" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-pf-field px-5 font-semibold text-pf-ink hover:bg-pf-surface">
          {PRIMARY_CTA}
        </Link>
      </div>
    </div>
  );
}

/** Tucker: the home page, the savings preview and results, and the not-found page. */
export default function PlatformApp() {
  return (
    <Shell>
      <Routes>
        <Route index element={<Home />} />
        <Route path="savings" element={<Navigate to="/" replace />} />
        <Route path="savings/assess" element={<Assess />} />
        <Route path="savings/results/:id" element={<Results />} />
        <Route path="savings/design" element={<DesignSystem />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Shell>
  );
}
