/** The representative's start page: what to do next, follow-ups due, and numbers that come from stored data. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { NEXT_ACTION_LABEL, type NextActionRule } from '../../../shared/team/workspace';
import { api } from '../../lib/api';
import { useTeam } from './Layout';
import { RefreshButton, useRefresh } from './useRefresh';
import { ago, errorText, isPast, myTz, Pill, recentLeads, when } from './work/common';
import type { WorkTask } from './work/types';

interface Overview {
  role: string;
  kpis: Record<string, number | null>;
  cohort: { assigned: number; contacted: number; qualified: number; won: number };
  definitions: Record<string, { label: string; definition: string }>;
  days: number;
  today: string;
  nextActions: { rule: NextActionRule; leadId: string; leadName: string; at: string | null; taskId?: string; detail: string }[];
  tasks: { overdue: WorkTask[]; today: WorkTask[] };
  notifications: { items: { id: string; kind: string; title: string; leadId: string | null; readAt: string | null; createdAt: string }[]; unread: number };
}
const TILES: { key: string; tone?: 'rose' | 'emerald'; pct?: boolean }[] = [
  { key: 'assigned' },
  { key: 'newToday' },
  { key: 'followUpsDue' },
  { key: 'overdue', tone: 'rose' },
  { key: 'contacted' },
  { key: 'interested' },
  { key: 'qualified' },
  { key: 'consultations' },
  { key: 'won', tone: 'emerald' },
  { key: 'leadToContact', pct: true },
  { key: 'contactToQualified', pct: true },
  { key: 'qualifiedToWon', pct: true },
];

export default function WorkOverview() {
  const team = useTeam();
  const [d, setD] = useState<Overview | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');
  const { tick, updatedAt, refresh } = useRefresh();
  const loaded = useRef(false);
  useEffect(() => {
    api<Overview>(`/admin/work/overview?tz=${encodeURIComponent(myTz())}&days=${days}`)
      .then((r) => {
        loaded.current = true;
        setD(r);
        setError('');
      })
      // Only the first load shows an error; a failed background refresh keeps the numbers on screen.
      .catch((err) => {
        if (!loaded.current) setError(errorText(err, 'The overview didn’t load. Check your connection and try again.'));
      });
  }, [days, tick]);
  const recent = recentLeads();
  const scope = team.workRole === 'rep' ? 'your' : 'all';

  if (error)
    return (
      <p className="glass p-6 text-center" role="alert">
        {error}
      </p>
    );
  if (!d) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading overview">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />
        ))}
      </div>
    );
  }
  const first = d.nextActions[0];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{team.rep ? `Hi, ${team.rep.name.split(' ')[0]}` : 'Workspace'}</h1>
          <p className="text-sm text-slate-400">
            Showing {scope} leads. Times in {myTz()}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton updatedAt={updatedAt} onRefresh={refresh} />
          {first && (
            <Link to={`/admin/leads/${first.leadId}`} className="btn-primary py-2 text-sm">
              Open next lead
            </Link>
          )}
          <Link to="/admin/follow-ups" className="btn-ghost py-2 text-sm">
            Follow-ups
          </Link>
          <Link to="/admin/leads" className="btn-ghost py-2 text-sm">
            {team.workRole === 'rep' ? 'My leads' : 'All leads'}
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="glass p-5" aria-labelledby="next-h">
          <h2 id="next-h" className="font-semibold">
            Your next best actions
          </h2>
          <p className="mb-3 text-xs text-slate-400">
            In this order: overdue follow-ups, follow-ups due within two hours, new leads with nothing recorded, serviceability checks, qualified leads with no next step. Oldest first.
          </p>
          <ol className="space-y-2">
            {d.nextActions.map((a, i) => (
              <li key={`${a.rule}-${a.leadId}`}>
                <Link to={`/admin/leads/${a.leadId}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 p-3 hover:border-white/30">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold">{i + 1}</span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate font-medium text-white">{a.leadName || 'Lead'}</span>
                    <span className="block truncate text-xs text-slate-400">
                      {a.detail}
                      {a.at ? ` · ${a.rule.includes('task') ? when(a.at) : ago(a.at)}` : ''}
                    </span>
                  </span>
                  <Pill tone={a.rule === 'overdue_task' ? 'rose' : a.rule === 'new_lead' ? 'violet' : 'sky'}>{NEXT_ACTION_LABEL[a.rule]}</Pill>
                </Link>
              </li>
            ))}
            {d.nextActions.length === 0 && <li className="text-sm text-slate-400">You’re all caught up. New leads and due follow-ups will appear here.</li>}
          </ol>
        </section>

        <div className="space-y-5">
          <section className="glass p-5" aria-labelledby="due-h">
            <h2 id="due-h" className="mb-3 font-semibold">
              Follow-ups due
            </h2>
            <ul className="space-y-2 text-sm">
              {[...d.tasks.overdue, ...d.tasks.today].slice(0, 8).map((t) => (
                <li key={t.id}>
                  <Link to={`/admin/leads/${t.leadId}`} className="flex justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <span className="truncate">
                      {t.title} · {t.leadName}
                    </span>
                    <span className={isPast(t.dueAt) ? 'shrink-0 text-rose-300' : 'shrink-0 text-slate-400'}>{when(t.dueAt, { hour: 'numeric', minute: '2-digit' })}</span>
                  </Link>
                </li>
              ))}
              {d.tasks.overdue.length + d.tasks.today.length === 0 && <li className="text-slate-400">Nothing due today.</li>}
            </ul>
          </section>
          {d.notifications.items.length > 0 && (
            <section className="glass p-5" aria-labelledby="notif-h">
              <h2 id="notif-h" className="mb-3 font-semibold">
                Notifications {d.notifications.unread > 0 && <Pill tone="sky">{d.notifications.unread} new</Pill>}
              </h2>
              <ul className="space-y-1.5 text-sm">
                {d.notifications.items.slice(0, 5).map((n) => (
                  <li key={n.id}>
                    {n.leadId ? (
                      <Link to={`/admin/leads/${n.leadId}`} className={`hover:underline ${n.readAt ? 'text-slate-400' : 'text-white'}`}>
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}{' '}
                    <span className="text-xs text-slate-400">{ago(n.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {recent.length > 0 && (
            <section className="glass p-5" aria-labelledby="recent-h">
              <h2 id="recent-h" className="mb-3 font-semibold">
                Recently viewed
              </h2>
              <ul className="space-y-1.5 text-sm">
                {recent.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link to={`/admin/leads/${r.id}`} className="hover:underline">
                      {r.name || 'Lead'}
                    </Link>{' '}
                    <span className="text-xs text-slate-400">{ago(r.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <section aria-labelledby="kpi-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="kpi-h" className="font-semibold">
            {team.workRole === 'rep' ? 'My performance' : 'Team performance'}
          </h2>
          <label className="text-sm text-slate-400">
            Period{' '}
            <select className="input inline-block w-auto py-1.5" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TILES.map((t) => {
            const v = d.kpis[t.key];
            const def = d.definitions[t.key];
            return (
              <div key={t.key} className="glass p-4">
                <p className="text-xs text-slate-400">{def.label}</p>
                <p className={`mt-1 font-display text-2xl font-bold ${t.tone === 'rose' && v ? 'text-rose-300' : t.tone === 'emerald' && v ? 'text-emerald-300' : ''}`}>{v === null ? '—' : t.pct ? `${v}%` : v}</p>
                <details className="mt-1 text-xs text-slate-400">
                  <summary className="cursor-pointer">How it’s counted</summary>
                  <p className="mt-1">{def.definition}</p>
                </details>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Conversion uses leads assigned in the period ({d.cohort.assigned}): {d.cohort.contacted} contacted, {d.cohort.qualified} qualified, {d.cohort.won} verified wins. Positive conversations are never counted as
          sales.
        </p>
      </section>
    </div>
  );
}
