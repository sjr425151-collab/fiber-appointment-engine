/** Recording what happened (dispositions) and scheduling the next step (follow-ups). */
import { useState, type FormEvent } from 'react';
import type { Lead } from '../../../../shared/schemas';
import {
  CONTACT_TASKS,
  DISPOSITION_GROUPS,
  DISPOSITION_LABEL,
  managerOnly,
  needsEvidence,
  needsFollowUpTime,
  TASK_KIND_LABEL,
  TASK_KINDS,
  TASK_PRIORITIES,
  type Disposition,
  type TaskKind,
  type TaskPriority,
} from '../../../../shared/team/workspace';
import { api } from '../../../lib/api';
import { errorText, myTz, rid, Sheet, toLocalInput } from './common';
import type { WorkTask } from './types';

export interface FollowUpValue {
  kind: TaskKind;
  title: string;
  due: string;
  priority: TaskPriority;
  notes: string;
}
const at = (hours: number) => toLocalInput(new Date(Date.now() + hours * 3600_000));
const tomorrowAt = (h: number) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, 0, 0, 0);
  return toLocalInput(d);
};
export const emptyFollowUp = (kind: TaskKind = 'call', title = ''): FollowUpValue => ({ kind, title, due: at(24), priority: 'normal', notes: '' });

export function FollowUpFields({ v, onChange, dnc, idPrefix }: { v: FollowUpValue; onChange: (v: FollowUpValue) => void; dnc: boolean; idPrefix: string }) {
  const kinds = TASK_KINDS.filter((k) => !(dnc && CONTACT_TASKS.includes(k)));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${idPrefix}-kind`}>
            Type
          </label>
          <select id={`${idPrefix}-kind`} className="input py-2.5" value={v.kind} onChange={(e) => onChange({ ...v, kind: e.target.value as TaskKind })}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {TASK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-priority`}>
            Priority
          </label>
          <select id={`${idPrefix}-priority`} className="input py-2.5" value={v.priority} onChange={(e) => onChange({ ...v, priority: e.target.value as TaskPriority })}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-due`}>
          When <span className="font-normal text-slate-400">({myTz()})</span>
        </label>
        <input id={`${idPrefix}-due`} type="datetime-local" className="input py-2.5" value={v.due} onChange={(e) => onChange({ ...v, due: e.target.value })} required />
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {(
            [
              ['In 1 hour', at(1)],
              ['In 3 hours', at(3)],
              ['Tomorrow 9am', tomorrowAt(9)],
              ['Tomorrow 2pm', tomorrowAt(14)],
              ['In 3 days', at(72)],
            ] as const
          ).map(([label, val]) => (
            <button key={label} type="button" className="rounded-full border border-white/15 px-3 py-1.5 text-slate-300 hover:border-white/40" onClick={() => onChange({ ...v, due: val })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-title`}>
          Title <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input id={`${idPrefix}-title`} className="input py-2.5" maxLength={120} value={v.title} placeholder={TASK_KIND_LABEL[v.kind]} onChange={(e) => onChange({ ...v, title: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-notes`}>
          Notes <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea id={`${idPrefix}-notes`} className="input min-h-16 py-2" maxLength={1000} value={v.notes} onChange={(e) => onChange({ ...v, notes: e.target.value })} />
      </div>
    </div>
  );
}
export const followUpBody = (v: FollowUpValue) => ({ kind: v.kind, title: v.title.trim() || undefined, dueAt: new Date(v.due).toISOString(), timeZone: myTz(), priority: v.priority, notes: v.notes.trim() });

/** Choose what happened. Fields appear only when a choice needs them. */
export function DispositionSheet({
  lead,
  open,
  onClose,
  onSaved,
  canVerify,
}: {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  onSaved: (r: { lead: Lead; task: WorkTask | null; suggestion: { kind: TaskKind; title: string } | null; code: Disposition }) => void;
  canVerify: boolean;
}) {
  const [code, setCode] = useState<Disposition | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [fu, setFu] = useState<FollowUpValue>(emptyFollowUp());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key, setKey] = useState(rid());
  const reset = () => {
    setCode(null);
    setReason('');
    setEvidence('');
    setWithFollowUp(false);
    setError('');
    setKey(rid());
  };
  const close = () => {
    reset();
    onClose();
  };
  const choose = (c: Disposition) => {
    setCode(c);
    setError('');
    const required = needsFollowUpTime(c);
    setWithFollowUp(required);
    const kind: TaskKind = c === 'consultation_scheduled' ? 'confirm_appointment' : c === 'rep_follow_up' ? 'general' : 'call';
    setFu(emptyFollowUp(lead.doNotContact && CONTACT_TASKS.includes(kind) ? 'general' : kind, c === 'callback_requested' ? 'Call back (customer asked)' : c === 'consultation_scheduled' ? 'Consultation' : ''));
  };
  const quick = (c: Disposition) => !needsEvidence(c) && !needsFollowUpTime(c) && !['not_interested', 'closed_lost', 'not_qualified', 'ineligible', 'do_not_contact'].includes(c);

  async function save(c: Disposition, e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ lead: Lead; task: WorkTask | null; suggestion: { kind: TaskKind; title: string } | null }>(`/admin/leads/${lead.id}/disposition`, {
        method: 'POST',
        body: { code: c, reason: reason.trim(), evidence: evidence.trim(), followUp: withFollowUp ? followUpBody(fu) : undefined, requestId: key },
      });
      onSaved({ ...r, code: c });
      reset();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={code ? DISPOSITION_LABEL[code] : 'What happened?'} open={open} onClose={close} wide>
      {lead.outcome ? (
        <p className="text-sm text-slate-300">This lead is closed. A manager or admin can reopen it from the profile.</p>
      ) : !code ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Tap one. Simple results save straight away; others ask one or two things first.</p>
          {DISPOSITION_GROUPS.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.label}</h3>
              <div className="flex flex-wrap gap-2">
                {g.items.map(([c, label]) => {
                  const locked = managerOnly(c) && !canVerify;
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={busy || locked}
                      title={locked ? 'A manager or admin confirms this' : undefined}
                      onClick={() => (quick(c) ? void save(c) : choose(c))}
                      className={`min-h-11 rounded-xl border px-3.5 text-sm transition disabled:opacity-40 ${lead.disposition === c ? 'border-fiber-400 bg-fiber-400/10 text-white' : 'border-white/15 text-slate-200 hover:border-white/40'}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={(e) => save(code, e)} className="space-y-4">
          {needsEvidence(code) && (
            <div>
              <label className="label" htmlFor="disp-evidence">
                Provider order or confirmation reference
              </label>
              <input id="disp-evidence" className="input py-2.5" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={200} required />
              <p className="mt-1 text-xs text-slate-400">A sale or activation is recorded only with the provider’s own reference.</p>
            </div>
          )}
          {['not_interested', 'closed_lost', 'not_qualified', 'ineligible', 'do_not_contact', 'duplicate', 'invalid_contact', 'spam'].includes(code) && (
            <div>
              <label className="label" htmlFor="disp-reason">
                Reason <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input id="disp-reason" className="input py-2.5" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </div>
          )}
          {code === 'do_not_contact' && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              Calls, texts and contact follow-ups will be blocked for this customer. Only a manager can lift it, with a recorded reason.
            </p>
          )}
          {needsFollowUpTime(code) ? (
            <FollowUpFields v={fu} onChange={setFu} dnc={lead.doNotContact} idPrefix="disp-fu" />
          ) : (
            !['do_not_contact', 'not_interested', 'closed_lost', 'duplicate', 'invalid_contact', 'spam', 'activation_confirmed', 'closed_won'].includes(code) && (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} /> Also schedule a follow-up
                </label>
                {withFollowUp && <FollowUpFields v={fu} onChange={setFu} dnc={lead.doNotContact} idPrefix="disp-fu" />}
              </>
            )
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => setCode(null)}>
              Back
            </button>
            <button className="btn-primary flex-1" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

export function FollowUpSheet({ lead, open, onClose, onSaved, preset }: { lead: Lead; open: boolean; onClose: () => void; onSaved: () => void; preset?: { kind: TaskKind; title: string } | null }) {
  const [v, setV] = useState<FollowUpValue>(emptyFollowUp(preset?.kind ?? (lead.doNotContact ? 'general' : 'call'), preset?.title ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(rid());
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/admin/leads/${lead.id}/tasks`, { method: 'POST', body: { ...followUpBody(v), requestId: key } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Schedule a follow-up" open={open} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <FollowUpFields v={v} onChange={setV} dnc={lead.doNotContact} idPrefix="fu" />
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Schedule'}
        </button>
      </form>
    </Sheet>
  );
}
