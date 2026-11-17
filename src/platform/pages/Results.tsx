import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { assessmentSchema, type AssessmentInput } from '../../../shared/platform/assessment';
import { contactSchema, HANDOFF_COPY, marketingConsentText, type HandoffResult } from '../../../shared/platform/handoff';
import { HandoffDone } from '../HandoffForm';
import { buildAnalysis, HORIZONS, type CategoryOption, type CategoryResult, type Horizon, type PlatformAnalysis, type ScenarioId, type Selections } from '../../../shared/platform/analysis';
import { ASSUMPTIONS_V1 } from '../../../shared/finance/engine';
import { formatCents } from '../../../shared/finance/money';
import { platformConsentText } from '../../../shared/content';
import type { Slot } from '../../../shared/schemas';
import { api, ApiError, fmtCalendarDate, fmtDateTime } from '../../lib/api';
import { sessionId, track } from '../../lib/analytics';
import { Button, Callout, Card, ChoiceCards, Field, Money, SegmentedControl, StatusChip, TextInput, type ChipStatus } from '../ds';
import { BarCompare, CumulativeChart } from '../ds/charts';
import { editHandoff, tokenFromHash, type ResultsPayload } from '../lib';

const LENS_LABEL = { lowest_cost: 'Lowest cost', best_value: 'Best value', highest_performance: 'Fastest', lowest_friction: 'Easiest switch' } as const;
const PRIORITY_LENS: Record<string, keyof typeof LENS_LABEL> = { lower_cost: 'lowest_cost', faster_speed: 'highest_performance', simple_switch: 'lowest_friction', no_contract: 'lowest_friction' };
const KIND_CHIP: Record<CategoryOption['kind'], ChipStatus> = { verified: 'manually_verified', pending_address: 'pending_verification', benchmark: 'benchmark', sample: 'sample' };
const HORIZON_LABEL: Record<Horizon, string> = { 12: '1 year', 60: '5 years', 120: '10 years' };
const NOT_FOUND = 'We couldn’t find these results. The link may be incomplete or expired.';

/** Placeholder shaped like the dashboard, so the page doesn't jump when results arrive. */
function ResultsSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12" aria-busy="true">
      <p role="status" className="sr-only">
        Loading your results…
      </p>
      <div className="h-4 w-48 rounded bg-pf-line motion-safe:animate-pulse" aria-hidden />
      <div className="mt-3 h-9 w-72 max-w-full rounded bg-pf-line motion-safe:animate-pulse" aria-hidden />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl border border-pf-line bg-pf-surface p-4">
            <div className="h-3 w-20 rounded bg-pf-line motion-safe:animate-pulse" />
            <div className="mt-3 h-6 w-24 rounded bg-pf-line motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
      <div className="mt-6 h-48 rounded-2xl border border-pf-line bg-pf-surface" aria-hidden />
    </div>
  );
}

export default function Results() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [token] = useState(tokenFromHash);
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loadError, setError] = useState('');
  const error = token ? loadError : 'This results link is incomplete. Use the full link you were given, or start a new assessment.';
  const [selections, setSelections] = useState<Selections>({});
  const [scenarioId, setScenarioId] = useState<ScenarioId>('flat');
  const [horizon, setHorizon] = useState<Horizon>(60);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    document.title = 'Your household results';
    if (!token) return;
    api<ResultsPayload>(`/platform/assessments/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`)
      .then((d) => {
        setData(d);
        track('results_view', { status: d.analysis.status, basis: d.analysis.projectionBasis });
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? NOT_FOUND : 'We couldn’t load your results. Check your connection and try again.'));
  }, [id, token, attempt]);

  // Same deterministic engine as the server, anchored to the snapshot's time.
  const analysis: PlatformAnalysis | null = useMemo(() => {
    if (!data) return null;
    if (!Object.keys(selections).length) return data.analysis;
    return buildAnalysis(assessmentSchema.parse(data.assessment), { includeSamples: data.analysis.includeSamples, computedAt: data.analysis.computedAt, selections, catalog: data.analysis.catalog, benchmarks: data.analysis.benchmarks });
  }, [data, selections]);

  // Screen-reader summary of recalculated totals, announced (debounced) only when
  // the person changes a time frame, scenario or option — not on first load.
  const liveText = useMemo(() => {
    if (!analysis?.household) return '';
    const sc = analysis.household.scenarios.find((x) => x.scenario.id === scenarioId);
    const at = sc?.atHorizons.find((h) => h.months === horizon);
    const monthly = analysis.opportunities.reduce((sum, o) => sum + o.monthlySavings, 0);
    const dir = (c: number) => (c === 0 ? 'no change' : `${formatCents(Math.abs(c))} ${c > 0 ? 'less' : 'more'}`);
    return `Updated. Potential monthly savings: ${dir(monthly)}. Over ${HORIZON_LABEL[horizon]}${sc ? `, ${sc.scenario.label}` : ''}: ${at ? dir(at.savings) : 'not available'}. Upfront switching costs: ${sc ? formatCents(sc.upfrontSwitchingCost) : 'not available'}.`;
  }, [analysis, scenarioId, horizon]);
  const [announcement, setAnnouncement] = useState('');
  const prevLive = useRef('');
  useEffect(() => {
    const prev = prevLive.current;
    prevLive.current = liveText;
    if (!prev || prev === liveText) return;
    const t = setTimeout(() => setAnnouncement(liveText), 500);
    return () => clearTimeout(t);
  }, [liveText]);

  // Move focus to the page heading once results arrive (route change + async load).
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const loaded = !!data;
  useEffect(() => {
    if (loaded) h1Ref.current?.focus();
  }, [loaded]);

  if (error)
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-pf-ink">Results unavailable</h1>
        <p className="mt-2 text-pf-muted" role="alert">
          {error}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          {token && error !== NOT_FOUND && (
            <Button
              onClick={() => {
                setError('');
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          )}
          <Link
            to="/savings/assess"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-pf-field px-5 font-semibold text-pf-ink hover:bg-pf-surface"
          >
            Start a new assessment
          </Link>
        </div>
      </div>
    );
  if (!data || !analysis) return <ResultsSkeleton />;

  const editAnswers = () => {
    editHandoff.set(data.assessment as AssessmentInput);
    navigate('/savings/assess');
  };
  const adjust = (what: string) => track('results_adjust', { what });
  const scenario = analysis.household?.scenarios.find((s) => s.scenario.id === scenarioId) ?? null;
  const atHorizon = scenario?.atHorizons.find((h) => h.months === horizon) ?? null;
  const priorities = new Set((data.assessment.priorities ?? []).map((p) => PRIORITY_LENS[p]).filter(Boolean));
  const monthlyPotential = analysis.opportunities.reduce((s, o) => s + o.monthlySavings, 0);
  const reviews = analysis.categories.filter((c) => c.selected === 'review').map((c) => (c.category === 'electricity' ? 'electricity (solar)' : c.label.toLowerCase()));
  const listText = (items: string[]) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-pf-subtle">Analysis from {fmtDateTime(analysis.computedAt)} · ZIP {analysis.zip}</p>
          <h1 ref={h1Ref} tabIndex={-1} className="mt-1 font-display text-3xl font-bold text-pf-ink outline-none sm:text-4xl">
            Your household snapshot
          </h1>
        </div>
        <Button variant="secondary" onClick={editAnswers}>
          Edit my answers
        </Button>
      </header>

      <div className="mt-6 space-y-3">
        {analysis.projectionBasis === 'sample' && (
          <Callout tone="sample" title="Includes sample data">
            Some alternatives on this preview are illustrative samples, not real offers. Any savings that use them are for demonstration only.
          </Callout>
        )}
        {analysis.projectionBasis === 'benchmark' && (
          <Callout tone="warn" title="This is an illustrative preview">
            We don’t have a real plan on file for every service at your home, so some savings below compare your bills with Tucker’s benchmarks. They are comparison assumptions, not offers or guarantees: real prices depend on availability, eligibility, active promotions and other pricing factors. An advisor can find actual prices for you.
          </Callout>
        )}
        {analysis.projectionBasis === 'pending_address' && (
          <Callout tone="info" title="Availability at your address isn’t confirmed yet">
            Plan prices were checked by our team, but we still need to confirm service at your exact address. Treat savings as an estimate until an advisor confirms it.
          </Callout>
        )}
        {analysis.notes
          .filter((n) => /regulatory/.test(n))
          .map((n) => (
            <Callout key={n} tone="warn">
              {n}
            </Callout>
          ))}
      </div>

      {analysis.status === 'incomplete' ? (
        <Card className="mt-6">
          <h2 className="font-display text-xl font-bold text-pf-ink">We need a little more to calculate</h2>
          <p className="mt-1 text-pf-muted">We don’t guess at your bills. Add these and we’ll run the numbers:</p>
          <ul className="mt-3 list-disc pl-5 text-pf-ink">
            {analysis.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <Button className="mt-5" onClick={editAnswers}>
            Add the missing amounts
          </Button>
        </Card>
      ) : (
        <>
          {/* -------------------------------------------------------- overview */}
          <section aria-labelledby="ov" className="mt-6">
            <h2 id="ov" className="sr-only">
              Overview
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Stat label="You pay now" value={<Money cents={analysis.household!.currentMonthly} perMonth />} sub={
                  <>
                    <Money cents={analysis.household!.currentAnnual} /> over the next 12 months
                  </>
                } chip="user_reported" />
              <Stat
                label="Potential monthly savings"
                value={monthlyPotential > 0 ? <Money cents={monthlyPotential} kind="savings" perMonth /> : <span className="text-pf-muted">None found yet</span>}
                sub="Once promotions settle, no price increases"
                chip={analysis.projectionBasis === 'current_only' ? undefined : KIND_CHIP[analysis.projectionBasis]}
              />
              <Stat
                label={`Difference over ${HORIZON_LABEL[horizon]}`}
                value={atHorizon ? <Money cents={atHorizon.savings} kind="savings" /> : '—'}
                sub={scenario?.scenario.label}
              />
              <Stat
                label="Upfront switching costs"
                value={scenario ? <Money cents={scenario.upfrontSwitchingCost} /> : '—'}
                sub={
                  scenario?.breakEvenMonths === null
                    ? 'Doesn’t pay back in 10 years'
                    : scenario?.breakEvenMonths === 0
                      ? 'Nothing to pay back'
                      : `Pays back in ${scenario?.breakEvenMonths} month${scenario?.breakEvenMonths === 1 ? '' : 's'}`
                }
              />
            </div>
          </section>

          {/* --------------------------------------------------- opportunities */}
          {analysis.opportunities.length === 0 && (
            <Card className="mt-6">
              <h2 className="font-display text-xl font-bold text-pf-ink">{reviews.length ? 'Next: a free review of your bills' : 'No savings found with the information we have'}</h2>
              <p className="mt-1 text-pf-muted">
                {reviews.length
                  ? `We don’t have verified prices to compare for ${listText(reviews)} in your area yet, so we won’t guess. An advisor can check current offers for you and come back with real numbers.`
                  : 'Your current services look competitive against the options we can verify for your area. An advisor can still double-check your bills.'}
              </p>
              <a href="#next-steps" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-pf-brand px-5 font-semibold text-white hover:bg-pf-brand-strong">
                {reviews.length ? 'Request my free review' : 'Talk to an advisor'}
              </a>
            </Card>
          )}
          {analysis.opportunities.length > 0 && (
            <Card className="mt-6">
              <h2 className="font-display text-xl font-bold text-pf-ink">Biggest opportunities</h2>
              <ol className="mt-3 divide-y divide-pf-line">
                {analysis.opportunities.map((o, i) => (
                  <li key={o.category} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="font-semibold text-pf-ink">
                      {i + 1}. {o.label}
                    </span>
                    <span className="flex items-center gap-2">
                      <Money cents={o.monthlySavings} kind="savings" perMonth />
                      <StatusChip status={KIND_CHIP[o.kind]} />
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex flex-col gap-3 border-t border-pf-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-pf-muted">
                  An advisor can confirm prices and availability at your address and handle the switch with you
                  {reviews.length ? `, and review your ${listText(reviews)} for better prices` : ''}.
                </p>
                <a href="#next-steps" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-pf-brand px-5 font-semibold text-white hover:bg-pf-brand-strong">
                  {HANDOFF_COPY.cta}
                </a>
              </div>
            </Card>
          )}

          {/* ------------------------------------------------------ projection */}
          <Card className="mt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <h2 className="font-display text-xl font-bold text-pf-ink">Projection with your selected options</h2>
              <div className="flex flex-wrap gap-4">
                <SegmentedControl
                  label="Time frame"
                  value={String(horizon) as `${Horizon}`}
                  onChange={(v) => {
                    setHorizon(Number(v) as Horizon);
                    adjust('horizon');
                  }}
                  options={HORIZONS.map((h) => ({ value: String(h) as `${Horizon}`, label: HORIZON_LABEL[h] }))}
                />
                <SegmentedControl
                  label="Price increases"
                  value={scenarioId}
                  onChange={(v) => {
                    setScenarioId(v);
                    adjust('scenario');
                  }}
                  options={ASSUMPTIONS_V1.escalationScenarios.map((s) => ({ value: s.id as ScenarioId, label: s.annualBps === 0 ? 'None' : `+${s.annualBps / 100}%/yr*` }))}
                />
              </div>
            </div>
            {scenarioId !== 'flat' && <p className="mt-2 text-sm text-pf-muted">* Hypothetical scenario applied to every service, current and alternative — not a prediction.</p>}
            {scenario && atHorizon && (
              <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <CumulativeChart
                  title={`Cumulative difference over ${HORIZON_LABEL[horizon]}`}
                  points={scenario.months.slice(0, horizon).map((m) => ({ month: m.month, cumulativeSavings: m.cumulativeSavings }))}
                  breakEvenMonths={scenario.breakEvenMonths}
                />
                <dl className="grid grid-cols-2 content-start gap-4 text-sm">
                  <div>
                    <dt className="text-pf-subtle">Current services</dt>
                    <dd className="mt-1 text-lg font-semibold text-pf-ink">
                      <Money cents={atHorizon.current} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-pf-subtle">With selected options</dt>
                    <dd className="mt-1 text-lg font-semibold text-pf-ink">
                      <Money cents={atHorizon.proposed} />
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-pf-subtle">Difference</dt>
                    <dd className="mt-1 text-2xl font-bold">
                      <Money cents={atHorizon.savings} kind="savings" />
                    </dd>
                  </div>
                  {analysis.household!.switchingCosts.map((s) => (
                    <div key={s.label} className="col-span-2 text-pf-muted">
                      Includes {s.label.toLowerCase()}: <Money cents={s.amount} />
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Card>

          <Card className="mt-6">
            <BarCompare
              title="Monthly cost by service: now vs. selected option"
              rows={analysis.categories.map((c) => {
                const sel = c.options.find((o) => o.offerId === c.selected);
                return { label: c.label, current: c.currentMonthly ?? 0, alternative: sel ? sel.monthlyPrice : null };
              })}
            />
          </Card>
        </>
      )}

      {/* ---------------------------------------------------- per category */}
      <section aria-labelledby="svc" className="mt-10">
        <h2 id="svc" className="font-display text-2xl font-bold text-pf-ink">
          Service by service
        </h2>
        <div className="mt-4 space-y-6">
          {analysis.categories.map((c) => (
            <CategoryCard
              key={c.category}
              c={c}
              priorities={priorities}
              canSelect={analysis.status === 'complete'}
              onSelect={(v) => {
                setSelections((s) => ({ ...s, [c.category]: v }));
                adjust('selection');
              }}
            />
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- next steps */}
      <ContactPanel
        id={id}
        token={token}
        contacted={data.contacted}
        selections={Object.fromEntries(analysis.categories.map((c) => [c.category, c.selected]))}
        needsAddress={analysis.categories.some((c) => c.options.find((o) => o.offerId === c.selected)?.kind === 'pending_address')}
      />

      {/* ----------------------------------------------------- methodology */}
      <Card className="mt-10">
        <h2 className="font-display text-xl font-bold text-pf-ink">How we calculated this</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-pf-muted">
          {[...analysis.notes.filter((n) => !/regulatory/.test(n)), ...analysis.categories.flatMap((c) => c.notes)].filter((n, i, all) => all.indexOf(n) === i).map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>Amounts are in exact cents; one-time costs (installation, equipment, early cancellation) are counted in the month they happen.</li>
          <li>Tucker may receive compensation from providers. The order options are shown in follows the ranking rules on each service.</li>
        </ul>
        <p className="mt-3 text-xs text-pf-subtle">
          Assumptions {analysis.assumptionsVersion} · Engine {analysis.version}
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, chip }: { label: string; value: React.ReactNode; sub?: React.ReactNode; chip?: ChipStatus }) {
  return (
    <Card as="div" className="!p-4 sm:!p-5">
      <p className="text-sm text-pf-subtle">{label}</p>
      <p className="mt-1 font-display text-lg font-bold leading-snug text-pf-ink sm:text-2xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-pf-muted">{sub}</p>}
      {chip && (
        <p className="mt-2">
          <StatusChip status={chip} />
        </p>
      )}
    </Card>
  );
}

function CategoryCard({ c, priorities, canSelect, onSelect }: { c: CategoryResult; priorities: Set<string>; canSelect: boolean; onSelect: (v: string) => void }) {
  const lensFor = (offerId: string) => c.lenses.filter((l) => l.offerId === offerId);
  return (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-pf-ink">{c.label}</h3>
          <p className="text-sm text-pf-muted">{c.provider || 'Current service'}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-pf-subtle">You pay now</p>
          <p className="text-lg font-semibold">{c.currentMonthly === null ? <span className="text-pf-muted">Not entered</span> : <Money cents={c.currentMonthly} perMonth />}</p>
          <StatusChip status="user_reported" />
        </div>
      </div>

      {(c.insights ?? []).length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl bg-pf-bg p-3 text-sm text-pf-ink">
          {(c.insights ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {!c.comparisonAvailable ? (
        <p className="mt-4 text-sm text-pf-muted">Included in your spending. We don’t compare this service yet.</p>
      ) : c.options.length === 0 && c.category === 'electricity' ? (
        <div className="mt-5">
          <Callout tone={c.solar === 'not_suitable' ? 'info' : 'save'} title={c.solar === 'not_suitable' ? 'Solar probably isn’t a fit' : c.solar === 'needs_info' ? 'We need a little more to check solar' : 'Solar could lower this bill'}>
            <ul className="mt-1 space-y-1">
              {c.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Callout>
          {c.solar !== 'not_suitable' && <ReviewToggle c={c} label="Include a free solar estimate from an advisor" onSelect={onSelect} />}
        </div>
      ) : c.options.length === 0 ? (
        <div className="mt-5">
          <p className="text-sm text-pf-muted">{c.notes.find((n) => /verified prices|alternatives|isn’t available to order/.test(n)) ?? 'No verified prices to compare yet.'}</p>
          <ReviewToggle c={c} label={`Have an advisor look for a better price on my ${c.label.toLowerCase()} bill (free)`} onSelect={onSelect} />
        </div>
      ) : (
        <fieldset className="mt-5" disabled={!canSelect}>
          <legend className="text-sm font-semibold text-pf-ink">Compare options for {c.label}{c.lensKind === 'pending_address' ? ' (if available at your address)' : c.lensKind === 'benchmark' ? ' (illustrative benchmark)' : ''}</legend>
          <div className="mt-3 space-y-3">
            <OptionRow
              id={`opt-${c.category}-keep`}
              name={c.category}
              checked={c.selected === 'keep'}
              onChange={() => onSelect('keep')}
              title={<span className="font-semibold text-pf-ink">Keep my current service</span>}
            />
            {c.options.map((o) => (
              <OptionRow
                key={o.offerId}
                id={`opt-${c.category}-${o.offerId}`}
                name={c.category}
                checked={c.selected === o.offerId}
                onChange={() => onSelect(o.offerId)}
                title={
                  <>
                    <span className="font-semibold text-pf-ink">{o.planName}</span>
                    <span className="text-pf-muted">, </span>
                    <Money cents={o.monthlyPrice} perMonth className="font-semibold text-pf-ink" />
                  </>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={KIND_CHIP[o.kind]} />
                  {o.estimate && <StatusChip status="estimated" />}
                  {/* A "lowest cost" badge only means something when there is more than one option. */}
                  {(c.options.length > 1 ? lensFor(o.offerId) : []).map((l) => (
                    <span key={l.lens} className="rounded-full bg-pf-ink px-2 py-0.5 text-xs font-semibold text-white">
                      {LENS_LABEL[l.lens]}
                      {priorities.has(l.lens) ? ' · your priority' : ''}
                    </span>
                  ))}
                </div>
                {o.candidate.statusReasons[0] && <p className="mt-1 text-xs text-pf-subtle">{o.candidate.statusReasons[0]}</p>}
                {/* Snapshots made before estimates existed have no assumptions field. */}
                {(o.assumptions ?? []).length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-pf-muted">
                    {(o.assumptions ?? []).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-pf-muted">
                  {o.candidate.downloadMbps !== null && <span>{o.candidate.downloadMbps.toLocaleString()} Mbps</span>}
                  <span>
                    5-yr estimate: <Money cents={o.candidate.savingsTotal} kind="savings" />
                  </span>
                  {o.candidate.upfrontSwitchingCost > 0 && (
                    <span>
                      Upfront <Money cents={o.candidate.upfrontSwitchingCost} />
                    </span>
                  )}
                </div>
                {(o.restrictions.length > 0 || o.disclosureUrl) && (
                  <p className="mt-1.5 text-xs text-pf-subtle">
                    {o.restrictions.join(' · ')}
                    {o.disclosureUrl && (
                      <>
                        {' · '}
                        <a href={o.disclosureUrl} target="_blank" rel="noopener" className="relative z-10 underline underline-offset-2">
                          Broadband Facts label
                        </a>
                      </>
                    )}
                  </p>
                )}
              </OptionRow>
            ))}
          </div>
          {c.lenses.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-semibold text-pf-brand">How we rank these</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-pf-muted">
                {c.lenses.map((l) => (
                  <li key={l.lens}>
                    <strong className="text-pf-ink">{LENS_LABEL[l.lens]}:</strong> {l.criteria}
                  </li>
                ))}
                <li>Provider payments are not an input to any ranking.</li>
              </ul>
            </details>
          )}
        </fieldset>
      )}
      {!(c.category === 'electricity' && c.options.length === 0) && c.notes.filter((n) => !/alternatives|verified prices|isn’t available to order/.test(n) && !/don’t compare/.test(n)).length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-pf-muted">
          {c.notes
            .filter((n) => !/alternatives|verified prices|isn’t available to order/.test(n) && !/don’t compare/.test(n))
            .map((n) => (
              <li key={n}>• {n}</li>
            ))}
        </ul>
      )}
    </Card>
  );
}

/** Opt in/out of a free advisor review for a service we can't price-compare yet. */
function ReviewToggle({ c, label, onSelect }: { c: CategoryResult; label: string; onSelect: (v: string) => void }) {
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-pf-line p-4 text-sm font-semibold text-pf-ink has-[:checked]:border-pf-brand has-[:checked]:bg-pf-brand-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pf-brand">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={c.selected === 'review'} onChange={(e) => onSelect(e.target.checked ? 'review' : 'keep')} />
      {label}
    </label>
  );
}

/**
 * A selectable option card. The radio's accessible name is the short title (plan
 * and price); the details are its description. The label's ::after covers the
 * card so the whole card stays clickable, while links inside sit above it.
 */
function OptionRow({ id, name, checked, onChange, title, children }: { id: string; name: string; checked: boolean; onChange: () => void; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div
      className={`relative flex gap-3 rounded-xl border p-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pf-brand ${checked ? 'border-pf-brand bg-pf-brand-soft' : 'border-pf-line'}`}
    >
      <input
        id={id}
        type="radio"
        name={`sel-${name}`}
        checked={checked}
        onChange={onChange}
        aria-describedby={children ? `${id}-d` : undefined}
        className="relative z-10 mt-1 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="cursor-pointer after:absolute after:inset-0 after:rounded-xl after:content-['']">
          {title}
        </label>
        {children && (
          <div id={`${id}-d`} className="mt-1.5">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- conversion --
type Intent = 'callback' | 'appointment' | 'advisor';

function ContactPanel({ id, token, contacted, selections, needsAddress }: { id: string; token: string; contacted: boolean; selections: Selections; needsAddress: boolean }) {
  const [intent, setIntent] = useState<Intent[]>(['appointment']);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', preferredContact: 'phone', street: '', unit: '', city: '' });
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState<{ leadId: string; bookingToken: string; market: string } | null>(null);
  const [result, setResult] = useState<HandoffResult | null>(null);
  // One key for this open form: a retry or double tap can never create a second lead.
  const requestKey = useRef(crypto.randomUUID());
  const started = useRef(false);
  useEffect(() => {
    if (!contacted) track('handoff_cta_view', { from: 'results' });
  }, [contacted]);
  const [done, setDone] = useState<string | null>(contacted ? 'contacted' : null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const firstDone = useRef(done);
  // When the form or slot picker is replaced by the confirmation, move focus to it.
  useEffect(() => {
    if (done && done !== firstDone.current) doneRef.current?.focus();
  }, [done]);

  function edit(k: keyof typeof form, value: string) {
    if (!started.current) {
      started.current = true;
      track('handoff_start', { from: 'results' });
    }
    setForm((f) => ({ ...f, [k]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, consent, marketingConsent: marketing, requestKey: requestKey.current, token, intent: intent[0], sessionId: sessionId(), selections };
    // Validate locally with the same schema the server uses, so errors appear instantly.
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = String(i.path[0] ?? '_');
        fields[k] ??= i.message;
      }
      setErrors({ ...fields, _: 'Please fix the highlighted fields.' });
      track('handoff_error', { kind: 'validation', from: 'results' });
      const first = ['firstName', 'phone', 'email', 'consent'].find((k) => fields[k]);
      if (first) requestAnimationFrame(() => document.getElementById(`pf-contact-${first}`)?.focus());
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const r = await api<HandoffResult>(`/platform/assessments/${encodeURIComponent(id)}/contact`, {
        method: 'POST',
        body,
      });
      track('advisor_request', { intent: intent[0] }, false);
      setResult(r);
      if (intent[0] === 'appointment') setLead(r);
      else setDone(intent[0]);
    } catch (err) {
      // Everything typed stays in place; sending again is safe.
      track('handoff_error', { kind: err instanceof ApiError ? 'server' : 'network', from: 'results' });
      setErrors(err instanceof ApiError ? { ...err.fields, _: err.message } : { _: 'We couldn’t send your request. Check your connection and try again. Nothing you typed was lost.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-10 scroll-mt-4 border-pf-brand" id="next-steps">
      <h2 className="font-display text-2xl font-bold text-pf-ink">{HANDOFF_COPY.cta}</h2>
      <p className="mt-1 text-pf-muted">{HANDOFF_COPY.support} We’ll use the options you selected above.</p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-pf-muted">
        {HANDOFF_COPY.reassurance.map((r) => (
          <li key={r} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pf-save" aria-hidden />
            {r}
          </li>
        ))}
      </ul>
      {done && result && done !== 'booked' ? (
        <div className="mt-4">
          <HandoffDone result={result} contact={form.preferredContact as 'phone' | 'text' | 'email'} phone={form.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')} />
        </div>
      ) : done ? (
        <p ref={doneRef} tabIndex={-1} className="mt-3 text-pf-ink outline-none" role="status">
          {done === 'contacted' ? 'You’ve already asked us to review these results. A representative has your request.' : 'You’re booked. Your time is saved, and your representative has your request.'}
        </p>
      ) : lead ? (
        <SlotPicker lead={lead} onBooked={() => setDone('booked')} />
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-5">
          <ChoiceCards<Intent>
            legend="How can we help?"
            value={intent}
            onChange={setIntent}
            columns={3}
            options={[
              { value: 'appointment', label: 'Schedule a time', description: 'Pick a slot for a free call with an advisor.' },
              { value: 'callback', label: 'Request a callback', description: 'We’ll call you soon.' },
              { value: 'advisor', label: 'Ask a question', description: 'An advisor reaches out your preferred way.' },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ['firstName', 'First name', 'given-name', 'text', false],
                ['lastName', 'Last name', 'family-name', 'text', true],
                ['phone', 'Mobile phone', 'tel', 'tel', false],
                ['email', 'Email', 'email', 'email', true],
              ] as const
            ).map(([k, label, ac, type, optional]) => (
              <Field key={k} label={label} optional={optional} error={errors[k]} id={`pf-contact-${k}`}>
                {(p) => (
                  <TextInput id={p.id} type={type} autoComplete={ac} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={form[k]} onChange={(e) => edit(k, e.target.value)} />
                )}
              </Field>
            ))}
          </div>
          {needsAddress && (
            <fieldset>
              <legend className="text-sm font-semibold text-pf-ink">
                Service address <span className="font-normal text-pf-subtle">(optional)</span>
              </legend>
              <p className="mt-0.5 text-sm text-pf-subtle">Lets us confirm availability at your home before we contact you.</p>
              <div className="mt-2 grid gap-4 sm:grid-cols-[2fr_1fr_1.5fr]">
                {(
                  [
                    ['street', 'Street address', 'address-line1'],
                    ['unit', 'Apt / unit', 'address-line2'],
                    ['city', 'City', 'address-level2'],
                  ] as const
                ).map(([k, label, ac]) => (
                  <Field key={k} label={label} error={errors[k]} id={`pf-contact-${k}`}>
                    {(p) => <TextInput id={p.id} autoComplete={ac} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />}
                  </Field>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-pf-line p-4 text-sm text-pf-muted">
            <input
              id="pf-contact-consent"
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-invalid={!!errors.consent || undefined}
              aria-describedby={errors.consent ? 'pf-contact-consent-err' : undefined}
            />
            <span>{platformConsentText()}</span>
          </label>
          {errors.consent && (
            <p id="pf-contact-consent-err" className="text-sm font-medium text-pf-cost">
              {errors.consent}
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-3 px-4 text-sm text-pf-muted">
            <input id="pf-contact-marketing" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>{marketingConsentText()}</span>
          </label>
          {errors._ && (
            <p role="alert" className="text-sm font-medium text-pf-cost">
              {errors._}
            </p>
          )}
          <Button type="submit" size="lg" loading={busy}>
            {intent[0] === 'appointment' ? 'Continue to pick a time' : HANDOFF_COPY.submit}
          </Button>
          <p className="text-xs text-pf-subtle">We use your details only to help with these results. We don’t sell your information.</p>
        </form>
      )}
    </Card>
  );
}

function SlotPicker({ lead, onBooked }: { lead: { leadId: string; bookingToken: string; market: string }; onBooked: (when: string) => void }) {
  const [dates, setDates] = useState<string[]>([]);
  const [tz, setTz] = useState('America/Detroit');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const introRef = useRef<HTMLParagraphElement>(null);

  // The contact form just unmounted: move focus here so it isn't lost.
  useEffect(() => introRef.current?.focus(), []);
  useEffect(() => {
    api<{ dates: string[]; timezone: string }>(`/schedule/dates?market=${encodeURIComponent(lead.market)}`)
      .then((r) => {
        setLoadError('');
        setDates(r.dates);
        setTz(r.timezone);
        setDate(r.dates[0] ?? '');
      })
      .catch(() => setLoadError('We couldn’t load available times.'));
  }, [lead.market, attempt]);
  useEffect(() => {
    if (!date) return;
    api<{ slots: Slot[] }>(`/schedule/slots?date=${date}&market=${encodeURIComponent(lead.market)}`)
      .then((r) => {
        setLoadError('');
        setSlots(r.slots);
      })
      .catch(() => setLoadError('We couldn’t load available times.'));
  }, [date, lead.market, attempt]);

  async function book() {
    setBusy(true);
    setError('');
    try {
      await api('/appointments', { method: 'POST', body: { leadId: lead.leadId, token: lead.bookingToken, startUtc: selected } });
      track('appointment_booked', {}, false);
      onBooked(selected);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <p ref={introRef} tabIndex={-1} className="text-pf-muted outline-none">
        Pick a time for a free call with an advisor (times in {tz.replace('_', ' ')}).
      </p>
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm font-medium text-pf-cost">
          {loadError}
          <Button
            variant="secondary"
            onClick={() => {
              setSlots(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Choose a date">
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === date}
            onClick={() => {
              // Re-selecting the current date would clear the times without refetching them.
              if (d === date) return;
              setSlots(null);
              setSelected('');
              setDate(d);
            }}
            className={`min-h-11 shrink-0 rounded-xl border px-3 py-2 text-sm font-medium ${d === date ? 'border-pf-brand bg-pf-brand-soft text-pf-ink' : 'border-pf-line text-pf-muted'}`}
          >
            {fmtCalendarDate(d)}
          </button>
        ))}
      </div>
      {loadError ? null : slots === null ? (
        <p className="text-sm text-pf-muted" role="status">
          Loading times…
        </p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-pf-muted">No times left that day — try another date.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="group" aria-label="Choose a time">
          {slots.map((s) => (
            <button
              key={s.startUtc}
              type="button"
              aria-pressed={selected === s.startUtc}
              onClick={() => setSelected(s.startUtc)}
              className={`min-h-11 rounded-xl border text-sm font-medium ${selected === s.startUtc ? 'border-pf-brand bg-pf-brand text-white' : 'border-pf-line text-pf-ink'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-pf-cost">
          {error}
        </p>
      )}
      <Button size="lg" disabled={!selected} loading={busy} onClick={book}>
        {selected ? `Book ${fmtDateTime(selected, tz)}` : 'Select a time'}
      </Button>
    </div>
  );
}
