/**
 * Representatives: who receives pricing-review requests. Routing reads this
 * list (shared/platform/routing.ts): active, accepting, location, service and
 * open-lead limit. "Accepting" is a switch a person sets; nothing is inferred.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { Representative } from '../../../shared/schemas';
import { api, ApiError, fmtDateTime } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { useAdminMarkets } from './useMarkets';

const CATEGORIES = [
  ['internet', 'Home internet'],
  ['mobile', 'Mobile'],
  ['tv', 'TV & streaming'],
  ['electricity', 'Electricity / solar'],
] as const;
type Category = (typeof CATEGORIES)[number][0];

interface Draft {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  active: boolean;
  accepting: boolean;
  allMarkets: boolean;
  markets: string[];
  categories: Category[];
  maxOpenLeads: string;
  password: string;
}
const blank: Draft = { id: null, name: '', email: '', phone: '', active: true, accepting: false, allMarkets: true, markets: [], categories: [], maxOpenLeads: '0', password: '' };
const toDraft = (r: Representative): Draft => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  active: r.active,
  accepting: r.accepting,
  allMarkets: r.markets.includes('*'),
  markets: r.markets.filter((m) => m !== '*'),
  categories: r.categories,
  maxOpenLeads: String(r.maxOpenLeads),
  password: '',
});
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function Reps() {
  const [reps, setReps] = useState<Representative[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data: md } = useAdminMarkets();
  const markets = md?.markets ?? [];

  const load = () => api<{ representatives: Representative[] }>('/admin/reps').then((r) => setReps(r.representatives));
  useEffect(() => {
    load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setErrors({});
    const body = {
      name: draft.name,
      email: draft.email,
      phone: draft.phone,
      active: draft.active,
      accepting: draft.active && draft.accepting,
      markets: draft.allMarkets ? ['*'] : draft.markets,
      categories: draft.categories,
      maxOpenLeads: Number(draft.maxOpenLeads) || 0,
      ...(draft.password ? { password: draft.password } : {}),
    };
    try {
      await api(draft.id ? `/admin/reps/${draft.id}` : '/admin/reps', { method: draft.id ? 'PUT' : 'POST', body });
      setDraft(null);
      await load();
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, _: err.message } : { _: 'Network error. Nothing was saved.' });
    } finally {
      setBusy(false);
    }
  }

  if (!reps) {
    return (
      <div className="grid place-items-center py-20 text-slate-400">
        <Spinner />
      </div>
    );
  }
  const accepting = reps.filter((r) => r.active && r.accepting).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto font-display text-2xl font-bold">Representatives</h1>
        <button className="btn-primary py-2 text-sm" onClick={() => setDraft({ ...blank })}>
          Add representative
        </button>
      </div>
      <p className="max-w-3xl text-sm text-slate-400">
        New pricing-review requests go to an active representative who is accepting leads, covers the customer’s location and service, and has the fewest open leads. A returning household stays with the person already helping
        it. If nobody matches, the request waits in the follow-up queue (Leads → Unassigned).
      </p>
      {accepting === 0 && (
        <p role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          Nobody is accepting leads right now, so every new request goes to the follow-up queue.
        </p>
      )}

      {draft && (
        <form onSubmit={save} className="glass space-y-4 p-5" aria-label={draft.id ? 'Edit representative' : 'Add representative'}>
          <h2 className="font-semibold">{draft.id ? `Edit ${draft.name}` : 'New representative'}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['name', 'Name', 'text'],
                ['email', 'Email (sign-in and lead alerts)', 'email'],
                ['phone', 'Phone', 'tel'],
              ] as const
            ).map(([k, label, type]) => (
              <div key={k}>
                <label className="label" htmlFor={`rep-${k}`}>
                  {label}
                </label>
                <input id={`rep-${k}`} type={type} className="input" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} aria-invalid={!!errors[k] || undefined} />
                {errors[k] && <p className="field-error">{errors[k]}</p>}
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="label">Locations covered</legend>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={draft.allMarkets} onChange={(e) => setDraft({ ...draft, allMarkets: e.target.checked })} /> Every location we serve
              </label>
              {!draft.allMarkets &&
                markets.map((m) => (
                  <label key={m.slug} className="mt-1 flex items-center gap-2 text-sm text-slate-200">
                    <input type="checkbox" checked={draft.markets.includes(m.slug)} onChange={() => setDraft({ ...draft, markets: toggle(draft.markets, m.slug) })} /> {m.name}, {m.state}
                  </label>
                ))}
            </fieldset>
            <fieldset>
              <legend className="label">Services handled</legend>
              <p className="mb-1 text-xs text-slate-400">Leave all unchecked for every service.</p>
              {CATEGORIES.map(([value, label]) => (
                <label key={value} className="mt-1 flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={draft.categories.includes(value)} onChange={() => setDraft({ ...draft, categories: toggle(draft.categories, value) })} /> {label}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="rep-max">
                Open-lead limit (0 = none)
              </label>
              <input id="rep-max" type="number" min={0} max={1000} className="input" value={draft.maxOpenLeads} onChange={(e) => setDraft({ ...draft, maxOpenLeads: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="rep-password">
                {draft.id ? 'New password (blank keeps the current one)' : 'Password (12+ characters)'}
              </label>
              <input id="rep-password" type="password" autoComplete="new-password" className="input" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} aria-invalid={!!errors.password || undefined} />
              {errors.password && <p className="field-error">{errors.password}</p>}
            </div>
            <div className="space-y-2 self-end text-sm text-slate-200">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active (can sign in)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.active && draft.accepting} disabled={!draft.active} onChange={(e) => setDraft({ ...draft, accepting: e.target.checked })} /> Accepting new leads now
              </label>
            </div>
          </div>
          {errors._ && (
            <p role="alert" className="field-error">
              {errors._}
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn-primary py-2 text-sm" disabled={busy}>
              {busy ? <Spinner /> : 'Save'}
            </button>
            <button type="button" className="btn-ghost py-2 text-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
          <p className="text-xs text-slate-400">Give the password to the representative yourself. They sign in at the same team page and see only the leads assigned to them.</p>
        </form>
      )}

      <div className="glass overflow-hidden">
        {reps.length === 0 ? (
          <p className="py-14 text-center text-slate-400">No representatives yet. Until one is added and accepting, every request waits in the follow-up queue.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Covers</th>
                  <th className="px-4 py-3">Open leads</th>
                  <th className="px-4 py-3">Last assigned</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reps.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {!r.active ? <span className="text-slate-400">Inactive</span> : r.accepting ? <span className="text-emerald-300">Accepting leads</span> : <span className="text-amber-300">Not accepting</span>}
                      {r.active && !r.canSignIn && <div className="text-xs text-slate-400">No password set</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <div>{r.markets.includes('*') ? 'All locations' : r.markets.map((m) => markets.find((x) => x.slug === m)?.name ?? m).join(', ') || 'No location'}</div>
                      <div className="text-xs text-slate-400">{r.categories.length ? r.categories.map((c) => CATEGORIES.find(([v]) => v === c)?.[1] ?? c).join(', ') : 'All services'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {r.openLeads}
                      {r.maxOpenLeads > 0 && ` of ${r.maxOpenLeads}`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">{r.lastAssignedAt ? fmtDateTime(r.lastAssignedAt) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setDraft(toDraft(r))}>
                        Edit
                      </button>
                    </td>
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
