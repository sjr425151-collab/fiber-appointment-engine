import type { ReactNode } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/api';

/** The square mark: a lowercase "t" with the nose-shaped period (also the favicon). */
export function Mark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#101828" />
      <path d="M13.2 6.8v4.1h-2.9v3.1h2.9v5.9c0 3 1.7 4.7 4.7 4.7.9 0 1.7-.1 2.4-.4v-3.1c-.4.1-.9.2-1.4.2-1.3 0-1.9-.6-1.9-1.9V14h3.3v-3.1H17V6.8z" fill="#fff" />
      <path d="M22.3 20.6h3c.8 0 1.3.7 1 1.4l-.7 1.7c-.3.8-1 1.2-1.8 1.2s-1.500-.4-1.8-1.2l-.7-1.700c-.3-.7.2-1.400 1-1.400z" fill="#fff" />
    </svg>
  );
}

/**
 * The wordmark: lowercase "tucker" with a period shaped like the bear's nose.
 * Screen readers get the name once; the nose is decorative.
 */
export function Wordmark({ noseClassName = 'bg-current' }: { noseClassName?: string }) {
  return (
    <span className="inline-flex items-baseline">
      <span className="sr-only">Tucker</span>
      <span aria-hidden>tucker</span>
      <span aria-hidden className={`ml-[0.07em] inline-block h-[0.24em] w-[0.3em] rounded-[46%_46%_50%_50%/38%_38%_62%_62%] ${noseClassName}`} />
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5">
      <Mark />
      {!compact && (
        <span className="whitespace-nowrap font-display text-base font-bold tracking-tight sm:text-lg">
          <Wordmark noseClassName="bg-fiber-400" />
        </span>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLORS[status] ?? STATUS_COLORS.lost}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Field({ label, error, children, htmlFor }: { label: string; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error && (
        <p className="field-error" role="alert" id={`${htmlFor}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Check({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
    </svg>
  );
}
