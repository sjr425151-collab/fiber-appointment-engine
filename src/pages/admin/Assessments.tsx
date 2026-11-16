import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCents } from '../../../shared/finance/money';
import { api, fmtDateTime } from '../../lib/api';
import { Spinner } from '../../components/ui';

interface Row {
  id: string;
  zip: string;
  categories: string[];
  status: 'complete' | 'incomplete';
  currentMonthlyCents: number | null;
  potentialSavingsCents: number;
  projectionBasis: string;
  includeSamples: boolean;
  leadId: string | null;
  utmSource: string;
  createdAt: string;
}
interface Payload {
  assessments: Row[];
  total: number;
  stats: { days: number; completed: number; withLead: number; withOpportunity: number };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export default function Assessments() {
  const [d, setD] = useState<Payload | null>(null);
  useEffect(() => {
    api<Payload>('/admin/assessments').then(setD);
  }, []);
  if (!d)
    return (
      <div className="grid place-items-center py-20 text-slate-400">
        <Spinner />
      </div>
    );
  const s = d.stats;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Household assessments</h1>
        <p className="mt-1 text-sm text-slate-400">Parent-platform assessments. Contact details exist only on the linked lead, when the household asked to be contacted.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            [`Completed (${s.days} days)`, String(s.completed)],
            ['Asked to be contacted', `${s.withLead} · ${pct(s.withLead, s.completed)}`],
            ['Found a saving', `${s.withOpportunity} · ${pct(s.withOpportunity, s.completed)}`],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="glass p-5">
            <p className="text-sm text-slate-400">{k}</p>
            <p className="mt-1 font-display text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>
      <div className="glass overflow-x-auto">
        {d.assessments.length === 0 ? (
          <p className="py-16 text-center text-slate-400">No assessments yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recent assessments</caption>
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">ZIP</th>
                <th className="px-4 py-3">Services</th>
                <th className="px-4 py-3 text-right">Pays now</th>
                <th className="px-4 py-3 text-right">Potential savings</th>
                <th className="px-4 py-3">Basis</th>
                <th className="px-4 py-3">Lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {d.assessments.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">{fmtDateTime(a.createdAt)}</td>
                  <td className="px-4 py-3 font-mono">{a.zip}</td>
                  <td className="px-4 py-3 text-slate-300">{a.categories.join(', ')}</td>
                  <td className="px-4 py-3 text-right">{a.currentMonthlyCents === null ? <span className="text-slate-400">incomplete</span> : `${formatCents(a.currentMonthlyCents)}/mo`}</td>
                  <td className="px-4 py-3 text-right">{a.potentialSavingsCents ? `${formatCents(a.potentialSavingsCents)}/mo` : '—'}</td>
                  <td className={`px-4 py-3 text-xs ${a.includeSamples ? 'text-amber-300' : 'text-slate-400'}`}>
                    {a.projectionBasis.replace('_', ' ')}
                    {a.includeSamples ? ' · sample data' : ''}
                  </td>
                  <td className="px-4 py-3">
                    {a.leadId ? (
                      <Link to={`/admin/leads/${a.leadId}`} className="text-cyan-300 underline underline-offset-4">
                        Open lead
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
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
