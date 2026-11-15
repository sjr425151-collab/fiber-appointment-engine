import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LEAD_STATUSES, type Appointment, type Lead, type LeadNote, type LeadStatus } from '../../../shared/schemas';
import { api, fmtDateTime, fmtPhone, STATUS_LABELS } from '../../lib/api';
import { Spinner, StatusBadge } from '../../components/ui';

interface Detail {
  lead: Lead;
  notes: LeadNote[];
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
