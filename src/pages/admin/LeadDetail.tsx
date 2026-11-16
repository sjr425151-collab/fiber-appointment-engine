import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LEAD_STATUSES, type Appointment, type Lead, type LeadNote, type LeadStatus } from '../../../shared/schemas';
import { api, fmtDateTime, fmtPhone, STATUS_LABELS } from '../../lib/api';
import { Spinner, StatusBadge } from '../../components/ui';
import { formatCents } from '../../../shared/finance/money';
import { OpportunityPanel, type OpportunityRow } from './Opportunities';

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

interface Detail {
  lead: Lead;
  notes: LeadNote[];
  notifications?: EmailRow[];
  consents?: ConsentRow[];
  assessment?: AssessmentSummary | null;
  opportunities?: OpportunityRow[];
  appointments: Appointment[];
}

export default function LeadDetail() {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Detail>(`/admin/leads/${id}`).then(setD);
  }, [id]);

  async function patch(body: { status?: LeadStatus; note?: string }) {
    setSaving(true);
    try {
      const r = await api<{ lead: Lead; notes: LeadNote[] }>(`/admin/leads/${id}`, { method: 'PATCH', body });
      setD((prev) => prev && { ...prev, ...r });
    } finally {
      setSaving(false);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await patch({ note });
    setNote('');
  }

  if (!d) {
    return (
      <div className="grid place-items-center py-20 text-slate-500">
        <Spinner />
      </div>
    );
  }
  const { lead } = d;
  const rows: [string, string][] = [
    ['Phone', fmtPhone(lead.phone)],
    ['Email', lead.email],
    ['Address', [lead.street, lead.unit, `${lead.city}, MI ${lead.zip}`].filter(Boolean).join(', ')],
    ['Area status', lead.areaStatus],
    ['Prefers', lead.preferredContact],
    ['Current provider', lead.currentProvider || '—'],
    ['Source', [lead.source, lead.utmSource, lead.utmMedium, lead.utmCampaign, lead.utmContent, lead.utmTerm].filter(Boolean).join(' / ')],
    ['Click ID', lead.clickId || '—'],
    ['Referrer', lead.referrer || '—'],
    ['Landing page', lead.landingPage || '—'],
    ['Consent recorded', fmtDateTime(lead.consentAt)],
    ['Created', fmtDateTime(lead.createdAt)],
  ];

  return (
    <div className="space-y-6">
      <Link to="/admin" className="text-sm text-slate-400 hover:text-white">
        ← All leads
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="font-display text-3xl font-bold">
          {lead.firstName} {lead.lastName}
        </h1>
        <StatusBadge status={lead.status} />
        <div className="ml-auto flex gap-2">
          <a href={`tel:${lead.phone}`} className="btn-ghost py-2 text-sm">Call</a>
          <a href={`sms:${lead.phone}`} className="btn-ghost py-2 text-sm">Text</a>
          <a href={`mailto:${lead.email}`} className="btn-ghost py-2 text-sm">Email</a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <div className="glass p-5">
            <dl className="grid grid-cols-[9rem_1fr] gap-y-3 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="break-words text-slate-200">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="glass p-5">
            <h2 className="mb-3 font-semibold">Pipeline stage</h2>
            <div className="flex flex-wrap gap-2">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s}
                  disabled={saving || s === lead.status}
                  onClick={() => patch({ status: s })}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${s === lead.status ? 'border-fiber-400 bg-fiber-400/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/30 hover:text-white'}`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="glass p-5">
            <h2 className="mb-3 font-semibold">Appointments</h2>
            {d.appointments.length === 0 ? (
              <p className="text-sm text-slate-500">No appointments booked.</p>
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
          {!!d.opportunities?.length && (
            <OpportunityPanel
              items={d.opportunities}
              onChange={(o) => {
                setD((prev) => prev && { ...prev, opportunities: prev.opportunities?.map((x) => (x.id === o.id ? o : x)) });
                // The status change is also written to the timeline; refresh notes.
                api<Detail>(`/admin/leads/${id}`).then((r) => setD((prev) => prev && { ...prev, notes: r.notes }));
              }}
            />
          )}
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
              <p className="mt-2 text-xs text-slate-400">Snapshot figures use our default picks; what the customer chose is listed under “What they asked about”.</p>
            </div>
          )}
          {lead.duplicateOf && (
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              Repeat submission — same email and phone as an{' '}
              <Link to={`/admin/leads/${lead.duplicateOf}`} className="underline underline-offset-4">
                earlier lead
              </Link>
              . Confirm who you’re speaking with before changing anything.
            </p>
          )}
          <div className="glass p-5">
            <h2 className="mb-3 font-semibold">Contact consent</h2>
            {!d.consents?.length ? (
              <p className="text-sm text-slate-500">No consent record.</p>
            ) : (
              <ul className="space-y-2 text-xs text-slate-400">
                {d.consents.map((c) => (
                  <li key={c.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <p className="text-slate-300">{fmtDateTime(c.createdAt)} · IP {c.ip || '—'}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer">Consent wording & browser</summary>
                      <p className="mt-1 whitespace-pre-wrap">{c.consentText}</p>
                      <p className="mt-1 break-all">{c.userAgent}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="glass p-5">
            <h2 className="mb-3 font-semibold">Emails</h2>
            {!d.notifications?.length ? (
              <p className="text-sm text-slate-500">No emails for this lead.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.notifications.map((n) => (
                  <li key={n.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>{EMAIL_KIND[n.kind] ?? n.kind}</span>
                      <span className={`capitalize ${EMAIL_STATUS[n.status]}`}>
                        {n.status === 'logged' ? 'not sent (email off)' : n.status === 'pending' ? `scheduled ${fmtDateTime(n.sendAfter)}` : n.status}
                      </span>
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
        </div>

        <div className="glass p-5">
          <h2 className="mb-3 font-semibold">Activity &amp; notes</h2>
          <form onSubmit={addNote} className="mb-5 flex gap-2">
            <input className="input py-2" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            <button className="btn-primary py-2" disabled={saving || !note.trim()}>
              Add
            </button>
          </form>
          <ul className="space-y-3">
            {d.notes.map((n) => (
              <li key={n.id} className="border-l-2 border-white/10 pl-3">
                <p className="whitespace-pre-wrap text-sm text-slate-200">{n.body}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {n.author} · {fmtDateTime(n.createdAt)}
                </p>
              </li>
            ))}
            {d.notes.length === 0 && <li className="text-sm text-slate-500">No activity yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
