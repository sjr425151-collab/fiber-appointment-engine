import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Appointment } from '../../../shared/schemas';
import { api, fmtDate, fmtDateTime, fmtPhone, tzLabel } from '../../lib/api';
import { MarketFilter, useAdminMarkets } from './useMarkets';
import { Spinner } from '../../components/ui';

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'text-fiber-400',
  completed: 'text-emerald-400',
  no_show: 'text-amber-400',
  cancelled: 'text-slate-500 line-through',
};

export default function Appointments() {
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [market, setMarket] = useState('');
  const { data: md, bySlug } = useAdminMarkets();
  const markets = md?.markets ?? [];
  const tzOf = (a: Appointment) => bySlug[a.marketId]?.timezone ?? 'America/Detroit';

  useEffect(() => {
    api<{ appointments: Appointment[] }>(`/admin/appointments${market ? `?market=${market}` : ''}`).then((r) => setAppts(r.appointments));
  }, [market]);

  async function setStatus(id: string, status: Appointment['status']) {
    const r = await api<{ appointment: Appointment }>(`/admin/appointments/${id}`, { method: 'PATCH', body: { status } });
    setAppts((list) => list?.map((a) => (a.id === id ? r.appointment : a)) ?? null);
  }

  // Group by local day (each appointment in its own location's timezone).
  const groups = new Map<string, Appointment[]>();
  for (const a of appts ?? []) {
    if (!showAll && a.status === 'cancelled') continue;
    const k = fmtDate(a.startUtc, { weekday: 'long', month: 'long', day: 'numeric' }, tzOf(a));
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const byDay = [...groups.entries()];

  if (!appts) {
    return (
      <div className="grid place-items-center py-20 text-slate-500">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold">Appointments</h1>
        <MarketFilter markets={markets} value={market} onChange={setMarket} />
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" className="accent-cyan-400" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show cancelled
        </label>
      </div>
      {byDay.length === 0 && <p className="glass py-16 text-center text-slate-500">No appointments in the past week or upcoming.</p>}
      {byDay.map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">{day}</h2>
          <div className="glass divide-y divide-white/5">
            {list.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                <span className="w-28 font-display font-semibold">
                  {fmtDateTime(a.startUtc, tzOf(a)).split(', ').pop()} <span className="text-xs font-normal text-slate-400">{tzLabel(tzOf(a), new Date(a.startUtc))}</span>
                  {markets.length > 1 && <span className="block text-xs font-normal text-cyan-300">{bySlug[a.marketId]?.name}</span>}
                </span>
                <div className="min-w-48 flex-1">
                  <Link to={`/admin/leads/${a.leadId}`} className="font-medium hover:text-fiber-400">
                    {a.leadName}
                  </Link>
                  <p className="text-xs text-slate-400">
                    {fmtPhone(a.leadPhone ?? '')} · {a.leadAddress}
                  </p>
                  {a.notes && <p className="mt-1 text-xs italic text-slate-400">“{a.notes}”</p>}
                </div>
                <span className={`text-sm capitalize ${STATUS_STYLE[a.status]}`}>{a.status.replace('_', ' ')}</span>
                {a.status === 'scheduled' && (
                  <div className="flex gap-2">
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setStatus(a.id, 'completed')}>
                      Completed
                    </button>
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setStatus(a.id, 'no_show')}>
                      No-show
                    </button>
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setStatus(a.id, 'cancelled')}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
