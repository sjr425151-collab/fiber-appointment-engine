import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { LEAD_STATUSES, type Lead, type Representative } from '../../../shared/schemas';
import { api, fmtDateTime, fmtPhone, STATUS_LABELS } from '../../lib/api';
import { Spinner, StatusBadge } from '../../components/ui';
import { useTeam } from './Layout';
import { MarketFilter, useAdminMarkets } from './useMarkets';

interface Conversions {
  days: number;
  funnel: Record<string, { events: number; sessions: number }>;
  sources: { source: string; leads: number; qualified: number }[];
}

const FUNNEL: [string, string][] = [
  ['page_view', 'Visits'],
  ['zip_check', 'ZIP checks'],
  ['form_start', 'Form starts'],
  ['lead_submit', 'Leads'],
  ['appointment_booked', 'Appointments'],
  ['call_click', 'Call clicks'],
];

function ConversionPanel({ market }: { market: string }) {
  const [c, setC] = useState<Conversions | null>(null);
  useEffect(() => {
    api<Conversions>(`/admin/conversions${market ? `?market=${market}` : ''}`).then(setC);
  }, [market]);
  if (!c) return null;
  // Visit-based steps count unique sessions; server-recorded conversions count events.
  const value = (k: string) => (k === 'lead_submit' || k === 'appointment_booked' ? c.funnel[k]?.events : c.funnel[k]?.sessions) ?? 0;
  const visits = value('page_view');
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="glass p-5">
        <h2 className="font-semibold">Conversion funnel <span className="text-sm font-normal text-slate-400">· last {c.days} days</span></h2>
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FUNNEL.map(([k, label]) => {
            const v = value(k);
            return (
              <li key={k} className="rounded-xl bg-white/[0.03] p-3">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-1 font-display text-2xl font-bold">{v}</p>
                {k !== 'page_view' && visits > 0 && <p className="text-xs text-cyan-300">{((v / visits) * 100).toFixed(1)}% of visits</p>}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="glass p-5">
        <h2 className="font-semibold">Top lead sources</h2>
        {c.sources.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No leads yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {c.sources.map((s) => (
              <li key={s.source} className="flex justify-between gap-3">
                <span className="truncate text-slate-200">{s.source}</span>
                <span className="shrink-0 text-slate-400">
                  {s.leads} leads · {s.qualified} booked+
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface HandoffFunnel {
  days: number;
  events: Record<string, { events: number; sessions: number }>;
  leads: { total: number; assigned: number; queued: number; unsupported: number; contacted: number; appointments: number; qualified: number; converted: number; avgMinutesToFirstContact: number | null };
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : '—');

/** Pricing-review requests: from seeing a preview to a confirmed outcome. Counts come from this site only. */
function HandoffPanel() {
  const [f, setF] = useState<HandoffFunnel | null>(null);
  useEffect(() => {
    api<HandoffFunnel>('/admin/handoff-funnel').then(setF);
  }, []);
  if (!f) return null;
  const previews = f.events.preview_view?.sessions ?? 0;
  const clicks = f.events.handoff_cta_click?.sessions ?? 0;
  const l = f.leads;
  const wait = l.avgMinutesToFirstContact;
  const steps: [string, number, string][] = [
    ['Previews seen', previews, ''],
    ['Tapped “Get My Exact Pricing”', clicks, `${pct(clicks, previews)} of previews`],
    ['Requests saved', l.total, `${pct(l.total, clicks)} of taps`],
    ['Assigned', l.assigned, `${pct(l.assigned, l.total)} of requests`],
    ['Contacted', l.contacted, `${pct(l.contacted, l.total)} of requests`],
    ['Appointments', l.appointments, `${pct(l.appointments, l.total)} of requests`],
    ['Qualified', l.qualified, `${pct(l.qualified, l.total)} of requests`],
    ['Converted', l.converted, `${pct(l.converted, l.total)} of requests`],
  ];
  return (
    <div className="glass p-5">
      <h2 className="font-semibold">
        Pricing-review requests <span className="text-sm font-normal text-slate-400">· last {f.days} days</span>
      </h2>
      <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {steps.map(([label, v, sub]) => (
          <li key={label} className="rounded-xl bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{v}</p>
            {sub && <p className="text-xs text-cyan-300">{sub}</p>}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-slate-400">
        Waiting in the queue: {l.queued} · ZIP needs review: {l.unsupported} · Average time to first confirmed contact:{' '}
        {wait === null ? 'no contacts recorded yet' : wait < 90 ? `${wait} min` : `${(wait / 60).toFixed(1)} h`}. Contacted, qualified and converted count only what a person recorded on the lead.
      </p>
    </div>
  );
}

interface Stats {
  byStatus: Record<string, number>;
  last24h: number;
  upcomingAppointments: number;
}

function Dashboard({ view }: { view: 'overview' | 'leads' }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [market, setMarket] = useState('');
  const [assigned, setAssigned] = useState('');
  const [reps, setReps] = useState<Representative[]>([]);
  const team = useTeam();
  const isRep = team.role === 'rep';
  const overview = view === 'overview' && !isRep;
  const { data: md, bySlug } = useAdminMarkets(!isRep);
  const markets = md?.markets ?? [];
  const multi = markets.length > 1;
  const repName = (id: string | null) => (id ? (isRep ? team.rep?.name : reps.find((r) => r.id === id)?.name) ?? 'Former representative' : null);

  useEffect(() => {
    if (isRep) return;
    api<Stats>('/admin/stats').then(setStats);
    api<{ representatives: Representative[] }>('/admin/reps').then((r) => setReps(r.representatives));
  }, [isRep]);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      if (market) params.set('market', market);
      if (assigned) params.set('assigned', assigned);
      api<{ leads: Lead[]; total: number }>(`/admin/leads?${params}`).then((r) => {
        setLeads(r.leads);
        setTotal(r.total);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [status, q, market, assigned]);

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
      {overview && <h1 className="font-display text-2xl font-bold">Overview</h1>}
      <div className={overview ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4' : 'hidden'}>
        {tiles.map((t) => (
          <div key={t.label} className="glass p-5">
            <p className="text-sm text-slate-400">{t.label}</p>
            <p className="mt-1 font-display text-3xl font-bold">{t.value}</p>
          </div>
        ))}
      </div>

      {multi && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">Showing</span>
          <MarketFilter markets={markets} value={market} onChange={setMarket} />
        </div>
      )}
      {overview && <HandoffPanel />}
      {overview && <ConversionPanel market={market} />}

      <div className={overview ? 'hidden' : 'glass overflow-hidden'}>
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <h1 className="mr-auto font-display text-lg font-bold">
            {isRep ? 'My leads' : 'Leads'} <span className="text-slate-500">({total})</span>
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
          {!isRep && (
            <select className="input w-auto py-2" aria-label="Assigned to" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned (follow-up queue)</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          {!isRep && (
            <a href={`/api/admin/leads.csv${market ? `?market=${market}` : ''}`} className="btn-ghost py-2 text-sm">
              Export CSV
            </a>
          )}
        </div>
        {leads === null ? (
          <div className="grid place-items-center py-16 text-slate-500">
            <Spinner />
          </div>
        ) : leads.length === 0 ? (
          <p className="py-16 text-center text-slate-500">{isRep ? 'No leads are assigned to you right now.' : assigned === 'unassigned' ? 'The follow-up queue is empty.' : 'No leads match.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Address</th>
                  {multi && <th className="px-4 py-3">Location</th>}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned to</th>
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
                    {multi && <td className="px-4 py-3 text-slate-300">{bySlug[l.marketId]?.name ?? l.marketId}</td>}
                    <td className="px-4 py-3">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-300">{repName(l.assignedRepId) ?? <span className="text-amber-300">{l.routingOutcome === 'unsupported' ? 'ZIP needs review' : 'Unassigned'}</span>}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{[l.utmSource || l.source, l.utmCampaign].filter(Boolean).join(' / ')}</td>
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

/** Admin → Overview: totals and funnels. A representative has no overview and goes straight to their leads. */
export default function Overview() {
  const team = useTeam();
  return team.role === 'rep' ? <Navigate to="/admin/leads" replace /> : <Dashboard view="overview" />;
}
export function Leads() {
  return <Dashboard view="leads" />;
}
