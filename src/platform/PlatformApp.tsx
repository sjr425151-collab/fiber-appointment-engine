import './platform.css';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { PLATFORM } from '../../shared/platform/brand';
import { bootFlags } from '../lib/market';
import { Wordmark } from '../components/ui';

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
          <Link to="/savings" className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-pf-ink sm:text-lg">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-pf-ink text-sm text-white" aria-hidden>
              ¢
            </span>
            <Wordmark />
          </Link>
          <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-4">
            <a href="/savings#how" className="hidden rounded-lg px-2 py-2 text-pf-muted hover:text-pf-ink sm:inline">
              How it works
            </a>
            <a href="/savings#data" className="hidden rounded-lg px-2 py-2 text-pf-muted hover:text-pf-ink md:inline">
              Our data
            </a>
            <Link to="/savings/assess" className="inline-flex min-h-11 items-center rounded-xl bg-pf-brand px-3 font-semibold sm:px-4 text-white hover:bg-pf-brand-strong">
              Find My Savings
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
    document.title = 'Page not found';
  }, []);
  return (
    <div className="pf grid min-h-screen place-items-center px-4 text-center">
      <div>
        <h1 className="font-display text-3xl font-bold text-pf-ink">Page not found</h1>
        <a href="/" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-pf-brand px-5 font-semibold text-white">
          Go to the home page
        </a>
      </div>
    </div>
  );
}

/** Parent platform. Renders nothing unless the server enabled it (production: off). */
export default function PlatformApp() {
  if (!bootFlags().platform) return <NotFound />;
  return (
    <Shell>
      <Routes>
        <Route index element={<Home />} />
        <Route path="assess" element={<Assess />} />
        <Route path="results/:id" element={<Results />} />
        <Route path="design" element={<DesignSystem />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Shell>
  );
}
