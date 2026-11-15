import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND, broadbandDisclosure, partnerDisclosure, place } from '../../../shared/content';
import { track } from '../../lib/analytics';
import { allMarkets, hasPhone, marketPath, useMarket } from '../../lib/market';
import { Logo } from '../ui';

const YEAR = new Date().getFullYear();

export function PhoneIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.15a1.5 1.5 0 0 1 1.46 1.14l.7 2.8a1.5 1.5 0 0 1-.43 1.46L5.3 8.4a11 11 0 0 0 6.3 6.3l1-1.08a1.5 1.5 0 0 1 1.46-.43l2.8.7A1.5 1.5 0 0 1 18 15.35v1.15a1.5 1.5 0 0 1-1.5 1.5H15C7.82 18 2 12.18 2 5V3.5Z" />
    </svg>
  );
}

function PinIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path fillRule="evenodd" d="M10 18s6-5.33 6-10A6 6 0 0 0 4 8c0 4.67 6 10 6 10Zm0-7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" clipRule="evenodd" />
    </svg>
  );
}

export function CallButton({ location, className = '' }: { location: string; className?: string }) {
  const m = useMarket();
  if (!hasPhone(m)) return null;
  return (
    <a href={`tel:${m.phoneE164}`} onClick={() => track('call_click', { location })} className={className}>
      <PhoneIcon /> <span>{m.phoneDisplay}</span>
    </a>
  );
}

export function TextButton({ location, className = '' }: { location: string; className?: string }) {
  const m = useMarket();
  if (!hasPhone(m)) return null;
  return (
    <a href={`sms:${m.phoneE164}`} onClick={() => track('sms_click', { location })} className={className}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
        <path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v7a2.5 2.5 0 0 1-2.5 2.5H8l-3.6 2.7A.9.9 0 0 1 3 16v-2.3A2.5 2.5 0 0 1 3 11.5v-7Z" />
      </svg>
      <span>Text us</span>
    </a>
  );
}

/**
 * Location switcher. Uses plain links (full page loads) so each location page
 * arrives with its own server-rendered SEO tags and embedded data.
 */
export function LocationSwitcher({ className = '' }: { className?: string }) {
  const m = useMarket();
  const markets = allMarkets();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (markets.length < 2) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-slate-300 ${className}`}>
        <PinIcon className="h-3.5 w-3.5 text-fiber-400" /> {place(m)}
      </span>
    );
  }
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/5"
      >
        <PinIcon className="h-3.5 w-3.5 text-fiber-400" /> {place(m)}
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden>
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
        <span className="sr-only">— change location</span>
      </button>
      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-xl border border-white/10 bg-ink-900 p-1 shadow-2xl">
          {markets.map((x) => (
            <li key={x.slug}>
              <a
                href={marketPath(x.slug)}
                aria-current={x.slug === m.slug ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2.5 text-sm ${x.slug === m.slug ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
              >
                {x.name}, {x.state}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const NAV = [
  { href: '#plans', label: 'Plans' },
  { href: '#offer', label: 'Free consultation' },
  { href: '#compare', label: 'Why fiber' },
  { href: '#how', label: 'How it works' },
  { href: '#faq', label: 'FAQ' },
];

export function SiteHeader() {
  const m = useMarket();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const nav = m.plans.length ? NAV : NAV.filter((n) => n.href !== '#plans');

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
      <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <a href="#top" aria-label={`${BRAND.name} — back to top`}>
            <Logo />
          </a>
          <LocationSwitcher className="hidden sm:block" />
        </div>
        <div className="hidden items-center gap-6 text-sm text-slate-300 xl:flex">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="transition hover:text-white">
              {n.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <CallButton location="header" className="btn-ghost hidden px-3 py-2 text-sm md:inline-flex" />
          {hasPhone(m) && (
            <a
              href={`tel:${m.phoneE164}`}
              onClick={() => track('call_click', { location: 'header_mobile' })}
              className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 text-cyan-200 md:hidden"
              aria-label={`Call ${m.phoneDisplay}`}
            >
              <PhoneIcon className="h-5 w-5" />
            </a>
          )}
          <a href="#check" onClick={() => track('cta_click', { location: 'header' })} className="btn-primary hidden whitespace-nowrap px-4 py-2 text-sm sm:inline-flex">
            Check availability
          </a>
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 text-slate-200 xl:hidden"
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
        <div id="mobile-menu" className="border-t border-white/10 px-4 pb-5 pt-2 xl:hidden">
          <LocationSwitcher className="mb-1 sm:hidden" />
          <ul className="flex flex-col">
            {nav.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-3 text-base text-slate-200 hover:bg-white/5">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2">
            <a
              href="#check"
              onClick={() => {
                setOpen(false);
                track('cta_click', { location: 'mobile_menu' });
              }}
              className="btn-primary w-full"
            >
              Check availability
            </a>
            <CallButton location="mobile_menu" className="btn-ghost w-full" />
            <TextButton location="mobile_menu" className="btn-ghost w-full" />
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
  const m = useMarket();
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
        {hasPhone(m) && (
          <a href={`tel:${m.phoneE164}`} tabIndex={show ? 0 : -1} onClick={() => track('call_click', { location: 'sticky_bar' })} className="btn-ghost px-4" aria-label={`Call ${m.phoneDisplay}`}>
            <PhoneIcon className="h-5 w-5" />
          </a>
        )}
      </div>
    </div>
  );
}

export function SiteFooter() {
  const m = useMarket();
  const markets = allMarkets();
  return (
    <footer className="border-t border-white/10 px-4 pb-28 pt-12 text-sm text-slate-400 sm:px-6 md:pb-12">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xl">{partnerDisclosure(m)}</p>
          <p className="max-w-xl">{broadbandDisclosure(m)}</p>
          <p>
            © {YEAR} {BRAND.agency}. All rights reserved.
          </p>
        </div>
        <div className="space-y-6 md:justify-self-end">
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-2">
            <a href="#check" className="hover:text-white">Check availability</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
            <Link to="/privacy" className="hover:text-white">Privacy notice</Link>
            {m.broadbandLabelsUrl && (
              <a href={m.broadbandLabelsUrl} target="_blank" rel="noopener" onClick={() => track('outbound_click', { target: 'broadband_labels', location: 'footer' })} className="hover:text-white">
                Broadband Facts labels
              </a>
            )}
            <Link to="/admin" className="hover:text-white" rel="nofollow">Team login</Link>
            {hasPhone(m) && (
              <a href={`tel:${m.phoneE164}`} onClick={() => track('call_click', { location: 'footer' })} className="hover:text-white">
                {m.phoneDisplay}
              </a>
            )}
          </nav>
          {markets.length > 1 && (
            <nav aria-label="Locations">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-300">Locations</h2>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
                {markets.map((x) => (
                  <li key={x.slug}>
                    <a href={marketPath(x.slug)} className="hover:text-white">
                      {x.name}, {x.state}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>
    </footer>
  );
}
