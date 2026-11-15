import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LEAD_STATUSES, type Lead } from '../../../shared/schemas';
import { api, fmtDateTime, fmtPhone, STATUS_LABELS } from '../../lib/api';
import { Spinner, StatusBadge } from '../../components/ui';

interface Stats {
  byStatus: Record<string, number>;
  last24h: number;
  upcomingAppointments: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api<Stats>('/admin/stats').then(setStats);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      api<{ leads: Lead[]; total: number }>(`/admin/leads?${params}`).then((r) => {
        setLeads(r.leads);
        setTotal(r.total);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [status, q]);

  const totalLeads = stats ? Object.values(stats.byStatus).reduce((a, b) => a + b, 0) : 0;
  const tiles = stats
    ? [
        { label: 'Total leads', value: totalLeads },
        { label: 'New (last 24h)', value: stats.last24h },
        { label: 'Upcoming appointments', value: stats.upcomingAppointments },
        { label: 'Sold / installed', value: (stats.byStatus.sold ?? 0) + (stats.byStatus.install_scheduled ?? 0) + (stats.byStatus.installed ?? 0) },
      ]
    : [];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="glass p-5">
            <p className="text-sm text-slate-400">{t.label}</p>
            <p className="mt-1 font-display text-3xl font-bold">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="glass overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <h1 className="mr-auto font-display text-lg font-bold">
            Leads <span className="text-slate-500">({total})</span>
          </h1>
          <input className="input w-full py-2 sm:w-64" placeholder="Search name, phone, email, ZIP" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-auto py-2" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]} {stats?.byStatus[s] ? `(${stats.byStatus[s]})` : ''}
              </option>
            ))}
          </select>
          <a href="/api/admin/leads.csv" className="btn-ghost py-2 text-sm">
            Export CSV
          </a>
        </div>
        {leads === null ? (
          <div className="grid place-items-center py-16 text-slate-500">
            <Spinner />
          </div>
        ) : leads.length === 0 ? (
          <p className="py-16 text-center text-slate-500">No leads yet. Share the landing page to start collecting them.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {leads.map((l) => (
                  <tr key={l.id} className="transition hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/admin/leads/${l.id}`} className="hover:text-fiber-400">
                        {l.firstName} {l.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <div>{fmtPhone(l.phone)}</div>
                      <div className="text-xs text-slate-500">{l.email}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {l.street}
                      {l.unit && `, ${l.unit}`}
                      <div className="text-xs text-slate-500">
                        {l.city} {l.zip}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{l.utmCampaign || l.utmSource || l.source}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">{fmtDateTime(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
