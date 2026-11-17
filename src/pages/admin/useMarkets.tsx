import { useCallback, useEffect, useState } from 'react';
import type { Market } from '../../../shared/market';
import { api } from '../../lib/api';

export interface AdminMarkets {
  markets: Market[];
  leadCounts: Record<string, number>;
}

/** All locations (including inactive) for admin screens. Pass false for a representative, who cannot list locations. */
export function useAdminMarkets(enabled = true) {
  const [data, setData] = useState<AdminMarkets | null>(null);
  const reload = useCallback(() => api<AdminMarkets>('/admin/markets').then(setData), []);
  useEffect(() => {
    if (enabled) reload();
  }, [reload, enabled]);
  const bySlug = Object.fromEntries((data?.markets ?? []).map((m) => [m.slug, m]));
  return { data, reload, bySlug, setData };
}

/** Compact location <select> used to filter admin lists. Hidden when there's only one location. */
export function MarketFilter({ markets, value, onChange }: { markets: Market[]; value: string; onChange: (v: string) => void }) {
  if (markets.length < 2) return null;
  return (
    <select aria-label="Filter by location" className="input w-auto py-2" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All locations</option>
      {markets.map((m) => (
        <option key={m.slug} value={m.slug}>
          {m.name}, {m.state}
          {m.active ? '' : ' (inactive)'}
        </option>
      ))}
    </select>
  );
}
