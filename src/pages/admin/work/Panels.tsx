/** Lead profile panels: contact details, notes, follow-ups, timeline and household services. */
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatCents, parseDollars } from '../../../../shared/finance/money';
import { BEST_TIME_LABEL, BEST_TIMES, type HandoffPreview } from '../../../../shared/platform/handoff';
import { CONTACT_METHODS, type Lead, type LeadNote } from '../../../../shared/schemas';
import { NOTE_CATEGORIES, NOTE_CATEGORY_LABEL, NOTE_TEMPLATE, TASK_KIND_LABEL, type NoteCategory } from '../../../../shared/team/workspace';
import { api, ApiError, fmtPhone } from '../../../lib/api';
import { ago, errorText, isPast, myTz, Pill, rid, toLocalInput, when } from './common';
import type { LeadService, TimelineItem, WorkTask } from './types';

const CONTACT_LABEL: Record<string, string> = { phone: 'Phone call', text: 'Text message', email: 'Email' };

// ------------------------------------------------------------------ contact
type ContactForm = Record<'firstName' | 'lastName' | 'preferredName' | 'phone' | 'email' | 'street' | 'unit' | 'city' | 'zip' | 'preferredContact' | 'bestTime' | 'householdNotes' | 'currentProvider', string>;
const formOf = (l: Lead): ContactForm => ({
  firstName: l.firstName,
  lastName: l.lastName,
  preferredName: l.preferredName,
  phone: l.phone,
  email: l.email,
  street: l.street,
  unit: l.unit,
  city: l.city,
  zip: l.zip,
  preferredContact: l.preferredContact,
  bestTime: l.bestTime || 'anytime',
  householdNotes: l.householdNotes,
  currentProvider: l.currentProvider,
});

/** View, then edit in place. Saving names the version it started from; a newer edit by someone else is never overwritten. */
export function ContactCard({ lead, onSaved, toast }: { lead: Lead; onSaved: (l: Lead) => void; toast: (t: string, tone?: 'ok' | 'error') => void }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<ContactForm>(formOf(lead));
  const [version, setVersion] = useState(lead.version);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(rid());
  const dirty = editing && JSON.stringify(f) !== JSON.stringify(formOf(lead));

  // Unsaved edits: warn before leaving the page.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const base = formOf(lead);
    const changes = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== base[k as keyof ContactForm]));
    try {
      const r = await api<{ lead: Lead; changed: string[] }>(`/admin/leads/${lead.id}/contact`, { method: 'PATCH', body: { version, requestId: key, ...changes } });
      setEditing(false);
      setConflict(null);
      setKey(rid());
      onSaved(r.lead);
      toast(r.changed.length ? 'Contact details saved' : 'Nothing changed');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Show what the other person saved; the form keeps this person's edits.
        const res = await api<{ lead: Lead }>(`/admin/leads/${lead.id}`).catch(() => null);
        setConflict(res?.lead ?? null);
      } else if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  const cancel = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    setEditing(false);
    setConflict(null);
    setErrors({});
  };

  const field = (k: keyof ContactForm, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`c-${k}`}>
        {label}
      </label>
      <input id={`c-${k}`} className="input py-2.5" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-invalid={!!errors[k]} {...props} />
      {errors[k] && <p className="field-error">{errors[k]}</p>}
    </div>
  );

  if (!editing) {
    const rows: [string, string][] = [
      ['Name', [lead.firstName, lead.lastName].filter(Boolean).join(' ') + (lead.preferredName ? ` (goes by ${lead.preferredName})` : '')],
      ['Phone', fmtPhone(lead.phone)],
      ['Email', lead.email || 'Not given'],
      ['Address', [lead.street, lead.unit, lead.city, lead.zip].filter(Boolean).join(', ') || lead.zip],
      [
        'Prefers',
        `${CONTACT_LABEL[lead.preferredContact] ?? lead.preferredContact}${lead.bestTime && lead.bestTime !== 'anytime' ? `, ${BEST_TIME_LABEL[lead.bestTime as keyof typeof BEST_TIME_LABEL] ?? lead.bestTime}` : ''}`,
      ],
      ['Current provider', lead.currentProvider || '—'],
      ['Household notes', lead.householdNotes || '—'],
    ];
    return (
      <section className="glass p-5" aria-labelledby="contact-h">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="contact-h" className="font-semibold">
            Contact information
          </h2>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-sm"
            onClick={() => {
              // Start from the lead as it is now, and remember which version the edit began from.
              setF(formOf(lead));
              setVersion(lead.version);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
        <dl className="grid grid-cols-[8.5rem_1fr] gap-y-2.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-400">{k}</dt>
              <dd className="whitespace-pre-wrap break-words text-slate-100">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-400">Last changed {ago(lead.updatedAt)}</p>
      </section>
    );
  }
  return (
    <section className="glass p-5" aria-labelledby="contact-h">
      <h2 id="contact-h" className="mb-3 font-semibold">
        Edit contact information
      </h2>
      {conflict && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          <p className="font-semibold">Someone else saved changes while you were editing.</p>
          <p className="mt-1">
            Their version: {conflict.firstName} {conflict.lastName} · {fmtPhone(conflict.phone)} · {conflict.email || 'no email'} · {conflict.zip}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-sm"
              onClick={() => {
                // Keep my edits on top of their version and allow saving again.
                setVersion(conflict.version);
                onSaved(conflict);
                setConflict(null);
              }}
            >
              Keep my edits and save over theirs
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-sm"
              onClick={() => {
                onSaved(conflict);
                setF(formOf(conflict));
                setVersion(conflict.version);
                setConflict(null);
              }}
            >
              Use their version
            </button>
          </div>
        </div>
      )}
      <form onSubmit={save} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('firstName', 'First name', { autoComplete: 'off' })}
          {field('lastName', 'Last name')}
          {field('preferredName', 'Preferred name')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('phone', 'Phone', { type: 'tel', inputMode: 'tel' })}
          {field('email', 'Email', { type: 'email' })}
        </div>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          {field('street', 'Street')}
          {field('unit', 'Unit')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('city', 'City')}
          {field('zip', 'ZIP code', { inputMode: 'numeric', maxLength: 5 })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="c-pc">
              Contact by
            </label>
            <select id="c-pc" className="input py-2.5" value={f.preferredContact} onChange={(e) => setF({ ...f, preferredContact: e.target.value })}>
              {CONTACT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CONTACT_LABEL[m] ?? m}
                </option>
              ))}
            </select>
            {errors.email && f.preferredContact === 'email' && <p className="field-error">{errors.email}</p>}
          </div>
          <div>
            <label className="label" htmlFor="c-bt">
              Best time
            </label>
            <select id="c-bt" className="input py-2.5" value={f.bestTime} onChange={(e) => setF({ ...f, bestTime: e.target.value })}>
              {BEST_TIMES.map((t) => (
                <option key={t} value={t}>
                  {BEST_TIME_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          {field('currentProvider', 'Current provider')}
        </div>
        <div>
          <label className="label" htmlFor="c-hn">
            Household notes
          </label>
          <textarea id="c-hn" className="input min-h-20 py-2" maxLength={2000} value={f.householdNotes} onChange={(e) => setF({ ...f, householdNotes: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={cancel}>
            Cancel
          </button>
          <button className="btn-primary flex-1" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

// -------------------------------------------------------------------- notes
export function NotesPanel({
  leadId,
  notes,
  me,
  canEditAny,
  onChange,
  toast,
  composerRef,
}: {
  leadId: string;
  notes: LeadNote[];
  me: string;
  canEditAny: boolean;
  onChange: (n: LeadNote[]) => void;
  toast: (t: string, tone?: 'ok' | 'error') => void;
  composerRef?: (el: HTMLTextAreaElement | null) => void;
}) {
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<NoteCategory>('general');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(rid());
  const [q, setQ] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const [edit, setEdit] = useState<{ id: string; body: string; category: string } | null>(null);

  async function add(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ notes: LeadNote[] }>(`/admin/leads/${leadId}/notes`, { method: 'POST', body: { body, category, pinned, requestId: key } });
      onChange(r.notes);
      setBody('');
      setPinned(false);
      setKey(rid());
      toast('Note saved');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function patch(id: string, b: object) {
    try {
      const r = await api<{ notes: LeadNote[] }>(`/admin/notes/${id}`, { method: 'PATCH', body: b });
      onChange(r.notes);
      return true;
    } catch (err) {
      toast(errorText(err), 'error');
      return false;
    }
  }
  async function archive(id: string) {
    if (!window.confirm('Archive this note? It leaves this list but stays in the activity history.')) return;
    try {
      onChange((await api<{ notes: LeadNote[] }>(`/admin/notes/${id}/archive`, { method: 'POST' })).notes);
      toast('Note archived');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = notes.filter((n) => !term || n.body.toLowerCase().includes(term) || n.author.toLowerCase().includes(term));
    const sorted = [...list].sort((a, b) => (newestFirst ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
    return [...sorted.filter((n) => n.pinned), ...sorted.filter((n) => !n.pinned)];
  }, [notes, q, newestFirst]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add();
  };

  return (
    <section className="glass p-5" aria-labelledby="notes-h">
      <h2 id="notes-h" className="mb-3 font-semibold">
        Notes <span className="text-xs font-normal text-slate-400">· internal, never sent to the customer</span>
      </h2>
      <form onSubmit={add} className="space-y-2">
        <label className="sr-only" htmlFor="note-body">
          New note
        </label>
        <textarea
          id="note-body"
          ref={composerRef}
          className="input min-h-24 py-2"
          placeholder="Add a note… (Ctrl+Enter to save)"
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="note-cat">
            Category
          </label>
          <select id="note-cat" className="input w-auto py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as NoteCategory)}>
            {NOTE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {NOTE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => setBody((b) => (b ? `${b}\n${NOTE_TEMPLATE}` : NOTE_TEMPLATE))}>
            Use template
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin
          </label>
          <button className="btn-primary ml-auto px-4 py-2 text-sm" disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="note-search">
          Search notes
        </label>
        <input id="note-search" className="input flex-1 py-2 text-sm" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => setNewestFirst(!newestFirst)}>
          {newestFirst ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
      <ul className="mt-3 space-y-3">
        {shown.map((n) => {
          const mineOrManager = canEditAny || n.author === me;
          return (
            <li key={n.id} className={`rounded-xl border p-3 ${n.pinned ? 'border-amber-400/30 bg-amber-400/5' : 'border-white/10'}`}>
              {edit?.id === n.id ? (
                <form
                  className="space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await patch(n.id, { body: edit.body, category: edit.category })) {
                      setEdit(null);
                      toast('Note updated');
                    }
                  }}
                >
                  <label className="sr-only" htmlFor={`edit-${n.id}`}>
                    Edit note
                  </label>
                  <textarea id={`edit-${n.id}`} className="input min-h-20 py-2" value={edit.body} maxLength={4000} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
                  <div className="flex gap-2">
                    <select aria-label="Category" className="input w-auto py-2 text-sm" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                      {NOTE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {NOTE_CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn-ghost ml-auto px-3 py-2 text-sm" onClick={() => setEdit(null)}>
                      Cancel
                    </button>
                    <button className="btn-primary px-3 py-2 text-sm">Save</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {n.pinned && <Pill tone="amber">Pinned</Pill>}
                    <Pill>{NOTE_CATEGORY_LABEL[n.category as NoteCategory] ?? n.category}</Pill>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-100">{n.body}</p>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {n.author} · {when(n.createdAt)}
                    {n.editedAt && ` · edited ${when(n.editedAt)}${n.editedBy && n.editedBy !== n.author ? ` by ${n.editedBy}` : ''}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button type="button" className="text-slate-300 underline-offset-2 hover:underline" onClick={() => patch(n.id, { pinned: !n.pinned })}>
                      {n.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    {mineOrManager && (
                      <>
                        <button type="button" className="text-slate-300 underline-offset-2 hover:underline" onClick={() => setEdit({ id: n.id, body: n.body, category: n.category })}>
                          Edit
                        </button>
                        <button type="button" className="text-slate-300 underline-offset-2 hover:underline" onClick={() => archive(n.id)}>
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="text-sm text-slate-400">{q ? 'No notes match.' : 'No notes yet. Notes are internal and never sent to the customer.'}</li>}
      </ul>
    </section>
  );
}

// -------------------------------------------------------------------- tasks
export function TasksPanel({
  tasks,
  onDone,
  onReschedule,
  onAdd,
  disabled,
}: {
  tasks: WorkTask[];
  onDone: (t: WorkTask) => void;
  onReschedule: (t: WorkTask, dueLocal: string) => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  const open = tasks.filter((t) => !t.doneAt);
  const done = tasks.filter((t) => t.doneAt).slice(0, 5);
  const [moving, setMoving] = useState<string | null>(null);
  const [due, setDue] = useState('');
  return (
    <section className="glass p-5" aria-labelledby="tasks-h">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="tasks-h" className="font-semibold">
          Follow-ups
        </h2>
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={onAdd} disabled={disabled}>
          Add
        </button>
      </div>
      <ul className="space-y-2">
        {open.map((t) => {
          const overdue = isPast(t.dueAt);
          return (
            <li key={t.id} className={`rounded-xl border p-3 text-sm ${overdue ? 'border-rose-400/40 bg-rose-500/5' : 'border-white/10'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-100">{t.title}</span>
                {t.priority === 'high' && <Pill tone="rose">High</Pill>}
                {overdue && <Pill tone="rose">Overdue</Pill>}
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {TASK_KIND_LABEL[t.kind]} · {when(t.dueAt)} ({ago(t.dueAt)})
              </p>
              {t.notes && <p className="mt-1 text-xs text-slate-300">{t.notes}</p>}
              {moving === t.id ? (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onReschedule(t, due);
                    setMoving(null);
                  }}
                >
                  <label className="sr-only" htmlFor={`due-${t.id}`}>
                    New time
                  </label>
                  <input id={`due-${t.id}`} type="datetime-local" className="input flex-1 py-2 text-sm" value={due} onChange={(e) => setDue(e.target.value)} required />
                  <button className="btn-primary px-3 py-2 text-sm">Move</button>
                </form>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn-primary min-h-10 px-3 py-1.5 text-sm" onClick={() => onDone(t)}>
                    Done
                  </button>
                  <button
                    type="button"
                    className="btn-ghost min-h-10 px-3 py-1.5 text-sm"
                    onClick={() => {
                      setMoving(t.id);
                      setDue(toLocalInput(new Date(Math.max(Date.now() + 3600_000, new Date(t.dueAt).getTime()))));
                    }}
                  >
                    Reschedule
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {open.length === 0 && <li className="text-sm text-slate-400">No open follow-ups. Schedule the next step so this lead doesn’t go quiet.</li>}
      </ul>
      {done.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-slate-400">Completed ({done.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {done.map((t) => (
              <li key={t.id}>
                ✓ {t.title} · {when(t.doneAt!)} by {t.doneBy}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-xs text-slate-400">Times shown in {myTz()}.</p>
    </section>
  );
}

// ----------------------------------------------------------------- timeline
const TYPES: [string, string][] = [
  ['all', 'All'],
  ['disposition', 'Dispositions'],
  ['note', 'Notes'],
  ['task', 'Follow-ups'],
  ['contact', 'Contact changes'],
  ['status', 'Stage'],
  ['assignment', 'Assignment'],
  ['system', 'System'],
];
const ICON: Record<string, string> = { created: '✦', status: '➜', assignment: '👤', disposition: '☎', contact: '✎', note: '🗒', task: '⏰', service: '🏠', chat: '💬', system: '⚙', reopen: '↺', dnc: '⛔' };
export function Timeline({ items }: { items: TimelineItem[] }) {
  const [type, setType] = useState('all');
  const shown = items.filter((i) => type === 'all' || i.type === type || (type === 'system' && i.system));
  return (
    <section className="glass p-5" aria-labelledby="tl-h">
      <h2 id="tl-h" className="mb-3 font-semibold">
        Activity
      </h2>
      <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter activity">
        {TYPES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={type === id}
            onClick={() => setType(id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${type === id ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="relative space-y-4 border-l border-white/10 pl-5">
        {shown.map((i) => (
          <li key={i.id} className="relative">
            <span aria-hidden className={`absolute -left-[1.95rem] grid h-6 w-6 place-items-center rounded-full text-xs ${i.system ? 'bg-white/5 text-slate-400' : 'bg-fiber-400/20 text-fiber-200'}`}>
              {ICON[i.type] ?? '•'}
            </span>
            <p className="text-sm font-medium text-slate-100">{i.title}</p>
            <p className="text-xs text-slate-400">
              {i.system ? 'System' : i.actor} · {when(i.at)}
            </p>
            <TimelineDetail item={i} />
          </li>
        ))}
        {shown.length === 0 && <li className="text-sm text-slate-400">Nothing of this type yet.</li>}
      </ol>
    </section>
  );
}
function TimelineDetail({ item }: { item: TimelineItem }) {
  const d = item.detail;
  if (!d) return null;
  const lines: string[] = [];
  if (typeof d.body === 'string') lines.push(d.body);
  if (typeof d.reason === 'string') lines.push(`Reason: ${d.reason}`);
  if (typeof d.evidence === 'string') lines.push(`Reference: ${d.evidence}`);
  if (typeof d.note === 'string') lines.push(d.note);
  if (typeof d.dueAt === 'string' && item.type === 'task') lines.push(`Due ${when(d.dueAt)}`);
  if (typeof d.before === 'string') lines.push(`Before: ${d.before}`);
  if (typeof d.detail === 'string') lines.push(d.detail);
  if (d.changes && item.type === 'contact') for (const [k, v] of Object.entries(d.changes as Record<string, { from: string; to: string }>)) lines.push(`${k}: “${v.from || '—'}” → “${v.to || '—'}”`);
  if (!lines.length) return null;
  const long = lines.join('\n').length > 160;
  const text = <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{lines.join('\n')}</p>;
  return long ? (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-slate-400">Details</summary>
      {text}
    </details>
  ) : (
    text
  );
}

// ----------------------------------------------------------------- services
const SERVICES = [
  ['internet', 'Internet'],
  ['mobile', 'Mobile'],
  ['tv', 'TV / streaming'],
  ['electricity', 'Electricity / solar'],
  ['security', 'Home security'],
] as const;
export function ServicesPanel({
  leadId,
  preview,
  services,
  onSaved,
  toast,
}: {
  leadId: string;
  preview: HandoffPreview | null;
  services: LeadService[];
  onSaved: (s: LeadService[]) => void;
  toast: (t: string, tone?: 'ok' | 'error') => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = preview?.rows ?? [];
  const mentioned = new Set([...rows.map((r) => r.category), ...services.map((s) => s.category)]);
  return (
    <section className="glass p-5" aria-labelledby="svc-h">
      <h2 id="svc-h" className="mb-1 font-semibold">
        Household services
      </h2>
      <p className="mb-3 text-xs text-slate-400">“Customer said” is what they typed. “Illustrative” is Tucker’s benchmark comparison from that moment: never a quote. Your entries are labelled as recorded by the team.</p>
      <div className="space-y-2">
        {SERVICES.map(([cat, label]) => {
          const row = rows.find((r) => r.category === cat);
          const s = services.find((x) => x.category === cat);
          const isOpen = open === cat;
          return (
            <div key={cat} className={`rounded-xl border ${mentioned.has(cat) ? 'border-white/15' : 'border-white/5'}`}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : cat)}>
                <span className="font-medium text-slate-100">{label}</span>
                <span className="text-xs text-slate-400">
                  {row && row.currentMonthlyCents !== null ? `Customer said ${formatCents(row.currentMonthlyCents)}/mo` : mentioned.has(cat) ? 'Recorded' : 'Not discussed'}
                  {row && (row.differenceCents ?? 0) > 0 ? ` · illustrative ${formatCents(row.differenceCents ?? 0)}/mo less` : ''}
                </span>
              </button>
              {isOpen && <ServiceEditor leadId={leadId} category={cat} row={row ?? null} svc={s ?? null} onSaved={onSaved} toast={toast} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
function ServiceEditor({
  leadId,
  category,
  row,
  svc,
  onSaved,
  toast,
}: {
  leadId: string;
  category: string;
  row: HandoffPreview['rows'][number] | null;
  svc: LeadService | null;
  onSaved: (s: LeadService[]) => void;
  toast: (t: string, tone?: 'ok' | 'error') => void;
}) {
  const d = (svc?.details ?? {}) as Record<string, string | number | boolean | undefined>;
  const [f, setF] = useState({
    provider: svc?.provider ?? '',
    monthly: svc?.monthlyCents != null ? (svc.monthlyCents / 100).toFixed(2) : '',
    plan: svc?.plan ?? '',
    concerns: svc?.concerns ?? '',
    lines: d.lines != null ? String(d.lines) : '',
    device: d.devicePaymentsCents != null ? ((d.devicePaymentsCents as number) / 100).toFixed(2) : '',
    mustHave: (d.mustHave as string) ?? '',
    services: (d.services as string) ?? '',
    usageKwh: d.usageKwh != null ? String(d.usageKwh) : '',
    ownsHome: d.ownsHome === undefined ? '' : d.ownsHome ? 'yes' : 'no',
    solarInterest: (d.solarInterest as string) ?? '',
    qualificationNotes: (d.qualificationNotes as string) ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`s-${category}-${k}`}>
        {label}
      </label>
      <input id={`s-${category}-${k}`} className="input py-2" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const cents = (v: string) => (v.trim() ? parseDollars(v) : null);
    const monthly = cents(f.monthly);
    if (f.monthly.trim() && monthly === null) return setErr('Enter the monthly amount in dollars, like 95 or 95.50.');
    const details: Record<string, unknown> = {};
    if (category === 'mobile') {
      if (f.lines) details.lines = Number(f.lines);
      const dev = cents(f.device);
      if (dev !== null) details.devicePaymentsCents = dev;
    }
    if (category === 'tv') {
      if (f.mustHave) details.mustHave = f.mustHave;
      if (f.services) details.services = f.services;
    }
    if (category === 'electricity') {
      if (f.usageKwh) details.usageKwh = Number(f.usageKwh);
      if (f.ownsHome) details.ownsHome = f.ownsHome === 'yes';
      details.solarInterest = f.solarInterest;
    }
    if (f.qualificationNotes) details.qualificationNotes = f.qualificationNotes;
    setBusy(true);
    try {
      const r = await api<{ services: LeadService[] }>(`/admin/leads/${leadId}/services/${category}`, {
        method: 'PUT',
        body: { provider: f.provider, monthlyCents: monthly, plan: f.plan, concerns: f.concerns, details },
      });
      onSaved(r.services);
      toast('Service details saved');
    } catch (error) {
      setErr(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 border-t border-white/10 px-4 pb-4 pt-3 text-sm">
      {row ? (
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-white/[0.03] p-3 text-xs">
          <div>
            <dt className="text-slate-400">Customer said</dt>
            <dd className="text-slate-100">{row.currentMonthlyCents !== null ? `${formatCents(row.currentMonthlyCents)}/mo` : '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Illustrative</dt>
            <dd className="text-slate-100">{row.comparisonMonthlyCents !== null ? `${formatCents(row.comparisonMonthlyCents)}/mo` : 'Not compared'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Potential</dt>
            <dd className={(row.differenceCents ?? 0) < 0 ? 'text-amber-200' : 'text-emerald-300'}>
              {row.differenceCents === null ? '—' : row.differenceCents < 0 ? `${formatCents(-row.differenceCents)} more` : `${formatCents(row.differenceCents)} less`}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-xs text-slate-400">The customer did not give this bill in the preview.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {input('provider', category === 'mobile' ? 'Carrier' : 'Provider')}
        {input('monthly', 'Monthly cost ($)', { inputMode: 'decimal' })}
        {input('plan', category === 'internet' ? 'Plan / speed' : 'Plan')}
      </div>
      {category === 'mobile' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {input('lines', 'Lines', { inputMode: 'numeric' })}
          {input('device', 'Device payments ($/mo)', { inputMode: 'decimal' })}
        </div>
      )}
      {category === 'tv' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {input('services', 'Current services')}
          {input('mustHave', 'Must-have channels or apps')}
        </div>
      )}
      {category === 'electricity' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {input('usageKwh', 'Average use (kWh/mo)', { inputMode: 'numeric' })}
          <div>
            <label className="label" htmlFor={`s-${category}-own`}>
              Owns home
            </label>
            <select id={`s-${category}-own`} className="input py-2" value={f.ownsHome} onChange={(e) => setF({ ...f, ownsHome: e.target.value })}>
              <option value="">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`s-${category}-solar`}>
              Solar interest
            </label>
            <select id={`s-${category}-solar`} className="input py-2" value={f.solarInterest} onChange={(e) => setF({ ...f, solarInterest: e.target.value })}>
              <option value="">Not asked</option>
              <option value="yes">Interested</option>
              <option value="maybe">Maybe</option>
              <option value="no">Not interested</option>
            </select>
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`s-${category}-concerns`}>
            Customer concerns
          </label>
          <textarea id={`s-${category}-concerns`} className="input min-h-16 py-2" maxLength={1000} value={f.concerns} onChange={(e) => setF({ ...f, concerns: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`s-${category}-qual`}>
            Qualification notes
          </label>
          <textarea id={`s-${category}-qual`} className="input min-h-16 py-2" maxLength={500} value={f.qualificationNotes} onChange={(e) => setF({ ...f, qualificationNotes: e.target.value })} />
        </div>
      </div>
      {err && (
        <p role="alert" className="field-error">
          {err}
        </p>
      )}
      <div className="flex items-center gap-3">
        {svc && (
          <p className="text-xs text-slate-400">
            Recorded by {svc.updatedBy}, {when(svc.updatedAt)}
          </p>
        )}
        <button className="btn-primary ml-auto px-4 py-2 text-sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
