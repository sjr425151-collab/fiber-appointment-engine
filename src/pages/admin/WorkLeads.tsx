/**
 * Lead queues: search, filter, sort and page through leads on the server;
 * managers and admins can also reassign several at once.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Lead } from '../../../shared/schemas';
import { DISPOSITION_LABEL, DISPOSITIONS, QUALIFICATION_LABEL, QUALIFICATIONS, QUEUES } from '../../../shared/team/workspace';
import { api, fmtPhone, STATUS_LABELS } from '../../lib/api';
import { StatusBadge } from '../../components/ui';
import { useTeam } from './Layout';
import { ago, DispositionPill, errorText, isPast, myTz, OutcomePill, QualificationPill, rememberQueue, useToast, when } from './work/common';

type Row = Lead & { ownerName: string | null };
const PAGE = 50;
const SAVED = 'tucker-leads-view';

export default function WorkLeads() {
  const team = useTeam();
  const manager = team.workRole !== 'rep';
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { toast, toastNode } = useToast();
  // Filters live in the address (shareable, survive back/forward) and the last view is remembered on this device.
  useEffect(() => {
    if ([...params.keys()].length) return;
    try {
      const saved = localStorage.getItem(SAVED);
      if (saved) setParams(new URLSearchParams(saved), { replace: true });
    } catch {
      /* nothing saved */
    }
  }, [params, setParams]);
  const get = (k: string) => params.get(k) ?? '';
  const queue = get('queue') || 'mine';
  const page = Number(get('page') || '0');
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    setParams(p, { replace: true });
    try {
      localStorage.setItem(SAVED, p.toString());
    } catch {
      /* not saved */
    }
  };
  const [q, setQ] = useState(get('q'));
  useEffect(() => {
    const t = setTimeout(() => q !== get('q') && set('q', q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const [data, setData] = useState<{ leads: Row[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [reps, setReps] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [bulkTo, setBulkTo] = useState('');
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (queue !== 'mine') p.set('queue', queue);
    for (const k of ['q', 'sort', 'stage', 'disposition', 'qualification', 'owner']) if (get(k)) p.set(k, get(k));
    p.set('limit', String(PAGE));
    p.set('offset', String(page * PAGE));
    p.set('tz', myTz());
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const load = () =>
    api<{ leads: Row[]; total: number }>(`/admin/work/leads?${query}`)
      .then((r) => {
        setData(r);
        setError('');
        rememberQueue(
          r.leads.map((l) => l.id),
          QUEUES.find((x) => x.id === queue)?.label ?? 'Leads',
        );
      })
      .catch((err) => setError(errorText(err, 'Leads didn’t load. Check your connection and try again.')));
  useEffect(() => {
    setData(null);
    setSelected([]);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    if (manager)
      api<{ representatives: { id: string; name: string; active: boolean }[] }>('/admin/reps')
        .then((r) => setReps(r.representatives.filter((x) => x.active)))
        .catch(() => setReps([]));
  }, [manager]);

  async function bulkAssign() {
    if (!selected.length) return;
    const to = bulkTo === 'queue' ? null : bulkTo;
    if (!window.confirm(`Assign ${selected.length} lead${selected.length === 1 ? '' : 's'} to ${to ? reps.find((r) => r.id === to)?.name : 'the follow-up queue'}?`)) return;
    try {
      const r = await api<{ ok: number; failed: number }>('/admin/work/bulk-assign', { method: 'POST', body: { leadIds: selected, repId: to } });
      toast(r.failed ? `${r.ok} assigned, ${r.failed} failed` : `${r.ok} assigned`, r.failed ? 'error' : 'ok');
      void load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  const queues = QUEUES.filter((x) => manager || !x.managers);
  const pages = data ? Math.ceil(data.total / PAGE) : 0;
  return (
    <div className="space-y-4">
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">
          {manager ? 'Leads' : 'My leads'} {data && <span className="text-base font-normal text-slate-400">({data.total})</span>}
        </h1>
        {team.role === 'admin' && (
          <a href="/api/admin/leads.csv" className="btn-ghost py-2 text-sm">
            Export CSV
          </a>
        )}
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Queues">
        {queues.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={queue === x.id}
            onClick={() => set('queue', x.id === 'mine' ? '' : x.id)}
            className={`min-h-10 shrink-0 rounded-full px-3.5 text-sm ${queue === x.id ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {x.id === 'mine' && manager ? 'All leads' : x.label}
          </button>
        ))}
      </div>

      <div className="glass grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <label className="sr-only" htmlFor="lead-q">
          Search
        </label>
        <input id="lead-q" className="input py-2" placeholder="Search name, phone, email or lead ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Stage" className="input py-2" value={get('stage')} onChange={(e) => set('stage', e.target.value)}>
          <option value="">Any stage</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Disposition" className="input py-2" value={get('disposition')} onChange={(e) => set('disposition', e.target.value)}>
          <option value="">Any disposition</option>
          {DISPOSITIONS.map((k) => (
            <option key={k} value={k}>
              {DISPOSITION_LABEL[k]}
            </option>
          ))}
        </select>
        <select aria-label="Qualification" className="input py-2" value={get('qualification')} onChange={(e) => set('qualification', e.target.value)}>
          <option value="">Any qualification</option>
          {QUALIFICATIONS.map((k) => (
            <option key={k} value={k}>
              {QUALIFICATION_LABEL[k]}
            </option>
          ))}
        </select>
        <select aria-label="Sort" className="input py-2" value={get('sort')} onChange={(e) => set('sort', e.target.value)}>
          <option value="">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="activity">Recent activity</option>
          <option value="followup">Next follow-up</option>
        </select>
        {manager && (
          <select aria-label="Owner" className="input py-2 lg:col-start-1" value={get('owner')} onChange={(e) => set('owner', e.target.value)}>
            <option value="">Any owner</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {manager && selected.length > 0 && (
        <div className="glass flex flex-wrap items-center gap-2 p-3 text-sm" role="region" aria-label="Bulk actions">
          <span>{selected.length} selected</span>
          <label className="sr-only" htmlFor="bulk-to">
            Assign to
          </label>
          <select id="bulk-to" className="input w-auto py-2" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
            <option value="">Assign to…</option>
            <option value="queue">Follow-up queue (unassigned)</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn-primary py-2 text-sm" disabled={!bulkTo} onClick={bulkAssign}>
            Apply
          </button>
          <button className="btn-ghost py-2 text-sm" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}

      {error ? (
        <div className="glass p-6 text-center">
          <p role="alert">{error}</p>
          <button className="btn-ghost mt-3" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading leads">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : data.leads.length === 0 ? (
        <p className="glass p-10 text-center text-slate-400">
          {q || get('stage') || get('disposition') || get('qualification')
            ? 'No leads match these filters.'
            : queue === 'mine'
              ? manager
                ? 'No leads yet.'
                : 'No leads are assigned to you right now.'
              : 'Nothing in this queue. Nice work.'}
        </p>
      ) : (
        <>
          {/* Phones: cards. */}
          <ul className="space-y-2 md:hidden">
            {data.leads.map((l) => (
              <li key={l.id}>
                <Link to={`/admin/leads/${l.id}`} className="glass block p-4 active:bg-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {l.firstName} {l.lastName}
                    </span>
                    <StatusBadge status={l.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-slate-400">
                    {fmtPhone(l.phone)} · {ago(l.lastActivityAt ?? l.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <DispositionPill code={l.disposition} />
                    <QualificationPill q={l.qualification} />
                    <OutcomePill o={l.outcome} />
                  </div>
                  {l.nextFollowUpAt && <p className={`mt-2 text-xs ${isPast(l.nextFollowUpAt) ? 'text-rose-300' : 'text-slate-300'}`}>Next: {when(l.nextFollowUpAt)}</p>}
                </Link>
              </li>
            ))}
          </ul>
          {/* Larger screens: a table. */}
          <div className="glass hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400">
                <tr className="border-b border-white/10">
                  {manager && (
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" aria-label="Select all on this page" checked={selected.length === data.leads.length} onChange={(e) => setSelected(e.target.checked ? data.leads.map((l) => l.id) : [])} />
                    </th>
                  )}
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Stage</th>
                  <th className="px-3 py-3">Latest disposition</th>
                  <th className="px-3 py-3">Next follow-up</th>
                  <th className="px-3 py-3">Last activity</th>
                  {manager && <th className="px-3 py-3">Owner</th>}
                </tr>
              </thead>
              <tbody>
                {data.leads.map((l) => (
                  <tr key={l.id} className="cursor-pointer border-b border-white/5 hover:bg-white/[0.04]" onClick={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && nav(`/admin/leads/${l.id}`)}>
                    {manager && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.firstName} ${l.lastName}`}
                          checked={selected.includes(l.id)}
                          onChange={(e) => setSelected(e.target.checked ? [...selected, l.id] : selected.filter((x) => x !== l.id))}
                        />
                      </td>
                    )}
                    <td className="px-3 py-3">
                      <Link to={`/admin/leads/${l.id}`} className="font-medium text-white hover:underline" onClick={(e) => e.stopPropagation()}>
                        {l.firstName} {l.lastName}
                      </Link>
                      <div className="text-xs text-slate-400">{fmtPhone(l.phone)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={l.status} />
                        <OutcomePill o={l.outcome} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        <DispositionPill code={l.disposition} />
                        <QualificationPill q={l.qualification} />
                      </div>
                    </td>
                    <td className={`px-3 py-3 ${l.nextFollowUpAt && isPast(l.nextFollowUpAt) ? 'text-rose-300' : 'text-slate-300'}`}>{l.nextFollowUpAt ? when(l.nextFollowUpAt) : '—'}</td>
                    <td className="px-3 py-3 text-slate-400">{ago(l.lastActivityAt ?? l.createdAt)}</td>
                    {manager && <td className="px-3 py-3 text-slate-300">{l.ownerName ?? 'Unassigned'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Pages">
              <button className="btn-ghost py-2" disabled={page === 0} onClick={() => set('page', String(page - 1))}>
                Previous
              </button>
              <span className="text-slate-400">
                Page {page + 1} of {pages}
              </span>
              <button className="btn-ghost py-2" disabled={page + 1 >= pages} onClick={() => set('page', String(page + 1))}>
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
