/** Follow-ups: overdue, due today, upcoming and recently completed, in the viewer's time zone. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TASK_KIND_LABEL, type TaskBucket } from '../../../shared/team/workspace';
import { api } from '../../lib/api';
import { useTeam } from './Layout';
import { ago, errorText, myTz, Pill, toLocalInput, useToast, when } from './work/common';
import type { WorkTask } from './work/types';

const TABS: [TaskBucket, string][] = [
  ['overdue', 'Overdue'],
  ['today', 'Due today'],
  ['upcoming', 'Upcoming'],
  ['completed', 'Completed'],
];

export default function FollowUps() {
  const team = useTeam();
  const [data, setData] = useState<Record<TaskBucket, WorkTask[]> | null>(null);
  const [tab, setTab] = useState<TaskBucket>('overdue');
  const [error, setError] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [moving, setMoving] = useState<{ id: string; due: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  const manager = team.workRole !== 'rep';

  const load = () =>
    api<{ buckets: Record<TaskBucket, WorkTask[]> }>(`/admin/work/tasks?tz=${encodeURIComponent(myTz())}${assignee ? `&assignee=${assignee}` : ''}`)
      .then((r) => {
        setData(r.buckets);
        setError('');
      })
      .catch((err) => setError(errorText(err, 'Follow-ups didn’t load. Check your connection and try again.')));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignee]);
  useEffect(() => {
    if (data && tab === 'overdue' && data.overdue.length === 0 && data.today.length) setTab('today');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    if (manager)
      api<{ representatives: { id: string; name: string; active: boolean }[] }>('/admin/reps')
        .then((r) => setReps(r.representatives.filter((x) => x.active)))
        .catch(() => setReps([]));
  }, [manager]);

  async function act(t: WorkTask, body: object, ok: string) {
    setBusy(t.id);
    try {
      await api(`/admin/tasks/${t.id}`, { method: 'PATCH', body });
      toast(ok);
      setMoving(null);
      await load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  const list = data?.[tab] ?? [];
  return (
    <div className="space-y-4">
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Follow-ups</h1>
          <p className="text-sm text-slate-400">Times in {myTz()}.</p>
        </div>
        {manager && (
          <label className="text-sm text-slate-400">
            Owner{' '}
            <select className="input inline-block w-auto py-1.5" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Everyone</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div role="tablist" aria-label="Follow-up status" className="flex gap-1 overflow-x-auto rounded-xl bg-white/5 p-1">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-11 flex-1 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm ${tab === k ? 'bg-white/15 text-white' : 'text-slate-400'}`}
          >
            {label} {data && <span className={k === 'overdue' && data.overdue.length ? 'text-rose-300' : 'text-slate-400'}>({data[k].length})</span>}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="glass p-6 text-center">
          {error}
        </p>
      ) : !data ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading follow-ups">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((t) => (
            <li key={t.id} className={`glass p-4 ${tab === 'overdue' ? 'border-rose-400/30' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/admin/leads/${t.leadId}`} className="font-semibold text-white hover:underline">
                  {t.leadName || 'Lead'}
                </Link>
                <span className="text-slate-300">· {t.title}</span>
                {t.priority === 'high' && <Pill tone="rose">High</Pill>}
                {t.doNotContact && <Pill tone="rose">Do Not Contact</Pill>}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {TASK_KIND_LABEL[t.kind]} · {t.doneAt ? `done ${when(t.doneAt)} by ${t.doneBy}` : `${when(t.dueAt)} (${ago(t.dueAt)})`}
                {t.reschedules > 0 && ` · moved ${t.reschedules}×`}
              </p>
              {t.notes && <p className="mt-1 text-sm text-slate-300">{t.notes}</p>}
              {!t.doneAt &&
                (moving?.id === t.id ? (
                  <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(t, { action: 'reschedule', dueAt: new Date(moving.due).toISOString(), timeZone: myTz() }, 'Follow-up moved');
                    }}
                  >
                    <label className="sr-only" htmlFor={`mv-${t.id}`}>
                      New time
                    </label>
                    <input id={`mv-${t.id}`} type="datetime-local" className="input w-auto flex-1 py-2" value={moving.due} onChange={(e) => setMoving({ id: t.id, due: e.target.value })} required />
                    <button className="btn-primary py-2 text-sm" disabled={busy === t.id}>
                      Move
                    </button>
                    <button type="button" className="btn-ghost py-2 text-sm" onClick={() => setMoving(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-primary min-h-11 py-2 text-sm" disabled={busy === t.id} onClick={() => act(t, { action: 'complete' }, 'Follow-up done')}>
                      Done
                    </button>
                    <button className="btn-ghost min-h-11 py-2 text-sm" onClick={() => setMoving({ id: t.id, due: toLocalInput(new Date(Date.now() + 86_400_000)) })}>
                      Reschedule
                    </button>
                    <Link to={`/admin/leads/${t.leadId}`} className="btn-ghost min-h-11 py-2 text-sm">
                      Open lead
                    </Link>
                  </div>
                ))}
            </li>
          ))}
          {list.length === 0 && (
            <li className="glass p-8 text-center text-slate-400">
              {tab === 'overdue' ? 'Nothing overdue.' : tab === 'today' ? 'Nothing else due today.' : tab === 'upcoming' ? 'No upcoming follow-ups.' : 'Nothing completed in the last 14 days.'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
