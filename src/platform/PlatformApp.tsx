import './platform.css';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { PLATFORM, PRIMARY_CTA } from '../../shared/platform/brand';
import { bootFlags } from '../lib/market';
import { Mark, Wordmark } from '../components/ui';
import { BRAND } from '../../shared/content';
import { ChatLauncher } from './chat/ChatLauncher';

const Home = lazy(() => import('./pages/Home'));
const Assess = lazy(() => import('./pages/Assess'));
const Results = lazy(() => import('./pages/Results'));
const DesignSystem = lazy(() => import('./pages/DesignSystem'));

/** Header button: the free savings review (the preview form on the home page). */
const HEADER_CTA = 'Get my free review';
const phoneText = BRAND.phone.length === 10 ? `(${BRAND.phone.slice(0, 3)}) ${BRAND.phone.slice(3, 6)}-${BRAND.phone.slice(6)}` : BRAND.phone;

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
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:h-[4.5rem] sm:px-6">
          <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2 font-display text-base font-bold text-pf-ink sm:text-lg">
            <Mark />
            <Wordmark />
          </Link>
          <div className="ml-6 hidden items-center gap-8 text-[15px] font-medium text-pf-muted lg:ml-10 md:flex">
            <a href="/#services" className="py-2 transition-colors hover:text-pf-ink">
              Home services
            </a>
            <a href="/#how" className="py-2 transition-colors hover:text-pf-ink">
              How it works
            </a>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-5">
            {BRAND.phone && (
              <a href={`tel:+1${BRAND.phone}`} className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-[15px] font-semibold text-pf-ink hover:text-pf-brand" aria-label={`Call Tucker at ${phoneText}`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
                </svg>
                <span className="hidden sm:inline">{phoneText}</span>
              </a>
            )}
            <a href="/#preview" className="inline-flex min-h-11 items-center rounded-xl bg-pf-brand px-4 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-pf-brand-strong sm:px-5">
              {/* Phones: the short form, so logo, call button and this button fit even at 320px. */}
              <span className="sm:hidden">Free review</span>
              <span className="hidden sm:inline">{HEADER_CTA}</span>
            </a>
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
      <ChatLauncher />
      {/* Extra bottom space on phones so the chat button never covers the last line of the footer. */}
      <footer className="border-t border-pf-line bg-pf-surface px-4 pb-24 pt-8 text-sm text-pf-muted sm:px-6 sm:pb-8">
        <div className="mx-auto max-w-6xl space-y-3">
          <p>
            <strong className="text-pf-ink">{PLATFORM.name}</strong> is operated by {PLATFORM.operator}. Tucker may receive compensation from providers. Every price shows where it came from and when it was checked.
          </p>
          <p>Savings shown are estimates based on what you tell us and the prices on file. Future price increases are hypothetical scenarios, not predictions.</p>
          <p className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/privacy" className="underline underline-offset-4">
              Privacy notice
            </Link>
            {/* Sign-in for Tucker representatives and staff (the same page as the team area; never indexed). */}
            <Link to="/admin/login" rel="nofollow" className="underline underline-offset-4">
              Rep Login
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
        <a href="/#preview" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-pf-field px-5 font-semibold text-pf-ink hover:bg-pf-surface">
          {PRIMARY_CTA}
        </a>
      </div>
    </div>
  );
}

/** Tucker: the home page, the savings preview and results, and the not-found page. */
export default function PlatformApp() {
  // The public site is white: page background (seen while loading and when scrolling past the edge on phones) and the phone's browser bar.
  useEffect(() => {
    const body = document.body.style.background;
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = meta?.getAttribute('content') ?? '';
    document.body.style.background = '#ffffff';
    meta?.setAttribute('content', '#ffffff');
    return () => {
      document.body.style.background = body;
      meta?.setAttribute('content', color);
    };
  }, []);
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
