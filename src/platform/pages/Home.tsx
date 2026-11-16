import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PLATFORM, PLATFORM_META } from '../../../shared/platform/brand';
import { track } from '../../lib/analytics';
import { Card, StatusChip } from '../ds';

const CATEGORIES = [
  { name: 'Home internet', body: 'Speed, equipment fees and what happens when a promotion ends.', status: 'Live comparisons in pilot areas' },
  { name: 'Mobile', body: 'Per-line costs, separated from phone payments.', status: 'Comparisons coming' },
  { name: 'TV & streaming', body: 'Cable, satellite and streaming, side by side.', status: 'Comparisons coming' },
  { name: 'Electricity & solar', body: 'Your electric bill compared with rooftop solar, when you own your home.', status: 'Estimates — confirmed by a site assessment' },
];

const STEPS = [
  { title: 'Tell us what you pay', body: 'A few questions per service. Not sure of a number? Say so — we’ll never guess for you.' },
  { title: 'See your full picture', body: 'Monthly and yearly spending, the biggest opportunities, and 1-, 5- and 10-year projections with every assumption shown.' },
  { title: 'Get help switching', body: 'Talk to an advisor or book a time when an option looks right. No account needed.' },
];

export default function Home() {
  useEffect(() => {
    document.title = PLATFORM_META.title;
  }, []);
  return (
    <>
      <section className="border-b border-pf-line bg-pf-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:py-20">
          <div>
            <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-pf-ink sm:text-5xl">
              Know exactly what your household pays — and what it could pay instead.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-pf-muted">{PLATFORM.tagline} No account, no sales pitch, and no guaranteed-savings claims.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/savings/assess"
                onClick={() => track('cta_click', { location: 'pf_hero' })}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-pf-brand px-6 text-base font-semibold text-white hover:bg-pf-brand-strong"
              >
                Find My Savings
              </Link>
              <Link
                to="/savings/assess"
                onClick={() => track('cta_click', { location: 'pf_hero_secondary' })}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-pf-field px-6 text-base font-semibold text-pf-ink hover:bg-pf-bg"
              >
                Analyze My Household Bills
              </Link>
            </div>
            <p className="mt-4 text-sm text-pf-subtle">Takes about 3 minutes. Your contact details are only needed if you ask us to reach out.</p>
          </div>
          <Card as="div" className="lg:ml-auto lg:w-full lg:max-w-md">
            <p className="text-xs font-semibold uppercase tracking-wide text-pf-subtle">What you’ll get</p>
            <ul className="mt-3 space-y-3 text-pf-ink">
              {['Your spending by service, monthly and yearly', 'The biggest opportunities, ranked transparently', 'Projections with switching costs and break-even', 'Every price labelled by how it was verified'].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-pf-save" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      <section aria-labelledby="cats" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 id="cats" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
          What we analyze
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => (
            <li key={c.name} className="rounded-2xl border border-pf-line bg-pf-surface p-5">
              <h3 className="font-semibold text-pf-ink">{c.name}</h3>
              <p className="mt-1.5 text-sm text-pf-muted">{c.body}</p>
              <p className="mt-3 text-xs font-semibold text-pf-subtle">{c.status}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" aria-labelledby="how-t" className="scroll-mt-4 border-y border-pf-line bg-pf-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how-t" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="font-display text-sm font-bold text-pf-brand">Step {i + 1}</span>
                <h3 className="mt-1 text-lg font-semibold text-pf-ink">{s.title}</h3>
                <p className="mt-1.5 text-pf-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="data" aria-labelledby="data-t" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-14 sm:px-6">
        <h2 id="data-t" className="font-display text-2xl font-bold text-pf-ink sm:text-3xl">
          You’ll always know where a number came from
        </h2>
        <p className="mt-3 max-w-2xl text-pf-muted">Each price carries a label. Unverified or outdated information is never presented as verified — it’s downgraded automatically.</p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ['verified', 'Confirmed from a provider document or authorized feed.'],
              ['manually_verified', 'Checked by our team with the provider, with a date.'],
              ['pending_verification', 'The plan is real, but availability at your exact address still needs confirming.'],
              ['estimated', 'An estimate — useful for planning, not a quote.'],
              ['user_reported', 'A number you gave us about your current service.'],
              ['sample', 'Illustrative data on preview builds. Never a real offer.'],
            ] as const
          ).map(([s, d]) => (
            <div key={s} className="rounded-2xl border border-pf-line bg-pf-surface p-4">
              <dt>
                <StatusChip status={s} />
              </dt>
              <dd className="mt-2 text-sm text-pf-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
