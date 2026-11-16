/**
 * Platform design system — accessible primitives used by every platform screen.
 * Tokens live in src/platform/platform.css (`--color-pf-*`); usage rules in docs/09-design-system.md.
 */
import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { formatCents, parseDollars, type Cents } from '../../../shared/finance/money';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------------------------ Button --
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
  loading?: boolean;
};
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'lg' ? 'px-6 py-3.5 text-base' : 'px-4 py-2.5 text-sm',
        variant === 'primary' && 'bg-pf-brand text-white hover:bg-pf-brand-strong',
        variant === 'secondary' && 'border border-pf-field bg-pf-surface text-pf-ink hover:bg-pf-bg',
        variant === 'ghost' && 'text-pf-brand hover:bg-pf-brand-soft',
        className,
      )}
    >
      {loading && <span className="h-4 w-4 motion-safe:animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------- Field --
export function Field({
  label,
  hint,
  error,
  optional,
  id: fixedId,
  children,
}: {
  label: string;
  /** Stable id for the control (e.g. to move focus to it); generated when omitted. */
  id?: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const autoId = useId();
  const id = fixedId ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-pf-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-pf-subtle">(optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="-mt-0.5 mb-1.5 text-sm text-pf-subtle">
          {hint}
        </p>
      )}
      {children({ id, describedBy: [errId, hintId].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {error && (
        <p id={errId} className="mt-1.5 text-sm font-medium text-pf-cost">
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  'block w-full rounded-xl border border-pf-field bg-pf-surface px-3.5 py-3 text-base text-pf-ink placeholder:text-pf-subtle aria-[invalid=true]:border-pf-cost';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cx(inputCls, 'appearance-auto', props.className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Dollar input that stores integer cents. Parsing uses the exact parser from
 * the finance engine, so "$1,234.5" → 123450 with no floating point.
 */
export function CurrencyInput({
  value,
  onChange,
  id,
  describedBy,
  invalid,
  placeholder = '0.00',
}: {
  value: Cents | null;
  onChange: (cents: Cents | null, error?: string) => void;
  id: string;
  describedBy?: string;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? '' : (value / 100).toFixed(2));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-pf-muted" aria-hidden>
        $
      </span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const c = parseDollars(e.target.value);
            if (c !== null && c < 0) onChange(null, 'Enter an amount of $0 or more');
            else if (c !== null && c > 10_000_00) onChange(null, 'That looks too high for a monthly bill — check the amount');
            else onChange(c);
          } catch {
            onChange(null, 'Enter a dollar amount like 79.99');
          }
        }}
        onBlur={() => {
          try {
            const c = parseDollars(text);
            if (c !== null && c >= 0) setText((c / 100).toFixed(2));
          } catch {
            /* keep what they typed so they can fix it */
          }
        }}
        className={cx(inputCls, 'tnum pl-7')}
      />
    </div>
  );
}

// ------------------------------------------------------------ ChoiceCards --
export function ChoiceCards<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  multiple,
  error,
  columns = 2,
  id,
}: {
  legend: string;
  /** Id of the first input, so an error summary can link to the group. */
  id?: string;
  hint?: string;
  options: { value: T; label: string; description?: string; icon?: ReactNode }[];
  value: T[];
  onChange: (v: T[]) => void;
  multiple?: boolean;
  error?: string;
  columns?: 1 | 2 | 3;
}) {
  const name = useId();
  const describedBy = [error && `${name}-err`, hint && `${name}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset aria-describedby={describedBy}>
      <legend className="text-sm font-semibold text-pf-ink">{legend}</legend>
      {hint && (
        <p id={`${name}-hint`} className="mt-1 text-sm text-pf-subtle">
          {hint}
        </p>
      )}
      <div className={cx('mt-3 grid gap-3', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
        {options.map((o, i) => {
          const checked = value.includes(o.value);
          return (
            <label
              key={o.value}
              className={cx(
                'flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border bg-pf-surface p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pf-brand',
                checked ? 'border-pf-brand bg-pf-brand-soft' : 'border-pf-line hover:border-pf-field',
              )}
            >
              <input
                id={i === 0 ? id : undefined}
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                aria-invalid={error ? true : undefined}
                value={o.value}
                checked={checked}
                onChange={() => onChange(multiple ? (checked ? value.filter((x) => x !== o.value) : [...value, o.value]) : [o.value])}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-pf-brand)]"
              />
              {o.icon && <span className="mt-0.5 text-pf-brand" aria-hidden>{o.icon}</span>}
              <span>
                <span className="block font-semibold text-pf-ink">{o.label}</span>
                {o.description && <span className="mt-0.5 block text-sm text-pf-muted">{o.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${name}-err`} className="mt-2 text-sm font-medium text-pf-cost">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ------------------------------------------------------- SegmentedControl --
export function SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-pf-subtle">{label}</legend>
      <div className="inline-flex flex-wrap rounded-xl border border-pf-field bg-pf-surface p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'cursor-pointer rounded-lg px-3 py-2 text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-pf-brand',
              value === o.value ? 'bg-pf-ink text-white' : 'text-pf-muted hover:text-pf-ink',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ Stepper --
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div role="group" aria-label="Assessment progress">
      <p className="mb-2 text-sm font-medium text-pf-muted">
        Step {current + 1} of {steps.length}: <span className="text-pf-ink">{steps[current]}</span>
      </p>
      <ol className="flex gap-1.5">
        {steps.map((s, i) => (
          <li key={s} className="flex-1" aria-current={i === current ? 'step' : undefined}>
            <span className={cx('block h-1.5 rounded-full', i <= current ? 'bg-pf-brand' : 'bg-pf-line')} />
            <span className="sr-only">
              {s}
              {i < current ? ' (done)' : i === current ? ' (current)' : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// -------------------------------------------------------------- StatusChip --
export type ChipStatus = 'verified' | 'manually_verified' | 'estimated' | 'pending_verification' | 'unavailable' | 'sample' | 'user_reported';

const CHIP: Record<ChipStatus, { label: string; cls: string; icon: string }> = {
  verified: { label: 'Verified', cls: 'bg-pf-save-soft text-pf-save', icon: '✓' },
  manually_verified: { label: 'Manually verified', cls: 'bg-pf-save-soft text-pf-save', icon: '✓' },
  estimated: { label: 'Estimate', cls: 'bg-pf-warn-soft text-pf-warn', icon: '≈' },
  pending_verification: { label: 'Needs address check', cls: 'bg-pf-info-soft text-pf-info', icon: '?' },
  unavailable: { label: 'Unavailable', cls: 'bg-pf-cost-soft text-pf-cost', icon: '×' },
  sample: { label: 'Sample data', cls: 'bg-pf-sample-soft text-pf-sample', icon: '◇' },
  user_reported: { label: 'You told us', cls: 'bg-pf-bg text-pf-muted ring-1 ring-inset ring-pf-line', icon: '•' },
};

/** `detail` is read to screen readers only; show anything important as visible text too. */
export function StatusChip({ status, detail }: { status: ChipStatus; detail?: string }) {
  const c = CHIP[status];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', c.cls)}>
      <span aria-hidden>{c.icon}</span>
      {c.label}
      {detail && <span className="sr-only">: {detail}</span>}
    </span>
  );
}

// ------------------------------------------------------------------- Money --
/** Money with an explicit word for direction — never colour alone. */
export function Money({ cents, kind = 'amount', className, perMonth }: { cents: Cents; kind?: 'amount' | 'savings'; className?: string; perMonth?: boolean }) {
  if (kind === 'savings') {
    const less = cents >= 0;
    return (
      <span className={cx('tnum', less ? 'text-pf-save' : 'text-pf-cost', className)}>
        {formatCents(Math.abs(cents), { cents: Math.abs(cents) % 100 !== 0 })}
        {perMonth && '/mo'} <span className="text-[0.8em] font-medium">{cents === 0 ? 'no change' : less ? 'less' : 'more'}</span>
      </span>
    );
  }
  return (
    <span className={cx('tnum', className)}>
      {formatCents(cents, { cents: cents % 100 !== 0 })}
      {perMonth && <span className="text-[0.8em] font-medium text-pf-muted">/mo</span>}
    </span>
  );
}

// ------------------------------------------------------------- Card/Callout --
export function Card({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={cx('rounded-2xl border border-pf-line bg-pf-surface p-5 shadow-pf-card sm:p-6', className)}>{children}</As>;
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'sample' | 'save'; title?: string; children: ReactNode }) {
  const cls = { info: 'bg-pf-info-soft text-pf-info', warn: 'bg-pf-warn-soft text-pf-warn', sample: 'bg-pf-sample-soft text-pf-sample', save: 'bg-pf-save-soft text-pf-save' }[tone];
  return (
    <div className={cx('rounded-xl p-4 text-sm', cls)} role={tone === 'warn' ? 'note' : undefined}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cx('leading-relaxed', title && 'mt-1')}>{children}</div>
    </div>
  );
}
