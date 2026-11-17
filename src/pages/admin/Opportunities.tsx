import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCents } from '../../../shared/finance/money';
import { OPPORTUNITY_STATUS_LABEL, OPPORTUNITY_STATUSES, type OpportunityKind, type OpportunityStatus } from '../../../shared/platform/opportunity';
import { api, ApiError, fmtDateTime } from '../../lib/api';
import { Spinner } from '../../components/ui';

export interface OpportunityRow {
  id: string;
  leadId: string;
  leadName?: string;
  category: string;
  planName: string;
  kind: OpportunityKind;
  estimate: boolean;
  currentMonthlyCents: number | null;
  proposedMonthlyCents: number | null;
  monthlySavingsCents: number | null;
  fiveYearSavingsCents: number | null;
  status: OpportunityStatus;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_LABEL: Record<string, string> = { internet: 'Home internet', mobile: 'Mobile', tv: 'TV & streaming', electricity: 'Electricity / solar', security: 'Home security', household: 'Whole household' };
const KIND_LABEL: Record<OpportunityKind, string> = {
  verified: 'Verified offer',
  pending_address: 'Real plan · address not confirmed',
  sample: 'SAMPLE — not a real offer',
  advisor: 'Needs an advisor quote',
};

const money = (c: number | null, suffix = '/mo') => (c === null ? '—' : `${formatCents(c)}${suffix}`);
const savings = (c: number | null) => (c === null ? '—' : c >= 0 ? `${formatCents(c)}/mo less` : `${formatCents(-c)}/mo more`);

/** Status dropdown that saves immediately and reports failures inline. */
export function OpportunityStatusSelect({ o, onSaved }: { o: OpportunityRow; onSaved: (o: OpportunityRow) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div>
      <label className="sr-only" htmlFor={`opp-${o.id}`}>
        Status for {o.planName}
      </label>
      <select
        id={`opp-${o.id}`}
        value={o.status}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setErr('');
          try {
            const r = await api<{ opportunity: OpportunityRow }>(`/admin/opportunities/${o.id}`, { method: 'PATCH', body: { status: e.target.value } });
            onSaved({ ...o, ...r.opportunity });
          } catch (x) {
            setErr(x instanceof ApiError ? x.message : 'Could not save.');
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-sm text-slate-100"
      >
        {OPPORTUNITY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {OPPORTUNITY_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {err && (
        <p role="alert" className="mt-1 text-xs text-rose-300">
          {err}
        </p>
      )}
    </div>
  );
}

/** Compact list used on the lead page. */
export function OpportunityPanel({ items, onChange }: { items: OpportunityRow[]; onChange: (o: OpportunityRow) => void }) {
  return (
    <div className="glass p-5">
      <h2 className="mb-1 font-semibold">What they asked about</h2>
      <p className="mb-3 text-xs text-slate-400">As the customer selected it on their results page. Figures are estimates from the assessment, not quotes.</p>
      <ul className="space-y-3 text-sm">
        {items.map((o) => (
          <li key={o.id} className="rounded-lg bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {CATEGORY_LABEL[o.category] ?? o.category} → {o.planName}
                </p>
                <p className={`text-xs ${o.kind === 'sample' ? 'font-semibold text-amber-300' : 'text-slate-400'}`}>
                  {KIND_LABEL[o.kind]}
                  {o.estimate ? ' · estimate' : ''}
                </p>
                <p className="mt-1 text-slate-300">
                  Now {money(o.currentMonthlyCents)} · Option {money(o.proposedMonthlyCents)} · {savings(o.monthlySavingsCents)}
                </p>
              </div>
              <OpportunityStatusSelect o={o} onSaved={onChange} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Payload {
  opportunities: OpportunityRow[];
  total: number;
  stats: Record<OpportunityStatus, { count: number; monthlySavingsCents: number }>;
}

/** Pipeline of household opportunities with filters and inline status changes. */
export default function Opportunities() {
  const [status, setStatus] = useState<OpportunityStatus | ''>('');
  const [category, setCategory] = useState('');
  const [d, setD] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (category) q.set('category', category);
    api<Payload>(`/admin/opportunities?${q}`)
      .then((r) => {
        setError('');
        setD(r);
      })
      .catch(() => setError('Could not load opportunities.'));
  }, [status, category]);

  const replace = (o: OpportunityRow) => setD((prev) => prev && { ...prev, opportunities: prev.opportunities.map((x) => (x.id === o.id ? { ...x, ...o } : x)) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Opportunities</h1>
        <p className="mt-1 text-sm text-slate-400">One row per service a household asked for help with. Savings totals count only real offers (never samples or advisor-quote rows).</p>
      </div>
      {d && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {OPPORTUNITY_STATUSES.map((s) => (
            <li key={s} className="glass p-4">
              <p className="text-xs text-slate-400">{OPPORTUNITY_STATUS_LABEL[s]}</p>
              <p className="font-display text-xl font-bold">{d.stats[s].count}</p>
              {d.stats[s].monthlySavingsCents > 0 && <p className="text-xs text-slate-400">{formatCents(d.stats[s].monthlySavingsCents)}/mo est.</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-400">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as OpportunityStatus | '')} className="rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5">
            <option value="">All</option>
            {OPPORTUNITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {OPPORTUNITY_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-400">Service</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5">
            <option value="">All</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="glass overflow-x-auto">
        {!d ? (
          <div className="grid place-items-center py-16 text-slate-400">
            <Spinner />
          </div>
        ) : d.opportunities.length === 0 ? (
          <p className="py-16 text-center text-slate-400">No opportunities{status || category ? ' match these filters' : ' yet'}.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Opportunities</caption>
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Service → option</th>
                <th className="px-4 py-3 text-right">Now</th>
                <th className="px-4 py-3 text-right">Est. savings</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {d.opportunities.map((o) => (
                <tr key={o.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">{fmtDateTime(o.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/leads/${o.leadId}`} className="text-cyan-300 underline underline-offset-4">
                      {o.leadName || 'Open lead'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-200">
                      {CATEGORY_LABEL[o.category] ?? o.category} → {o.planName}
                    </span>
                    <span className={`block text-xs ${o.kind === 'sample' ? 'font-semibold text-amber-300' : 'text-slate-400'}`}>
                      {KIND_LABEL[o.kind]}
                      {o.estimate ? ' · estimate' : ''}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{money(o.currentMonthlyCents)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{savings(o.monthlySavingsCents)}</td>
                  <td className="px-4 py-3">
                    <OpportunityStatusSelect o={o} onSaved={replace} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
