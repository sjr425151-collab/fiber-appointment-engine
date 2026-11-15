import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND, PARTNER_DISCLOSURE } from '../../../shared/content';
import { track } from '../../lib/analytics';
import { Logo } from '../ui';

const YEAR = new Date().getFullYear();

export const hasPhone = Boolean(BRAND.phoneDisplay && BRAND.phoneE164);

const NAV = [
  { href: '#offer', label: 'Free consultation' },
  { href: '#compare', label: 'Why fiber' },
  { href: '#how', label: 'How it works' },
  { href: '#faq', label: 'FAQ' },
];

export function PhoneIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.15a1.5 1.5 0 0 1 1.46 1.14l.7 2.8a1.5 1.5 0 0 1-.43 1.46L5.3 8.4a11 11 0 0 0 6.3 6.3l1-1.08a1.5 1.5 0 0 1 1.46-.43l2.8.7A1.5 1.5 0 0 1 18 15.35v1.15a1.5 1.5 0 0 1-1.5 1.5H15C7.82 18 2 12.18 2 5V3.5Z" />
    </svg>
  );
}

export function CallButton({ location, className = '' }: { location: string; className?: string }) {
  if (!hasPhone) return null;
  return (
    <a href={`tel:${BRAND.phoneE164}`} onClick={() => track('call_click', { location })} className={className}>
      <PhoneIcon /> <span>{BRAND.phoneDisplay}</span>
    </a>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Only flips a boolean when crossing the threshold — no per-frame rerenders.
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    const sentinel = document.getElementById('top-sentinel');
    if (sentinel) io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${scrolled || open ? 'border-b border-white/10 bg-ink-950/85 backdrop-blur-xl' : 'bg-transparent'}`}
    >
      <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href="#top" aria-label="Monroe Fiber Connect — back to top">
          <Logo />
        </a>
        <div className="hidden items-center gap-7 text-sm text-slate-300 lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="transition hover:text-white">
              {n.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <CallButton location="header" className="btn-ghost hidden px-3 py-2 text-sm md:inline-flex" />
          <a href="#check" onClick={() => track('cta_click', { location: 'header' })} className="btn-primary hidden whitespace-nowrap px-4 py-2 text-sm sm:inline-flex">
            Check availability
          </a>
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 text-slate-200 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>
      {open && (
        <div id="mobile-menu" className="border-t border-white/10 px-4 pb-5 pt-2 lg:hidden">
          <ul className="flex flex-col">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-3 text-base text-slate-200 hover:bg-white/5">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2">
            <a href="#check" onClick={() => { setOpen(false); track('cta_click', { location: 'mobile_menu' }); }} className="btn-primary w-full">
              Check availability
            </a>
            <CallButton location="mobile_menu" className="btn-ghost w-full" />
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * Sticky bottom CTA on phones. Appears once the hero's ZIP form has scrolled
 * away and hides again while the signup form is on screen.
 */
export function MobileCtaBar({ signupOpen }: { signupOpen: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let heroGone = false;
    let formVisible = false;
    const update = () => setShow(heroGone && !formVisible);
    const hero = document.getElementById('zip-form');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target.id === 'zip-form') heroGone = !e.isIntersecting && e.boundingClientRect.top < 0;
        else formVisible = e.isIntersecting;
      }
      update();
    });
    if (hero) io.observe(hero);
    const flow = document.getElementById('signup-section');
    if (flow) io.observe(flow);
    return () => io.disconnect();
  }, [signupOpen]);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/90 px-4 pt-3 backdrop-blur-xl transition-transform duration-300 md:hidden ${show ? 'translate-y-0' : 'translate-y-full'}`}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      aria-hidden={!show}
    >
      <div className="flex gap-2">
        <a href="#check" tabIndex={show ? 0 : -1} onClick={() => track('cta_click', { location: 'sticky_bar' })} className="btn-primary flex-1">
          Check my address
        </a>
        {hasPhone && (
          <a href={`tel:${BRAND.phoneE164}`} tabIndex={show ? 0 : -1} onClick={() => track('call_click', { location: 'sticky_bar' })} className="btn-ghost px-4" aria-label={`Call ${BRAND.phoneDisplay}`}>
            <PhoneIcon className="h-5 w-5" />
          </a>
        )}
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 px-4 pb-28 pt-12 text-sm text-slate-400 sm:px-6 md:pb-12">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xl">{PARTNER_DISCLOSURE}</p>
          <p>
            © {YEAR} {BRAND.agency}. All rights reserved.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-2 md:justify-self-end">
          <a href="/#check" className="hover:text-white">Check availability</a>
          <a href="/#faq" className="hover:text-white">FAQ</a>
          <Link to="/privacy" className="hover:text-white">Privacy notice</Link>
          <Link to="/admin" className="hover:text-white" rel="nofollow">Team login</Link>
          {hasPhone && (
            <a href={`tel:${BRAND.phoneE164}`} onClick={() => track('call_click', { location: 'footer' })} className="hover:text-white">
              {BRAND.phoneDisplay}
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
