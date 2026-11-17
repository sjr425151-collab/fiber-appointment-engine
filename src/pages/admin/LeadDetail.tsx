import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCents } from '../../../shared/finance/money';
import { HANDOFF_COPY, type HandoffPreview } from '../../../shared/platform/handoff';
import type { Appointment, Lead, LeadNote } from '../../../shared/schemas';
import { DISPOSITION_LABEL, OUTCOME_LABEL, type Outcome, type TaskKind } from '../../../shared/team/workspace';
import { api, ApiError, fmtDateTime, fmtPhone, STATUS_LABELS } from '../../lib/api';
import { StatusBadge } from '../../components/ui';
import { ChatTranscript, type TranscriptMessage } from './ChatTranscript';
import { useTeam } from './Layout';
import { OpportunityPanel, type OpportunityRow } from './Opportunities';
import { DispositionSheet, FollowUpSheet } from './work/Actions';
import { ago, DispositionPill, errorText, isPast, myTz, nextInQueue, OutcomePill, Pill, QualificationPill, rememberLead, rid, Sheet, useToast, when } from './work/common';
import { ContactCard, NotesPanel, ServicesPanel, TasksPanel, Timeline } from './work/Panels';
import type { WorkTask, Workspace } from './work/types';

interface EmailRow {
  id: string;
  kind: string;
  status: 'pending' | 'sending' | 'sent' | 'logged' | 'skipped' | 'failed';
  sendAfter: string;
  attempts: number;
  to: string;
  subject: string;
  error: string;
  sentAt: string | null;
}

const EMAIL_KIND: Record<string, string> = {
  team_new_lead: 'Team alert: new lead',
  team_returning_lead: 'Team alert: returning lead',
  team_booking: 'Team alert: booking',
  customer_confirmation: 'Customer: booking confirmation',
  customer_reminder: 'Customer: reminder',
  customer_lead_received: 'Customer: request received',
};
const EMAIL_STATUS: Record<EmailRow['status'], string> = {
  pending: 'text-sky-300',
  sending: 'text-sky-300',
  sent: 'text-emerald-300',
  logged: 'text-amber-300',
  skipped: 'text-slate-400',
  failed: 'text-rose-300',
};

interface AssessmentSummary {
  id: string;
  categories: string[];
  currentMonthlyCents: number | null;
  potentialSavingsCents: number;
  projectionBasis: string;
  includeSamples: boolean;
  createdAt: string;
  analysis: { categories: { label: string; provider: string; currentMonthly: number | null; selected: string; options: { offerId: string; planName: string; kind: string; monthlyPrice: number }[] }[] };
}

const BASIS_LABEL: Record<string, string> = {
  pending_address: 'Real prices · address not yet confirmed',
  verified: 'Verified options',
  sample: 'Includes SAMPLE data (staging)',
  current_only: 'Current spending only',
};

interface ConsentRow {
  id: string;
  consentText: string;
  ip: string;
  userAgent: string;
  createdAt: string;
}

interface HistoryRow {
  id: string;
  kind: 'status' | 'assignment';
  from: string;
  to: string;
  detail: string;
  actor: string;
  createdAt: string;
}

const CATEGORY: Record<string, string> = { internet: 'Home internet', mobile: 'Mobile', tv: 'TV & streaming', electricity: 'Electricity / solar', security: 'Home security', household: 'Whole household' };
const SOURCE: Record<string, string> = { platform_handoff: 'Home page preview', platform_assessment: 'Full savings preview', landing_page: 'Regional internet page', platform_chat: 'Website chat' };
const mo = (c: number | null) => (c === null ? '—' : `${formatCents(c)}/mo`);

/** What the customer saw before asking for help. Always shown with the "not verified" warning. */
function PreviewSummary({ lead }: { lead: Lead }) {
  const p = lead.preview as HandoffPreview | null;
  if (!p?.rows?.length) return null;
  return (
    <div className="glass p-5">
      <h2 className="font-semibold">What they previewed</h2>
      <p role="note" className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
        {HANDOFF_COPY.unverified}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="py-2 pr-3">Service</th>
              <th className="py-2 pr-3">Pays now</th>
              <th className="py-2 pr-3">Compared with</th>
              <th className="py-2">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {p.rows.map((r) => (
              <tr key={r.category}>
                <td className="py-2 pr-3 text-slate-200">
                  {CATEGORY[r.category] ?? r.category}
                  {r.category === 'mobile' && p.mobileLines ? ` (${p.mobileLines} line${p.mobileLines === 1 ? '' : 's'})` : ''}
                </td>
                <td className="py-2 pr-3 text-slate-300">{mo(r.currentMonthlyCents)}</td>
                <td className="py-2 pr-3 text-slate-300">
                  {mo(r.comparisonMonthlyCents)}
                  <div className="text-xs text-slate-400">{r.comparison}</div>
                </td>
                <td className="py-2 text-slate-300">
                  {r.differenceCents === null ? '—' : r.differenceCents > 0 ? `${formatCents(r.differenceCents)}/mo less` : r.differenceCents < 0 ? `${formatCents(-r.differenceCents)}/mo more` : 'None'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-slate-300">
        Stated spending {mo(p.currentMonthlyCents)} · illustrative difference {formatCents(p.monthlyDifferenceCents)}/mo ({formatCents(p.annualDifferenceCents)}/yr)
        {p.source === 'home_preview' && p.ownsHome !== undefined ? ` · ${p.ownsHome ? 'owns their home' : 'did not say they own their home'}` : ''}
      </p>
    </div>
  );
}

interface Detail {
  lead: Lead;
  history?: HistoryRow[];
  representative?: string | null;
  representatives?: { id: string; name: string; accepting: boolean; openLeads: number }[];
  notes: LeadNote[];
  notifications?: EmailRow[];
  consents?: ConsentRow[];
  assessment?: AssessmentSummary | null;
  opportunities?: OpportunityRow[];
  appointments: Appointment[];
  chat?: { sessionId: string; messages: TranscriptMessage[] } | null;
}

const PRIMARY_LABEL: Record<string, string> = { internet: 'Home internet', mobile: 'Mobile', tv: 'TV / streaming', electricity: 'Electricity / solar', security: 'Home security' };

export default function LeadDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const team = useTeam();
  const [d, setD] = useState<Detail | null>(null);
  const [w, setW] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<'disposition' | 'followup' | 'reopen' | 'dnc' | null>(null);
  const [preset, setPreset] = useState<{ kind: TaskKind; title: string } | null>(null);
  const [suggest, setSuggest] = useState<{ kind: TaskKind; title: string } | null>(null);
  const [tab, setTab] = useState<'profile' | 'activity' | 'details'>('profile');
  const [saving, setSaving] = useState(false);
  const { toast, toastNode } = useToast();
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  // Bumping `reloads` fetches the lead again (after any change made here).
  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    Promise.all([api<Detail>(`/admin/leads/${id}`), api<Workspace>(`/admin/leads/${id}/workspace`)])
      .then(([detail, work]) => {
        if (!alive) return;
        setD(detail);
        setW(work);
        setError('');
        rememberLead(id, `${detail.lead.firstName} ${detail.lead.lastName}`.trim());
      })
      .catch(
        (err) =>
          alive &&
          setError(err instanceof ApiError && err.status === 404 ? 'This lead isn’t available to you. It may have been reassigned.' : errorText(err, 'The lead didn’t load. Check your connection and try again.')),
      );
    return () => {
      alive = false;
    };
  }, [id, reloads]);

  // Desktop shortcuts: N note, D disposition, F follow-up (not while typing).
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || sheet) return;
      if (e.key === 'n') {
        e.preventDefault();
        setTab('profile');
        requestAnimationFrame(() => noteRef.current?.focus());
      } else if (e.key === 'd') setSheet('disposition');
      else if (e.key === 'f') setSheet('followup');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [sheet]);

  async function assign(repId: string | null) {
    setSaving(true);
    try {
      await api(`/admin/leads/${id}`, { method: 'PATCH', body: { assignRepId: repId } });
      toast(repId ? 'Lead reassigned. Open follow-ups moved with it.' : 'Returned to the queue');
      load();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  }
  async function taskAction(t: WorkTask, body: object, ok: string) {
    try {
      await api(`/admin/tasks/${t.id}`, { method: 'PATCH', body });
      toast(ok);
      load();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  if (error) {
    return (
      <div className="glass mx-auto max-w-lg p-6 text-center">
        <p role="alert" className="text-slate-200">
          {error}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            className="btn-ghost"
            onClick={() => {
              setError('');
              load();
            }}
          >
            Try again
          </button>
          <Link to="/admin/leads" className="btn-primary">
            Back to leads
          </Link>
        </div>
      </div>
    );
  }
  if (!d || !w) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading lead">
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
        </div>
      </div>
    );
  }
  const lead = w.lead;
  const preview = (lead.preview as HandoffPreview | null) ?? null;
  const primary = preview?.rows?.slice().sort((a, b) => (b.currentMonthlyCents ?? 0) - (a.currentMonthlyCents ?? 0))[0]?.category;
  const canContact = !lead.doNotContact;
  const { next, label: queueLabel } = nextInQueue(lead.id);
  const setLead = (l: Lead) => setW((prev) => prev && { ...prev, lead: l });

  const actions = (
    <>
      {canContact ? (
        <>
          <a href={`tel:${lead.phone}`} className="btn-ghost min-h-11 flex-1 px-3 text-sm sm:flex-none">
            Call
          </a>
          <a href={`sms:${lead.phone}`} className="btn-ghost min-h-11 flex-1 px-3 text-sm sm:flex-none">
            Text
          </a>
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="btn-ghost hidden min-h-11 px-3 text-sm sm:inline-flex">
              Email
            </a>
          )}
        </>
      ) : (
        <span className="flex-1 self-center text-xs text-rose-200 sm:flex-none">Do Not Contact</span>
      )}
      <button
        type="button"
        className="btn-ghost hidden min-h-11 px-3 text-sm sm:inline-flex"
        onClick={() => {
          setTab('profile');
          requestAnimationFrame(() => noteRef.current?.focus());
        }}
      >
        Add note
      </button>
      <button
        type="button"
        className="btn-ghost min-h-11 flex-1 px-3 text-sm sm:flex-none"
        onClick={() => {
          setPreset(null);
          setSheet('followup');
        }}
        disabled={!!lead.outcome}
      >
        Follow-up
      </button>
      <button type="button" className="btn-primary min-h-11 flex-[1.4] px-3 text-sm sm:flex-none" onClick={() => setSheet('disposition')}>
        Update status
      </button>
    </>
  );

  return (
    <div className="space-y-5 pb-24 sm:pb-0">
      {toastNode}
      <div className="flex items-center justify-between gap-3 text-sm">
        <Link to="/admin/leads" className="text-slate-400 hover:text-white">
          ← {queueLabel || 'Leads'}
        </Link>
        {next && (
          <button type="button" className="text-slate-300 hover:text-white" onClick={() => nav(`/admin/leads/${next}`)}>
            Next lead →
          </button>
        )}
      </div>

      {/* Header: who, where they stand, and what happens next. */}
      <header className="glass p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold sm:text-3xl">
              {lead.firstName} {lead.lastName}
              {lead.preferredName && <span className="ml-2 text-base font-normal text-slate-400">“{lead.preferredName}”</span>}
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              <a href={canContact ? `tel:${lead.phone}` : undefined} className={canContact ? 'underline-offset-4 hover:underline' : ''}>
                {fmtPhone(lead.phone)}
              </a>
              {lead.email && ` · ${lead.email}`} · ZIP {lead.zip}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
            <StatusBadge status={lead.status} />
            <DispositionPill code={lead.disposition} />
            <QualificationPill q={lead.qualification} />
            <OutcomePill o={lead.outcome} />
            {lead.doNotContact && <Pill tone="rose">Do Not Contact</Pill>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {(
            [
              ['Lead', lead.id.slice(0, 8)],
              ['Source', SOURCE[lead.source] ?? lead.source],
              ['Owner', d.representative ?? 'Unassigned'],
              ['Created', when(lead.createdAt)],
              ['Last activity', ago(lead.lastActivityAt ?? lead.updatedAt)],
              ['Next follow-up', lead.nextFollowUpAt ? `${when(lead.nextFollowUpAt)}` : 'None scheduled'],
              ['Main service', primary ? (PRIMARY_LABEL[primary] ?? primary) : '—'],
              ['Illustrative savings', preview && preview.monthlyDifferenceCents > 0 ? `${formatCents(preview.monthlyDifferenceCents)}/mo` : '—'],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-slate-400">{k}</dt>
              <dd className={`truncate ${k === 'Next follow-up' && lead.nextFollowUpAt && isPast(lead.nextFollowUpAt) ? 'text-rose-300' : 'text-slate-100'}`}>{v}</dd>
            </div>
          ))}
        </dl>
        {lead.doNotContact && (
          <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
            This customer asked not to be contacted. Calls, texts and contact follow-ups are blocked.
            {w.can.clearDnc && (
              <button type="button" className="ml-2 underline" onClick={() => setSheet('dnc')}>
                Lift with a recorded reason
              </button>
            )}
          </p>
        )}
        {lead.outcome && (
          <p className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
            Closed: {OUTCOME_LABEL[lead.outcome as Outcome] ?? lead.outcome}
            {lead.outcomeAt && ` on ${when(lead.outcomeAt)}`}.
            {w.can.reopen && (
              <button type="button" className="ml-2 underline" onClick={() => setSheet('reopen')}>
                Reopen
              </button>
            )}
          </p>
        )}
        {suggest && !lead.outcome && (
          <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-fiber-400/30 bg-fiber-400/10 p-3 text-sm">
            <span className="text-slate-100">Next step: {suggest.title}?</span>
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm"
              onClick={() => {
                setPreset(suggest);
                setSuggest(null);
                setSheet('followup');
              }}
            >
              Schedule it
            </button>
            <button type="button" className="text-slate-300 underline" onClick={() => setSuggest(null)}>
              Not now
            </button>
          </div>
        )}
        <div className="mt-4 hidden flex-wrap gap-2 sm:flex">{actions}</div>
        <p className="mt-2 hidden text-xs text-slate-400 lg:block">Shortcuts: D update status · F follow-up · N note. Call and Text open your phone’s own apps; nothing is sent or logged automatically.</p>
      </header>

      <div role="tablist" aria-label="Lead sections" className="flex gap-1 rounded-xl bg-white/5 p-1 lg:hidden">
        {(
          [
            ['profile', 'Profile'],
            ['activity', 'Activity'],
            ['details', 'More'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`min-h-11 flex-1 rounded-lg text-sm ${tab === k ? 'bg-white/15 text-white' : 'text-slate-400'}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className={`space-y-5 ${tab === 'profile' ? '' : 'hidden lg:block'}`}>
          <TasksPanel
            tasks={w.tasks}
            disabled={!!lead.outcome}
            onAdd={() => {
              setPreset(null);
              setSheet('followup');
            }}
            onDone={(t) => taskAction(t, { action: 'complete' }, 'Follow-up done')}
            onReschedule={(t, due) => taskAction(t, { action: 'reschedule', dueAt: new Date(due).toISOString(), timeZone: myTz() }, 'Follow-up moved')}
          />
          <NotesPanel
            leadId={lead.id}
            notes={w.notes}
            me={w.me.name}
            canEditAny={w.can.editAnyNote}
            toast={toast}
            composerRef={(el) => (noteRef.current = el)}
            onChange={(notes) => setW((prev) => prev && { ...prev, notes })}
          />
          <ContactCard
            lead={lead}
            toast={toast}
            onSaved={(l) => {
              setLead(l);
              load();
            }}
          />
          <ServicesPanel leadId={lead.id} preview={preview} services={w.services} toast={toast} onSaved={(services) => setW((prev) => prev && { ...prev, services })} />
          <PreviewSummary lead={lead} />
          {d.chat && (
            <div className="glass p-5">
              <h2 className="mb-1 font-semibold">Website chat</h2>
              <p className="mb-3 text-xs text-slate-400">What the customer typed is theirs; assistant lines are the AI. Figures shown to them were illustrative and unverified.</p>
              <ChatTranscript messages={d.chat.messages} />
            </div>
          )}
        </div>

        <div className={`space-y-5 ${tab === 'profile' ? 'hidden lg:block' : ''}`}>
          <div className={tab === 'details' ? 'hidden lg:block' : ''}>
            <Timeline items={w.timeline} />
          </div>
          <div className={`space-y-5 ${tab === 'activity' ? 'hidden lg:block' : ''}`}>
            <div className="glass p-5">
              <h2 className="mb-3 font-semibold">Assigned to</h2>
              {w.can.reassign && w.representatives ? (
                <>
                  <label className="sr-only" htmlFor="lead-assign">
                    Assign this lead
                  </label>
                  <select id="lead-assign" className="input py-2" disabled={saving} value={lead.assignedRepId ?? ''} onChange={(e) => assign(e.target.value || null)}>
                    <option value="">Nobody (follow-up queue)</option>
                    {lead.assignedRepId && !w.representatives.some((r) => r.id === lead.assignedRepId) && <option value={lead.assignedRepId}>{d.representative ?? 'Former representative'} (inactive)</option>}
                    {w.representatives.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · {r.openLeads} open{r.accepting ? '' : ' · not accepting'}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-slate-400">Open follow-ups move to the new owner, who gets a notification.</p>
                </>
              ) : (
                <p className="text-sm text-slate-200">{d.representative ?? 'Nobody yet'}</p>
              )}
              {lead.routingOutcome === 'unsupported' && <p className="mt-2 text-xs text-amber-300">ZIP needs review. Do not tell the customer service is available until it is confirmed.</p>}
            </div>
            {w.duplicates.length > 0 && (
              <div className="glass p-5">
                <h2 className="mb-1 font-semibold">Possible duplicates</h2>
                <p className="mb-3 text-xs text-slate-400">Same phone or email. Shared household numbers are common, so nothing is merged automatically: confirm who you are speaking with.</p>
                <ul className="space-y-2 text-sm">
                  {w.duplicates.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                      <Link to={`/admin/leads/${x.id}`} className="underline-offset-4 hover:underline">
                        {x.name || 'Lead'} · {when(x.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Link>
                      <span className="text-xs text-slate-400">
                        matches {x.matchedOn.join(' + ')} · {STATUS_LABELS[x.status] ?? x.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="glass p-5">
              <h2 className="mb-3 font-semibold">Appointments</h2>
              {d.appointments.length === 0 ? (
                <p className="text-sm text-slate-400">No appointments booked.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.appointments.map((a) => (
                    <li key={a.id} className="flex justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                      <span>{fmtDateTime(a.startUtc)}</span>
                      <span className="capitalize text-slate-400">{a.status.replace('_', ' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!!d.opportunities?.length && <OpportunityPanel items={d.opportunities} onChange={(o) => setD((prev) => prev && { ...prev, opportunities: prev.opportunities?.map((x) => (x.id === o.id ? o : x)) })} />}
            {d.assessment && (
              <div className="glass p-5">
                <h2 className="mb-3 font-semibold">Household assessment</h2>
                <p className="text-sm text-slate-300">
                  {fmtDateTime(d.assessment.createdAt)} · {d.assessment.categories.join(', ')}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-400">Pays now</dt>
                    <dd className="font-semibold">{d.assessment.currentMonthlyCents === null ? 'Incomplete' : `${formatCents(d.assessment.currentMonthlyCents)}/mo`}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Potential savings</dt>
                    <dd className="font-semibold">{formatCents(d.assessment.potentialSavingsCents)}/mo</dd>
                  </div>
                </dl>
                <p className={`mt-2 text-xs ${d.assessment.includeSamples ? 'text-amber-300' : 'text-slate-400'}`}>{BASIS_LABEL[d.assessment.projectionBasis] ?? d.assessment.projectionBasis}</p>
              </div>
            )}
            <div className="glass p-5">
              <h2 className="mb-3 font-semibold">Contact consent</h2>
              {!d.consents?.length ? (
                <p className="text-sm text-slate-400">No consent record.</p>
              ) : (
                <ul className="space-y-2 text-xs text-slate-400">
                  {d.consents.map((c) => (
                    <li key={c.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                      <p className="text-slate-300">
                        {fmtDateTime(c.createdAt)} · IP {c.ip || '—'}
                      </p>
                      <details className="mt-1">
                        <summary className="cursor-pointer">Consent wording & browser</summary>
                        <p className="mt-1 whitespace-pre-wrap">{c.consentText}</p>
                        <p className="mt-1 break-all">{c.userAgent}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-slate-400">Marketing consent: {lead.marketingConsent ? 'yes (optional box ticked)' : 'no'}</p>
            </div>
            <div className="glass p-5">
              <h2 className="mb-3 font-semibold">Emails</h2>
              {!d.notifications?.length ? (
                <p className="text-sm text-slate-400">No emails for this lead.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.notifications.map((n) => (
                    <li key={n.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>{EMAIL_KIND[n.kind] ?? n.kind}</span>
                        <span className={`capitalize ${EMAIL_STATUS[n.status]}`}>{n.status === 'logged' ? 'not sent (email off)' : n.status === 'pending' ? `scheduled ${fmtDateTime(n.sendAfter)}` : n.status}</span>
                      </div>
                      {(n.to || n.sentAt) && (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {n.to}
                          {n.sentAt ? ` · ${fmtDateTime(n.sentAt)}` : ''}
                        </p>
                      )}
                      {n.error && <p className="mt-0.5 text-xs text-slate-400">{n.error}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="glass p-5 text-sm">
              <h2 className="mb-3 font-semibold">Source</h2>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
                {(
                  [
                    ['Campaign', [lead.utmSource, lead.utmMedium, lead.utmCampaign, lead.utmContent, lead.utmTerm].filter(Boolean).join(' / ') || '—'],
                    ['Click ID', lead.clickId || '—'],
                    ['Referrer', lead.referrer || '—'],
                    ['Landing page', lead.landingPage || '—'],
                    ['Lead ID', lead.id],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-400">{k}</dt>
                    <dd className="break-all text-slate-200">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* Phones: the main actions stay under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-white/10 bg-ink-900/95 px-3 pt-2 backdrop-blur sm:hidden" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        {actions}
      </div>

      <DispositionSheet
        lead={lead}
        open={sheet === 'disposition'}
        canVerify={w.can.verifyWins}
        onClose={() => setSheet(null)}
        onSaved={(r) => {
          setLead(r.lead);
          toast(`Saved: ${DISPOSITION_LABEL[r.code]}`);
          if (!r.task && r.suggestion) setSuggest(r.suggestion);
          load();
        }}
      />
      {sheet === 'followup' && (
        <FollowUpSheet
          lead={lead}
          open
          preset={preset}
          onClose={() => setSheet(null)}
          onSaved={() => {
            toast('Follow-up scheduled');
            load();
          }}
        />
      )}
      <ReasonSheet
        open={sheet === 'reopen' || sheet === 'dnc'}
        title={sheet === 'dnc' ? 'Lift Do Not Contact' : 'Reopen this lead'}
        hint={sheet === 'dnc' ? 'Record how the customer gave permission to be contacted again.' : 'Why is this lead being reopened?'}
        onClose={() => setSheet(null)}
        onSubmit={async (reason) => {
          await api(sheet === 'dnc' ? `/admin/leads/${lead.id}/dnc/clear` : `/admin/leads/${lead.id}/reopen`, { method: 'POST', body: { reason, requestId: rid() } });
          toast(sheet === 'dnc' ? 'Do Not Contact lifted' : 'Lead reopened');
          setSheet(null);
          load();
        }}
      />
      {team.role === 'rep' && <span className="sr-only">Signed in as a representative</span>}
    </div>
  );
}

function ReasonSheet({ open, title, hint, onClose, onSubmit }: { open: boolean; title: string; hint: string; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} open={open} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onSubmit(reason);
            setReason('');
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="label" htmlFor="reason-text">
          {hint}
        </label>
        <textarea id="reason-text" className="input min-h-20 py-2" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </form>
    </Sheet>
  );
}
