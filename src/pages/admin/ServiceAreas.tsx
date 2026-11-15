import { useEffect, useState, type FormEvent } from 'react';
import { AREA_STATUSES, type AreaStatus } from '../../../shared/schemas';
import { api, ApiError, fmtDateTime } from '../../lib/api';
import { Spinner } from '../../components/ui';

interface Area {
  zip: string;
  city: string;
  status: AreaStatus;
  updatedAt: string;
}

const LABELS: Record<AreaStatus, string> = {
  available: 'Available (confirmed)',
  verify: 'In build area — verify address',
  coming_soon: 'Coming soon',
  not_serviceable: 'Not serviceable',
};

export default function ServiceAreas() {
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [form, setForm] = useState({ zip: '', city: '', status: 'coming_soon' as AreaStatus });
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ areas: Area[] }>('/admin/service-areas').then((r) => setAreas(r.areas));
  }, []);

  async function save(a: { zip: string; city: string; status: AreaStatus }) {
    setError('');
    try {
      const r = await api<{ areas: Area[] }>('/admin/service-areas', { method: 'PUT', body: a });
      setAreas(r.areas);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.fields)[0] ?? err.message : 'Network error');
      return false;
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await save(form)) setForm({ zip: '', city: '', status: 'coming_soon' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Service areas</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Controls what visitors see when they check a ZIP. Only mark a ZIP <strong>Available</strong> once Omni Fiber has confirmed service there.
        </p>
      </div>
      <form onSubmit={add} className="glass flex flex-wrap items-end gap-3 p-4">
        <input className="input w-28" placeholder="ZIP" maxLength={5} value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value.replace(/\D/g, '') })} />
        <input className="input w-48" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <select className="input w-auto" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AreaStatus })}>
          {AREA_STATUSES.map((s) => (
            <option key={s} value={s}>{LABELS[s]}</option>
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
            <thead className="text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">ZIP</th>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {areas.map((a) => (
                <tr key={a.zip}>
                  <td className="px-4 py-3 font-mono">{a.zip}</td>
                  <td className="px-4 py-3">{a.city}</td>
                  <td className="px-4 py-3">
                    <select className="input w-auto py-1.5 text-sm" value={a.status} onChange={(e) => save({ ...a, status: e.target.value as AreaStatus })}>
                      {AREA_STATUSES.map((s) => (
                        <option key={s} value={s}>{LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{fmtDateTime(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
