import { cloneElement, isValidElement, useId, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { MONROE, PRICING_PRESETS, PRICING_PRESETS_DATE, type Market, type Plan } from '../../../shared/market';
import { api, ApiError } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { useAdminMarkets } from './useMarkets';

const TIMEZONES = [
  ['America/New_York', 'Eastern'],
  ['America/Detroit', 'Eastern (Michigan)'],
  ['America/Indiana/Indianapolis', 'Eastern (Indiana)'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Mountain (Arizona)'],
  ['America/Los_Angeles', 'Pacific'],
  ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii'],
] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A blank location pre-filled with sensible defaults (copied from the launch market's schedule). */
const blank = (): Market => ({
  ...MONROE,
  slug: '',
  name: '',
  region: '',
  areaNote: '',
  phoneDisplay: MONROE.phoneDisplay,
  phoneE164: MONROE.phoneE164,
  // New locations start from the standard Omni Fiber prices and inclusions.
  plans: PRICING_PRESETS[0].plans,
  plansVerifiedOn: PRICING_PRESETS_DATE,
  ogImage: '',
  isDefault: false,
  active: false, // new locations start hidden until they're reviewed
});

const toE164 = (display: string) => {
  const d = display.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `+1${d}` : '';
};
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="space-y-4 border-t border-white/10 pt-5">
      <legend className="pr-2 font-semibold">{title}</legend>
      {hint && <p className="-mt-2 text-sm text-slate-400">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Labelled field: wires <label for> to the single form control passed as children. */
function F({ label, error, children, wide, hint }: { label: string; error?: string; children: ReactElement; wide?: boolean; hint?: string }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-invalid': !!error || undefined, 'aria-describedby': error ? `${id}-err` : undefined })
    : children;
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {control}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && (
        <span id={`${id}-err`} className="field-error block">
          {error}
        </span>
      )}
    </div>
  );
}

function Editor({ initial, isNew, onSaved, onCancel }: { initial: Market; isNew: boolean; onSaved: () => void; onCancel: () => void }) {
  const [m, setM] = useState<Market>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Market>(k: K, v: Market[K]) => setM((x) => ({ ...x, [k]: v }));
  const setSchedule = <K extends keyof Market['schedule']>(k: K, v: Market['schedule'][K]) => setM((x) => ({ ...x, schedule: { ...x.schedule, [k]: v } }));
  const setPlan = (i: number, patch: Partial<Plan>) => setM((x) => ({ ...x, plans: x.plans.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const err = (k: string) => errors[k];

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg('');
    try {
      const body = { ...m, plans: m.plans.map((p) => ({ ...p, highlights: p.highlights.map((h) => h.trim()).filter(Boolean) })) };
      await api(isNew ? '/admin/markets' : `/admin/markets/${m.slug}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved();
    } catch (ex) {
      if (ex instanceof ApiError) {
        setErrors(ex.fields);
        setMsg(ex.message);
      } else setMsg('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="glass space-y-6 p-5 sm:p-6" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold">{isNew ? 'Add a location' : `Edit ${initial.name}, ${initial.state}`}</h2>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost py-2 text-sm" onClick={onCancel}>Cancel</button>
          <button className="btn-primary py-2 text-sm" disabled={busy}>{busy ? <Spinner /> : 'Save location'}</button>
        </div>
      </div>
      {msg && <p className="field-error" role="alert">{msg}</p>}

      <Section title="Location">
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="City / area name" error={err('name')}>
            <input className="input" value={m.name} onChange={(e) => { set('name', e.target.value); if (isNew) set('slug', slugify(e.target.value)); }} placeholder="Toledo" />
          </F>
          <F label="State (2 letters)" error={err('state')}>
            <input className="input uppercase" maxLength={2} value={m.state} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="OH" />
          </F>
          <F label="Page URL" error={err('slug')} hint={isNew ? `Page address: /${m.slug || 'city-name'}` : 'URLs are permanent once created.'}>
            <input className="input" value={m.slug} disabled={!isNew} onChange={(e) => set('slug', slugify(e.target.value))} placeholder="toledo" />
          </F>
          <F label="Region (optional)" error={err('region')}>
            <input className="input" value={m.region} onChange={(e) => set('region', e.target.value)} placeholder="Lucas County" />
          </F>
          <F label="Coverage note under the ZIP form" error={err('areaNote')} wide>
            <input className="input" value={m.areaNote} onChange={(e) => set('areaNote', e.target.value)} placeholder="Toledo (43604, 43606) and surrounding communities." />
          </F>
          <F label="Timezone" error={err('timezone')}>
            <select className="input" value={m.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l} — {v}</option>)}
            </select>
          </F>
        </div>
      </Section>

      <Section title="Provider & contact" hint="Official provider links are shown to visitors for exact-address checks and FCC Broadband Facts labels.">
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Internet provider" error={err('provider')}>
            <input className="input" value={m.provider} onChange={(e) => set('provider', e.target.value)} placeholder="Omni Fiber" />
          </F>
          <F label="Team phone (call & text)" error={err('phoneE164') || err('phoneDisplay')}>
            <input className="input" value={m.phoneDisplay} onChange={(e) => setM((x) => ({ ...x, phoneDisplay: e.target.value, phoneE164: toE164(e.target.value) }))} placeholder="(734) 731-1946" />
          </F>
          <F label="Provider availability checker URL" error={err('availabilityUrl')}>
            <input className="input" type="url" value={m.availabilityUrl} onChange={(e) => set('availabilityUrl', e.target.value)} placeholder="https://…" />
          </F>
          <F label="Broadband Facts labels URL" error={err('broadbandLabelsUrl')}>
            <input className="input" type="url" value={m.broadbandLabelsUrl} onChange={(e) => set('broadbandLabelsUrl', e.target.value)} placeholder="https://…" />
          </F>
        </div>
      </Section>

      <Section title="Plans" hint="Enter prices exactly as the provider advertises them for this location. Leave empty to hide the plans section.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">Apply preset:</span>
          {PRICING_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => setM((x) => ({ ...x, plans: p.plans.map((pl) => ({ ...pl, highlights: [...pl.highlights] })), plansVerifiedOn: PRICING_PRESETS_DATE }))}
            >
              {p.label} ({p.plans.map((pl) => pl.price.replace('/mo', '')).join(' / ')})
            </button>
          ))}
        </div>
        {m.plans.map((p, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-white/10 p-4 sm:grid-cols-[1fr_1fr_8rem]">
            <F label="Plan name" error={err(`plans.${i}.name`)}>
              <input className="input" value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} placeholder="1 Gig" />
            </F>
            <F label="Subtitle" error={err(`plans.${i}.speed`)}>
              <input className="input" value={p.speed} onChange={(e) => setPlan(i, { speed: e.target.value })} placeholder="Omni Fiber internet" />
            </F>
            <F label="Price" error={err(`plans.${i}.price`)}>
              <input className="input" value={p.price} onChange={(e) => setPlan(i, { price: e.target.value })} placeholder="$50/mo" />
            </F>
            <F label="Included (one per line)" wide>
              <textarea
                className="input min-h-24"
                value={p.highlights.join('\n')}
                onChange={(e) => setPlan(i, { highlights: e.target.value.split('\n').map((h) => h.trimStart()).filter((h, j, a) => h || j === a.length - 1) })}
              />
            </F>
            <div className="flex flex-col justify-end gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-cyan-400" checked={!!p.featured} onChange={(e) => setPlan(i, { featured: e.target.checked })} /> Highlight
              </label>
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => set('plans', m.plans.filter((_, j) => j !== i))}>Remove plan</button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-4">
          {m.plans.length < 6 && (
            <button type="button" className="btn-ghost py-2 text-sm" onClick={() => set('plans', [...m.plans, { name: '', speed: '', price: '', highlights: m.plans[0]?.highlights ?? [] }])}>
              + Add plan
            </button>
          )}
          <F label="Pricing verified on" error={err('plansVerifiedOn')}>
            <input className="input" value={m.plansVerifiedOn} onChange={(e) => set('plansVerifiedOn', e.target.value)} placeholder="November 15, 2026" />
          </F>
        </div>
      </Section>

      <Section title="Appointment scheduling" hint="Each location has its own calendar and capacity.">
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const on = m.schedule.openDays.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setSchedule('openDays', on ? m.schedule.openDays.filter((x) => x !== i) : [...m.schedule.openDays, i].sort())}
                className={`rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-fiber-400 bg-fiber-400/10 text-white' : 'border-white/10 text-slate-400'}`}
              >
                {d}
              </button>
            );
          })}
        </div>
        {err('schedule.openDays') && <p className="field-error">{err('schedule.openDays')}</p>}
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <F label="Opens" error={err('schedule.dayStart')}>
            <input className="input" type="time" value={m.schedule.dayStart} onChange={(e) => setSchedule('dayStart', e.target.value)} />
          </F>
          <F label="Closes" error={err('schedule.dayEnd')}>
            <input className="input" type="time" value={m.schedule.dayEnd} onChange={(e) => setSchedule('dayEnd', e.target.value)} />
          </F>
          <F label="Slot (min)" error={err('schedule.slotMinutes')}>
            <input className="input" type="number" min={15} step={15} value={m.schedule.slotMinutes} onChange={(e) => setSchedule('slotMinutes', Number(e.target.value))} />
          </F>
          <F label="Reps per slot" error={err('schedule.capacityPerSlot')}>
            <input className="input" type="number" min={1} value={m.schedule.capacityPerSlot} onChange={(e) => setSchedule('capacityPerSlot', Number(e.target.value))} />
          </F>
          <F label="Min notice (hrs)" error={err('schedule.minLeadHours')}>
            <input className="input" type="number" min={0} value={m.schedule.minLeadHours} onChange={(e) => setSchedule('minLeadHours', Number(e.target.value))} />
          </F>
          <F label="Days ahead" error={err('schedule.maxDaysAhead')}>
            <input className="input" type="number" min={1} value={m.schedule.maxDaysAhead} onChange={(e) => setSchedule('maxDaysAhead', Number(e.target.value))} />
          </F>
        </div>
      </Section>

      <Section title="Publishing">
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={m.active} onChange={(e) => set('active', e.target.checked)} /> Live on the website
          </label>
          {/* checkboxes keep wrapping labels — their accessible name is just the text */}
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={m.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Default location (home page)
          </label>
        </div>
        <F label="Share image path (optional, 1200×630)" error={err('ogImage')}>
          <input className="input sm:max-w-sm" value={m.ogImage} onChange={(e) => set('ogImage', e.target.value)} placeholder="/og-image.jpg" />
        </F>
      </Section>
    </form>
  );
}

export default function Locations() {
  const { data, reload } = useAdminMarkets();
  const [editing, setEditing] = useState<{ market: Market; isNew: boolean } | null>(null);

  if (!data) {
    return (
      <div className="grid place-items-center py-20 text-slate-400">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Locations</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Each location gets its own page, plans, phone number, provider links and appointment calendar. Add its ZIP codes under Service areas.
          </p>
        </div>
        {!editing && (
          <button className="btn-primary py-2 text-sm" onClick={() => setEditing({ market: blank(), isNew: true })}>
            + Add location
          </button>
        )}
      </div>

      {editing && (
        <Editor
          key={editing.market.slug || 'new'}
          initial={editing.market}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data.markets.map((m) => (
          <div key={m.slug} className="glass p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">
                  {m.name}, {m.state}
                </h2>
                <p className="text-sm text-slate-400">
                  {m.provider} · {m.isDefault ? '/' : `/${m.slug}`}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 text-xs">
                {m.isDefault && <span className="rounded-full bg-fiber-400/15 px-2 py-0.5 text-cyan-200 ring-1 ring-fiber-400/30">Default</span>}
                <span className={`rounded-full px-2 py-0.5 ring-1 ${m.active ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' : 'bg-slate-500/15 text-slate-300 ring-slate-400/30'}`}>
                  {m.active ? 'Live' : 'Hidden'}
                </span>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Leads</dt>
                <dd className="font-semibold">{data.leadCounts[m.slug] ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Plans</dt>
                <dd className="font-semibold">{m.plans.length ? m.plans.map((p) => p.price).join(' · ') : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Phone</dt>
                <dd className="font-semibold">{m.phoneDisplay || '—'}</dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <button className="btn-ghost py-1.5 text-sm" onClick={() => setEditing({ market: m, isNew: false })}>
                Edit
              </button>
              {m.active && (
                <a className="btn-ghost py-1.5 text-sm" href={m.isDefault ? '/' : `/${m.slug}`} target="_blank" rel="noopener">
                  View page ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
