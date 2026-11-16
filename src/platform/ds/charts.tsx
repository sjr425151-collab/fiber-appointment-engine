/**
 * Purposeful, accessible charts: plain SVG (no chart library), each with a
 * data table equivalent. Charts are aria-hidden; the table carries the data
 * for assistive tech and is one click away for everyone.
 */
import { useId, useState, useSyncExternalStore } from 'react';
import { formatCents, type Cents } from '../../../shared/finance/money';

export interface CumulativePoint {
  month: number; // 0-based
  cumulativeSavings: Cents;
}

const NARROW = '(max-width: 639px)';
/** True on narrow screens, so the SVG uses a smaller coordinate space and its text stays legible. */
function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(NARROW);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/** Cumulative savings over time with the break-even point marked. */
export function CumulativeChart({ points, breakEvenMonths, title }: { points: CumulativePoint[]; breakEvenMonths: number | null; title: string }) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const narrow = useNarrow();
  if (!points.length) return null;
  // Narrow screens: a smaller viewBox so 12–13px text renders at roughly that size.
  const W = narrow ? 320 : 640;
  const FS = narrow ? 13 : 12;
  const H = 220;
  const P = { l: 64, r: 16, t: 16, b: 32 };
  const vals = points.map((p) => p.cumulativeSavings);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (m: number) => P.l + (m / Math.max(1, points.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + ((max - v) / span) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p.cumulativeSavings).toFixed(1)}`).join(' ');
  const end = vals[vals.length - 1];
  const years = Math.max(1, Math.round(points.length / 12));
  const yearTicks = Array.from({ length: years + 1 }, (_, i) => i * 12).filter((m) => m < points.length || m === points.length);
  const rows = yearTicks
    .filter((m) => m > 0)
    .map((m) => ({
      year: m / 12,
      value: points[Math.min(m, points.length) - 1].cumulativeSavings,
    }));

  return (
    <figure>
      <figcaption className="mb-2 text-sm font-semibold text-pf-ink">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden>
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--color-pf-field)" strokeDasharray="4 4" />
        <text x={P.l - 8} y={y(0) + 4} textAnchor="end" fontSize={FS} fill="var(--color-pf-muted)">
          $0
        </text>
        <text x={P.l - 8} y={y(max) + 12} textAnchor="end" fontSize={FS} fill="var(--color-pf-muted)">
          {max > 0 ? formatCents(max, { cents: false }) : ''}
        </text>
        {min < 0 && (
          <text x={P.l - 8} y={y(min)} textAnchor="end" fontSize={FS} fill="var(--color-pf-muted)">
            {formatCents(min, { cents: false })}
          </text>
        )}
        {yearTicks
          .filter((m) => !narrow || yearTicks.length <= 6 || (m / 12) % 2 === 0)
          .map((m) => (
            <text key={m} x={x(Math.min(m, points.length - 1))} y={H - 8} textAnchor="middle" fontSize={FS} fill="var(--color-pf-muted)">
              {m === 0 ? 'Now' : `Yr ${m / 12}`}
            </text>
          ))}
        <path d={d} fill="none" stroke={end >= 0 ? 'var(--color-pf-save)' : 'var(--color-pf-cost)'} strokeWidth="3" strokeLinejoin="round" />
        {breakEvenMonths !== null && breakEvenMonths > 0 && breakEvenMonths <= points.length && (
          <g>
            <circle
              cx={x(breakEvenMonths - 1)}
              cy={y(points[breakEvenMonths - 1].cumulativeSavings)}
              r="6"
              fill="var(--color-pf-surface)"
              stroke="var(--color-pf-ink)"
              strokeWidth="2"
            />
            <text
              x={Math.min(x(breakEvenMonths - 1) + 10, W - P.r - 70)}
              y={y(points[breakEvenMonths - 1].cumulativeSavings) - 10}
              fontSize={FS}
              fill="var(--color-pf-ink)"
            >
              Break-even
            </text>
          </g>
        )}
      </svg>
      <button
        type="button"
        className="mt-2 text-sm font-medium text-pf-brand underline underline-offset-4"
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((s) => !s)}
      >
        {showTable ? 'Hide' : 'Show'} data table
      </button>
      {/* Hidden via a wrapping div: sr-only doesn't clip a <table> in every browser. */}
      <div id={tableId} className={showTable ? undefined : 'sr-only'}>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-left text-pf-muted">
              <th scope="col" className="py-1 font-medium">
                After
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Cumulative difference
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-t border-pf-line">
                <td className="py-1.5">
                  {r.year} {r.year === 1 ? 'year' : 'years'}
                </td>
                <td className="tnum py-1.5 text-right">
                  {formatCents(Math.abs(r.value))} {r.value >= 0 ? 'saved' : 'extra cost'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Horizontal bars comparing current vs alternative monthly cost per category. */
export function BarCompare({ rows, title }: { rows: { label: string; current: Cents; alternative: Cents | null }[]; title: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.current, r.alternative ?? 0]));
  return (
    <figure>
      <figcaption className="mb-3 text-sm font-semibold text-pf-ink">{title}</figcaption>
      {/* Data for assistive tech: one cell per column. */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">Now</th>
              <th scope="col">Selected option</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{formatCents(r.current)} a month</td>
                <td>{r.alternative === null ? 'No comparison available' : `${formatCents(r.alternative)} a month`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Visual bars (same data as the table above). */}
      <div className="space-y-1 text-sm" aria-hidden>
        {rows.map((r) => (
          <div key={r.label} className="flex items-start">
            <div className="w-28 shrink-0 py-2 pr-3 text-left font-medium text-pf-ink sm:w-36">{r.label}</div>
            <div className="min-w-0 flex-1 py-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 rounded-full bg-pf-field"
                  style={{
                    width: `${(r.current / max) * 100}%`,
                    minWidth: r.current ? 4 : 0,
                  }}
                  aria-hidden
                />
                <span className="tnum whitespace-nowrap text-pf-muted">Now {formatCents(r.current)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {r.alternative === null ? (
                  <span className="text-pf-subtle">No comparison available</span>
                ) : (
                  <>
                    <span
                      className="h-3 rounded-full bg-pf-brand"
                      style={{
                        width: `${(r.alternative / max) * 100}%`,
                        minWidth: r.alternative ? 4 : 0,
                      }}
                      aria-hidden
                    />
                    <span className="tnum whitespace-nowrap font-semibold text-pf-ink">Option {formatCents(r.alternative)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
