import { useEffect, useState, type ReactNode } from 'react';
import { PLATFORM } from '../../../shared/platform/brand';
import type { Cents } from '../../../shared/finance/money';
import { Button, Callout, Card, ChoiceCards, CurrencyInput, Field, Money, SegmentedControl, Select, StatusChip, Stepper, TextInput, type ChipStatus } from '../ds';
import { BarCompare, CumulativeChart } from '../ds/charts';

const TOKENS: [string, string, string][] = [
  ['pf-ink', '#101828', 'Primary text'],
  ['pf-muted', '#475467', 'Secondary text (7.7:1 on white)'],
  ['pf-subtle', '#5d6b82', 'Tertiary text (5.4:1)'],
  ['pf-field', '#7a8499', 'Input borders (≥ 3:1)'],
  ['pf-line', '#d9d6ce', 'Dividers (decorative)'],
  ['pf-brand', '#1d3fd8', 'Actions, focus (7.6:1)'],
  ['pf-save', '#067647', 'Savings (5.7:1)'],
  ['pf-cost', '#b42318', 'Extra cost, errors (6.6:1)'],
  ['pf-warn', '#8a3a0c', 'Warnings'],
  ['pf-sample', '#5b37b8', 'Sample data'],
  ['pf-info', '#175cd3', 'Information'],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-xl font-bold text-pf-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Living style guide: every component rendered with real props (staging/dev only). */
export default function DesignSystem() {
  const [cents, setCents] = useState<Cents | null>(7999);
  const [err, setErr] = useState<string>();
  const [choice, setChoice] = useState<string[]>(['internet']);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  useEffect(() => {
    document.title = `Design system – ${PLATFORM.name}`;
  }, []);
  const points = Array.from({ length: 60 }, (_, m) => ({ month: m, cumulativeSavings: -9900 + (m + 1) * 2500 }));
  return (
    <div className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-3xl font-bold text-pf-ink">Design system</h1>
        <p className="mt-2 text-pf-muted">Tokens and components for the household platform. Usage rules: docs/09-design-system.md.</p>
      </header>

      <Section title="Color tokens">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOKENS.map(([name, hex, use]) => (
            <li key={name} className="flex items-center gap-3 rounded-xl border border-pf-line bg-pf-surface p-3">
              <span className="h-10 w-10 shrink-0 rounded-lg border border-pf-line" style={{ background: hex }} aria-hidden />
              <span className="text-sm">
                <span className="block font-semibold text-pf-ink">--color-{name}</span>
                <span className="text-pf-muted">
                  {hex} · {use}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <Card>
          <p className="font-display text-4xl font-bold text-pf-ink">Display 36 — Sora</p>
          <p className="mt-2 font-display text-2xl font-bold text-pf-ink">Heading 24 — Sora</p>
          <p className="mt-2 text-base text-pf-ink">Body 16 — Inter. Comfortable line length, 1.5 line height.</p>
          <p className="mt-2 text-sm text-pf-muted">Small 14 — secondary text.</p>
          <p className="tnum mt-2 text-lg text-pf-ink">Tabular figures: $1,234.56 · $99.00 · $7.50</p>
        </Card>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="lg">Large primary</Button>
        </div>
      </Section>

      <Section title="Form controls">
        <Card className="grid gap-6 sm:grid-cols-2">
          <Field label="Text input" hint="Hint text is announced with the field.">
            {(p) => <TextInput id={p.id} aria-describedby={p.describedBy} placeholder="Comcast Xfinity" />}
          </Field>
          <Field label="Currency (stored as cents)" error={err}>
            {(p) => (
              <CurrencyInput
                id={p.id}
                describedBy={p.describedBy}
                invalid={p.invalid}
                value={cents}
                onChange={(c, e) => {
                  setCents(c);
                  setErr(e);
                }}
              />
            )}
          </Field>
          <Field label="Select">{(p) => <Select id={p.id} options={[{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }]} />}</Field>
          <Field label="With error" error="Enter a 5-digit ZIP code">
            {(p) => <TextInput id={p.id} aria-describedby={p.describedBy} aria-invalid defaultValue="481" />}
          </Field>
          <p className="text-sm text-pf-muted sm:col-span-2">
            Parsed value: <span className="tnum font-semibold text-pf-ink">{cents === null ? 'empty' : `${cents} cents`}</span>
          </p>
        </Card>
        <ChoiceCards
          legend="Choice cards (multi-select)"
          multiple
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'internet', label: 'Home internet', description: 'Description text' },
            { value: 'mobile', label: 'Mobile' },
          ]}
        />
        <SegmentedControl label="Segmented control" value={seg} onChange={setSeg} options={[{ value: 'a', label: '1 year' }, { value: 'b', label: '5 years' }, { value: 'c', label: '10 years' }]} />
      </Section>

      <Section title="Progress">
        <Stepper steps={['Area', 'Services', 'Internet', 'Review']} current={2} />
      </Section>

      <Section title="Data-quality status chips">
        <div className="flex flex-wrap gap-2">
          {(['verified', 'manually_verified', 'pending_verification', 'estimated', 'user_reported', 'sample', 'unavailable'] as ChipStatus[]).map((s) => (
            <StatusChip key={s} status={s} />
          ))}
        </div>
      </Section>

      <Section title="Money">
        <Card className="space-y-2 text-lg">
          <p>
            Amount: <Money cents={8999} perMonth />
          </p>
          <p>
            Savings: <Money cents={4500} kind="savings" perMonth />
          </p>
          <p>
            Extra cost: <Money cents={-1250} kind="savings" perMonth />
          </p>
        </Card>
      </Section>

      <Section title="Callouts">
        <Callout title="Information">Neutral, helpful context.</Callout>
        <Callout tone="warn" title="Warning">Something limits what we can show.</Callout>
        <Callout tone="sample" title="Sample data">Illustrative values only.</Callout>
        <Callout tone="save" title="Good news">A positive outcome.</Callout>
      </Section>

      <Section title="Charts (with table equivalents)">
        <Card>
          <CumulativeChart title="Cumulative difference over 5 years (example)" points={points} breakEvenMonths={4} />
        </Card>
        <Card>
          <BarCompare
            title="Monthly cost by service (example)"
            rows={[
              { label: 'Home internet', current: 10500, alternative: 5000 },
              { label: 'Mobile', current: 16000, alternative: 11000 },
              { label: 'Electricity', current: 14000, alternative: null },
            ]}
          />
        </Card>
      </Section>
    </div>
  );
}
