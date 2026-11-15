import { useEffect, useState, type FormEvent } from 'react';
import { AREA_STATUSES, type AreaStatus } from '../../../shared/schemas';
import { api, ApiError, fmtDateTime } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { MarketFilter, useAdminMarkets } from './useMarkets';

interface Area {
  zip: string;
  city: string;
  status: AreaStatus;
  marketId: string;
  updatedAt: string;
}

const LABELS: Record<AreaStatus, string> = {
  available: 'Available (confirmed)',
  verify: 'In build area — verify address',
  coming_soon: 'Coming soon',
  not_serviceable: 'Not serviceable',
};

export default function ServiceAreas() {
  const { data, bySlug } = useAdminMarkets();
  const markets = data?.markets ?? [];
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ zip: '', city: '', status: 'coming_soon' as AreaStatus, marketId: '' });
  const [error, setError] = useState('');
  const formMarket = form.marketId || markets[0]?.slug || '';

  useEffect(() => {
    api<{ areas: Area[] }>('/admin/service-areas').then((r) => setAreas(r.areas));
  }, []);

  async function save(a: Omit<Area, 'updatedAt'>) {
    setError('');
    try {
      const r = await api<{ areas: Area[] }>('/admin/service-areas', { method: 'PUT', body: a });
      setAreas(r.areas);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fields)[0] ?? err.message) : 'Network error');
      return false;
    }
  }

  async function remove(zip: string) {
    if (!window.confirm(`Remove ZIP ${zip}? Visitors entering it will see the generic "we're checking your area" message.`)) return;
    const r = await api<{ areas: Area[] }>(`/admin/service-areas/${zip}`, { method: 'DELETE' });
    setAreas(r.areas);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await save({ ...form, marketId: formMarket })) setForm({ zip: '', city: '', status: 'coming_soon', marketId: form.marketId });
  }

  const shown = (areas ?? []).filter((a) => !filter || a.marketId === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Service areas</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            ZIP codes control what visitors see after checking a ZIP and which location’s calendar a lead books into. Only mark a ZIP{' '}
            <strong>Available</strong> once the provider has confirmed service there.
          </p>
        </div>
        <MarketFilter markets={markets} value={filter} onChange={setFilter} />
      </div>
      <form onSubmit={add} className="glass flex flex-wrap items-end gap-3 p-4">
        <input className="input w-28" placeholder="ZIP" aria-label="ZIP" maxLength={5} value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value.replace(/\D/g, '') })} />
        <input className="input w-48" placeholder="City" aria-label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        {markets.length > 1 && (
          <select className="input w-auto" aria-label="Location" value={formMarket} onChange={(e) => setForm({ ...form, marketId: e.target.value })}>
            {markets.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}, {m.state}
              </option>
            ))}
          </select>
        )}
        <select className="input w-auto" aria-label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AreaStatus })}>
          {AREA_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABELS[s]}
            </option>
          ))}
        </select>
        <button className="btn-primary">Add / update ZIP</button>
        {error && <p className="field-error w-full">{error}</p>}
      </form>
      {!areas ? (
        <Spinner />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">ZIP</th>
                <th className="px-4 py-3">City</th>
                {markets.length > 1 && <th className="px-4 py-3">Location</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {shown.map((a) => (
                <tr key={a.zip}>
                  <td className="px-4 py-3 font-mono">{a.zip}</td>
                  <td className="px-4 py-3">{a.city}</td>
                  {markets.length > 1 && (
                    <td className="px-4 py-3">
                      <select className="input w-auto py-1.5 text-sm" aria-label={`Location for ${a.zip}`} value={a.marketId} onChange={(e) => save({ ...a, marketId: e.target.value })}>
                        {markets.map((m) => (
                          <option key={m.slug} value={m.slug}>
                            {m.name}, {m.state}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <select className="input w-auto py-1.5 text-sm" aria-label={`Status for ${a.zip}`} value={a.status} onChange={(e) => save({ ...a, status: e.target.value as AreaStatus })}>
                      {AREA_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{fmtDateTime(a.updatedAt, bySlug[a.marketId]?.timezone)}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-xs text-slate-400 hover:text-rose-300" onClick={() => remove(a.zip)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
