import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Market, MarketSummary } from '../../shared/market';
import { api } from './api';

interface Boot {
  market: Market;
  markets: MarketSummary[];
  defaultSlug: string;
}

/** Location data the server embedded in the page (see server/html.ts). */
function readBoot(): Boot | null {
  try {
    const el = document.getElementById('boot-data');
    return el?.textContent ? (JSON.parse(el.textContent) as Boot) : null;
  } catch {
    return null;
  }
}

const boot = readBoot();
const cache = new Map<string, Market>(boot ? [[boot.market.slug, boot.market]] : []);
let currentSlug = boot?.market.slug ?? '';

/** The market slug used to tag analytics events. */
export const currentMarketSlug = () => currentSlug;
export const allMarkets = (): MarketSummary[] => boot?.markets ?? [];
export const defaultMarketSlug = () => boot?.defaultSlug ?? '';

type State = { status: 'ready'; market: Market } | { status: 'loading' } | { status: 'notfound' };

/**
 * Resolve the market for a URL slug (undefined = default market). Uses the
 * embedded data when it matches — the normal case — and fetches otherwise
 * (client-side navigation, or `npm run dev`).
 */
export function useMarketState(slug?: string): State {
  const wanted = slug || boot?.defaultSlug || '';
  const cached = wanted ? cache.get(wanted) : boot?.market;
  const [fetched, setFetched] = useState<{ slug: string; state: State } | null>(null);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    api<{ market: Market }>(`/markets/${encodeURIComponent(wanted || 'default')}`)
      .then(({ market }) => {
        cache.set(market.slug, market);
        if (!cancelled) setFetched({ slug: wanted, state: { status: 'ready', market } });
      })
      .catch(() => !cancelled && setFetched({ slug: wanted, state: { status: 'notfound' } }));
    return () => {
      cancelled = true;
    };
  }, [wanted, cached]);

  const state: State = cached ? { status: 'ready', market: cached } : fetched?.slug === wanted ? fetched.state : { status: 'loading' };
  return state;
}

const MarketContext = createContext<Market | null>(null);

export function MarketProvider({ market, children }: { market: Market; children: ReactNode }) {
  // Layout effects run before children's passive effects, so the first analytics
  // event (page_view) is already tagged with this market.
  useLayoutEffect(() => {
    currentSlug = market.slug;
  }, [market.slug]);
  return <MarketContext.Provider value={market}>{children}</MarketContext.Provider>;
}

export function useMarket(): Market {
  const m = useContext(MarketContext);
  if (!m) throw new Error('useMarket must be used inside <MarketProvider>');
  return m;
}

export const hasPhone = (m: Market) => Boolean(m.phoneDisplay && m.phoneE164);

/** Public URL path for a market: the default market lives at "/". */
export const marketPath = (slug: string) => (slug === defaultMarketSlug() ? '/' : `/${slug}`);
