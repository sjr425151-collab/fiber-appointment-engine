/**
 * Offer catalog for the household analysis.
 *
 * REAL offers come from the provider intelligence model (today: Omni Fiber in
 * Monroe, manually verified). SAMPLE offers exist only to exercise the product
 * on staging; they are labelled "Sample data" everywhere, use provenance
 * sourceType "sample" (so `publicStatus` can only ever say "sample"), and are
 * returned only when the caller passes `includeSamples` — which the server
 * does only when SAMPLE_DATA_ENABLED is on (refused in production).
 */
import type { Offer } from '../offers/model';
import { MONROE_OFFERS } from '../offers/seed';
import type { PlatformCategory } from './assessment';

export const CATALOG_VERSION = '2026-11-16.1';

const SAMPLE_PROVENANCE = {
  sourceType: 'sample' as const,
  reference: 'Illustrative sample created for staging — not a real offer',
  recordedBy: 'platform team',
  verifiedAt: '2026-11-16T00:00:00Z',
  review: 'estimated' as const,
  gaps: ['Not a real offer'],
};

const sample = (o: Omit<Offer, 'provenance' | 'geography'>): Offer => ({
  ...o,
  geography: { zips: [], marketIds: [], nationwide: true },
  provenance: SAMPLE_PROVENANCE,
});

const SAMPLE_INTERNET: Offer[] = [
  sample({
    id: 'sample-cable-300',
    providerId: 'sample-cable-co',
    category: 'internet',
    planName: 'Sample Cable 300',
    attributes: { downloadMbps: 300, uploadMbps: 20, technology: 'cable', dataCapGb: 1200 },
    pricing: { baseMonthly: 8000, promotion: { monthlyRate: 5500, months: 12 }, recurring: [{ label: 'Modem rental', monthly: 1500 }], quality: 'estimated' },
    contractMonths: 0,
    restrictions: ['Illustrative only'],
  }),
  sample({
    id: 'sample-5g-home',
    providerId: 'sample-wireless-co',
    category: 'internet',
    planName: 'Sample 5G Home',
    attributes: { downloadMbps: 245, uploadMbps: 30, technology: '5g_home', dataCapGb: null },
    pricing: { baseMonthly: 5000, priceLockMonths: 36, quality: 'estimated' },
    contractMonths: 0,
    restrictions: ['Illustrative only', 'Speeds vary by location'],
  }),
  sample({
    id: 'sample-fiber-1g',
    providerId: 'sample-fiber-co',
    category: 'internet',
    planName: 'Sample Fiber 1 Gig',
    attributes: { downloadMbps: 1000, uploadMbps: 1000, technology: 'fiber', dataCapGb: null },
    pricing: { baseMonthly: 7000, oneTime: [{ kind: 'installation', label: 'Installation', amount: 9900, month: 0 }], quality: 'estimated' },
    contractMonths: 0,
    restrictions: ['Illustrative only'],
  }),
];

/** Sample mobile plans priced per line (total monthly price by number of lines). */
const SAMPLE_MOBILE: { id: string; planName: string; byLines: number[]; data: 'unlimited' | 'moderate'; international: boolean }[] = [
  { id: 'sample-mvno-15gb', planName: 'Sample Value 15 GB', byLines: [2500, 4500, 6000, 7500, 9000], data: 'moderate', international: false },
  { id: 'sample-unlimited', planName: 'Sample Unlimited', byLines: [6500, 11000, 14000, 16000, 19000], data: 'unlimited', international: true },
];

const SAMPLE_TV: Offer[] = [
  sample({
    id: 'sample-live-tv',
    providerId: 'sample-streaming-co',
    category: 'tv',
    planName: 'Sample Live TV Streaming',
    attributes: {},
    pricing: { baseMonthly: 8299, quality: 'estimated' },
    contractMonths: 0,
    restrictions: ['Illustrative only', 'Includes local channels in most areas'],
  }),
  sample({
    id: 'sample-skinny-tv',
    providerId: 'sample-streaming-co',
    category: 'tv',
    planName: 'Sample Basic Streaming Bundle',
    attributes: {},
    pricing: { baseMonthly: 4500, quality: 'estimated' },
    contractMonths: 0,
    restrictions: ['Illustrative only', 'No sports networks'],
  }),
];

export interface CatalogContext {
  zip: string;
  mobileLines?: number;
  mobileDataNeed?: 'light' | 'moderate' | 'heavy' | 'unlimited';
  mobileInternational?: boolean;
  includeSamples: boolean;
}

/** Real offers that may apply to this ZIP, plus (optionally) labelled samples. */
export function offersFor(category: PlatformCategory, ctx: CatalogContext): { real: Offer[]; samples: Offer[] } {
  const real = category === 'internet' ? MONROE_OFFERS.filter((o) => o.geography.zips?.includes(ctx.zip)) : [];
  if (!ctx.includeSamples) return { real, samples: [] };
  if (category === 'internet') return { real, samples: SAMPLE_INTERNET };
  if (category === 'tv') return { real, samples: SAMPLE_TV };
  if (category === 'mobile') {
    const lines = Math.min(Math.max(ctx.mobileLines ?? 1, 1), 5);
    return {
      real,
      // Only plans that fit the household's stated needs.
      samples: SAMPLE_MOBILE.filter(
        (m) => (m.data === 'unlimited' || ['light', 'moderate'].includes(ctx.mobileDataNeed ?? 'unlimited')) && (m.international || !ctx.mobileInternational),
      ).map((m) =>
        sample({
          id: m.id,
          providerId: 'sample-carrier',
          category: 'mobile',
          planName: `${m.planName} (${lines} ${lines === 1 ? 'line' : 'lines'})`,
          attributes: {},
          pricing: { baseMonthly: m.byLines[lines - 1], quality: 'estimated' },
          contractMonths: 0,
          restrictions: ['Illustrative only', m.international ? 'Includes international texting' : 'Domestic only'],
        }),
      ),
    };
  }
  // Electricity & solar: no comparisons until legal review (risk register C4/C5).
  return { real, samples: [] };
}
