import type { AvailabilityResult } from '../../shared/schemas';

const STATUS_TONE: Record<string, string> = {
  available: 'from-emerald-400/20 to-fiber-400/10 border-emerald-400/30',
  verify: 'from-fiber-400/20 to-pulse-500/10 border-fiber-400/30',
  coming_soon: 'from-pulse-500/20 to-fiber-400/10 border-pulse-500/30',
  not_serviceable: 'from-slate-500/20 to-slate-500/5 border-slate-500/30',
  unknown: 'from-amber-400/15 to-slate-500/5 border-amber-400/30',
};

export default function AvailabilityBanner({ result }: { result: AvailabilityResult }) {
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-5 ${STATUS_TONE[result.status]}`} role="status" aria-live="polite">
      <p className="font-display text-lg font-bold">{result.headline}</p>
      <p className="mt-1 text-slate-200">{result.message}</p>
    </div>
  );
}
