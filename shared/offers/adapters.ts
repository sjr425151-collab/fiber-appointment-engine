/**
 * Provider adapter interface. Each data source (manual admin entry, an
 * authorized provider API, a partner feed) implements this; the application
 * only talks to the registry. Adapters must only use authorized access —
 * scraping behind logins or bypassing access controls is out of scope by policy.
 */
import { offerSchema, coverageEvidenceSchema, type CoverageEvidence, type Offer } from './model';

export interface AdapterContext {
  zip: string;
  marketId?: string;
  now: Date;
}

export interface ProviderAdapter {
  /** Stable id, e.g. "manual" or "omni-fiber-api". */
  readonly id: string;
  readonly providerIds: readonly string[];
  /** Whether this adapter can confirm address-level serviceability. */
  readonly capabilities: { offers: boolean; addressServiceability: boolean };
  fetchOffers(ctx: AdapterContext): Promise<Offer[]>;
  checkAddress?(address: { line1: string; zip: string }, ctx: AdapterContext): Promise<CoverageEvidence>;
}

export interface AdapterFailure {
  adapterId: string;
  error: string;
}

/** Offers backed by records maintained in the admin (and the Monroe seed). */
export class StaticOfferAdapter implements ProviderAdapter {
  readonly capabilities = { offers: true, addressServiceability: false };
  constructor(
    readonly id: string,
    private offers: Offer[],
  ) {}
  get providerIds() {
    return [...new Set(this.offers.map((o) => o.providerId))];
  }
  async fetchOffers(ctx: AdapterContext): Promise<Offer[]> {
    return this.offers.filter((o) => o.geography.zips?.includes(ctx.zip) || (!!ctx.marketId && o.geography.marketIds?.includes(ctx.marketId)));
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Fan out to every adapter with a timeout. One failing or slow adapter never
 * breaks the comparison: its error is reported and the rest still return.
 * Every offer is re-validated so a bad feed can't inject malformed data.
 */
export async function collectOffers(adapters: ProviderAdapter[], ctx: AdapterContext, timeoutMs = 4000): Promise<{ offers: Offer[]; failures: AdapterFailure[] }> {
  const settled = await Promise.allSettled(adapters.map((a) => withTimeout(a.fetchOffers(ctx), timeoutMs, a.id)));
  const offers: Offer[] = [];
  const failures: AdapterFailure[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      failures.push({ adapterId: adapters[i].id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      return;
    }
    for (const o of r.value) {
      const v = offerSchema.safeParse(o);
      if (v.success) offers.push(o);
      else failures.push({ adapterId: adapters[i].id, error: `Rejected invalid offer ${(o as { id?: string }).id ?? '?'}: ${v.error.issues[0]?.message}` });
    }
  });
  return { offers, failures };
}

export { coverageEvidenceSchema };
