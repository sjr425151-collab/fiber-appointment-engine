/**
 * National benchmarks: the comparison prices behind every savings
 * preview. Publishing creates a new version; results already saved keep the
 * values they were calculated with.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatCents, parseDollars } from '../../../shared/finance/money';
import { BENCHMARK_DISCLOSURE, BENCHMARK_FIELDS, quickPreview, type BenchmarkSet } from '../../../shared/platform/benchmarks';
import { api, ApiError, fmtDateTime } from '../../lib/api';
import { Spinner } from '../../components/ui';

interface Version extends BenchmarkSet {
  id: number;
  note: string;
  publishedBy: string;
  publishedAt: string;
}
type Key = (typeof BENCHMARK_FIELDS)[number][0];
const dollars = (c: number) => (c / 100).toFixed(2);
/** A sample household used only to show what customers would see with the draft values. */
const SAMPLE = { internet: 9500, mobile: 19000, mobileLines: 3, tv: 12000, electricity: 26000, security: 6000, ownsHome: true, showExtras: true };

export default function Benchmarks() {
  const [data, setData] = useState<{ current: Version; history: Version[] } | null>(null);
  const [draft, setDraft] = useState<Record<Key, string>>({ internetMonthly: '', mobilePerLine: '', tvMonthly: '', electricityWithSolarMonthly: '', securityMonthly: '' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');

  const load = (d: { current: Version; history: Version[] }) => {
    setData(d);
    setDraft(Object.fromEntries(BENCHMARK_FIELDS.map(([k]) => [k, dollars(d.current[k] ?? 8000)])) as Record<Key, string>);
    setNote('');
  };
  useEffect(() => {
    api<{ current: Version; history: Version[] }>('/admin/benchmarks').then(load);
  }, []);

  const parsed = useMemo(() => {
    const out = {} as Record<Key, number | null>;
    for (const [k] of BENCHMARK_FIELDS) {
      const cents = parseDollars(draft[k]);
      out[k] = cents !== null && cents >= 100 ? cents : null;
    }
    return out;
  }, [draft]);
  const valid = BENCHMARK_FIELDS.every(([k]) => parsed[k] !== null);
  const changed = !!data && BENCHMARK_FIELDS.some(([k]) => parsed[k] !== (data.current[k] ?? 8000));
  const preview = valid ? quickPreview(SAMPLE, { version: 'draft', ...(parsed as Record<Key, number>) }) : null;

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!valid || !changed) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const d = await api<{ current: Version; history: Version[] }>('/admin/benchmarks', { method: 'POST', body: { ...parsed, note } });
      load(d);
      setSaved(`Published as version ${d.current.version}. New previews use these values now.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Nothing was published.');
    } finally {
      setBusy(false);
    }
  }
  async function restore(v: Version) {
    setBusy(true);
    setError('');
    try {
      const d = await api<{ current: Version; history: Version[] }>(`/admin/benchmarks/${v.id}/restore`, { method: 'POST' });
      load(d);
      setSaved(`Restored the values of ${v.version} as version ${d.current.version}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="grid place-items-center py-20 text-slate-400">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Benchmarks</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          The national comparison prices behind every savings preview. {BENCHMARK_DISCLOSURE} Results customers already received keep the values they were calculated with.
        </p>
      </div>

      <form onSubmit={publish} className="glass space-y-5 p-5">
        <h2 className="font-semibold">
          Current values <span className="text-sm font-normal text-slate-400">· version {data.current.version}</span>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {BENCHMARK_FIELDS.map(([k, label, unit]) => (
            <div key={k}>
              <label className="label" htmlFor={`bm-${k}`}>
                {label}
              </label>
              <div className="flex items-center gap-2">
                <span className="text-slate-400" aria-hidden>
                  $
                </span>
                <input
                  id={`bm-${k}`}
                  inputMode="decimal"
                  className="input"
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  aria-invalid={parsed[k] === null || undefined}
                  aria-describedby={`bm-${k}-u`}
                />
              </div>
              <p id={`bm-${k}-u`} className="mt-1 text-xs text-slate-400">
                {unit}
                {parsed[k] === null ? ' · enter an amount of at least $1' : ''}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-white/[0.03] p-4">
          <h3 className="text-sm font-semibold">What a customer would see</h3>
          <p className="mt-1 text-xs text-slate-400">Example household: internet $95, mobile $190 for 3 lines, TV $120, electricity $260, home security $60, owns their home and asked for extra-service pricing.</p>
          {preview ? (
            <>
              <ul className="mt-3 space-y-1 text-sm text-slate-200">
                {preview.rows.map((r) => (
                  <li key={r.category} className="flex justify-between gap-3">
                    <span className="capitalize">
                      {r.category} <span className="text-slate-400">vs {r.benchmark === null ? '—' : formatCents(r.benchmark)}</span>
                    </span>
                    <span>{r.difference === null ? 'Not compared' : r.difference >= 0 ? `${formatCents(r.difference)}/mo less` : `${formatCents(-r.difference)}/mo more`}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm font-semibold">
                Potential difference {formatCents(preview.monthlySavings)}/mo · {formatCents(preview.annualSavings)}/yr
                {preview.monthlyHigher > 0 && <span className="font-normal text-amber-300"> · {formatCents(preview.monthlyHigher)}/mo shown as a possible extra cost</span>}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-amber-300">Fix the highlighted amounts to see the preview.</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="bm-note">
            Why are you changing them? (kept in the history)
          </label>
          <input id="bm-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-emerald-300">
            {saved}
          </p>
        )}
        <button className="btn-primary py-2 text-sm" disabled={busy || !valid || !changed}>
          {busy ? <Spinner /> : 'Publish new version'}
        </button>
      </form>

      <div className="glass overflow-hidden">
        <h2 className="border-b border-white/10 p-4 font-semibold">Version history</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Internet</th>
                <th className="px-4 py-3">Mobile / line</th>
                <th className="px-4 py-3">TV</th>
                <th className="px-4 py-3">Electricity + solar</th>
                <th className="px-4 py-3">Security</th>
                <th className="px-4 py-3">Published</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.history.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-3 font-medium">
                    {v.version}
                    {v.id === data.current.id && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">In use</span>}
                  </td>
                  <td className="px-4 py-3">{formatCents(v.internetMonthly)}</td>
                  <td className="px-4 py-3">{formatCents(v.mobilePerLine)}</td>
                  <td className="px-4 py-3">{formatCents(v.tvMonthly)}</td>
                  <td className="px-4 py-3">{formatCents(v.electricityWithSolarMonthly)}</td>
                  <td className="px-4 py-3">{formatCents(v.securityMonthly ?? 8000)}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {fmtDateTime(v.publishedAt)} · {v.publishedBy}
                    {v.note && <div className="text-xs text-slate-400">{v.note}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.id !== data.current.id && (
                      <button className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => restore(v)}>
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
