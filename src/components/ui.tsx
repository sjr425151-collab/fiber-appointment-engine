import type { ReactNode } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/api';
import { LOGO_ORANGE, T_MARK, WORDMARK } from './logo-paths';

/** The app mark: the lowercase "t" with the orange bear-nose period on a dark rounded square. */
export function Mark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#101828" />
      <svg x="7.2" y="7.4" width="17.6" height="17.1" viewBox={T_MARK.viewBox}>
        <g fill="#fff" dangerouslySetInnerHTML={{ __html: T_MARK.letters }} />
        <g fill={LOGO_ORANGE} dangerouslySetInnerHTML={{ __html: T_MARK.nose }} />
      </svg>
    </svg>
  );
}

/**
 * The wordmark "tucker." as vector outlines (Sora 700) with the orange bear-nose period,
 * sized to the surrounding text. Screen readers get the name once.
 */
export function Wordmark({ className = '' }: { className?: string; noseClassName?: string }) {
  return (
    <span className={`inline-flex items-baseline ${className}`}>
      <span className="sr-only">Tucker</span>
      <svg viewBox={WORDMARK.viewBox} aria-hidden style={{ height: '0.75em', width: 'auto', verticalAlign: '-0.01em', overflow: 'visible' }}>
        <g fill="currentColor" dangerouslySetInnerHTML={{ __html: WORDMARK.letters }} />
        <g fill={LOGO_ORANGE} dangerouslySetInnerHTML={{ __html: WORDMARK.nose }} />
      </svg>
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5">
      <Mark />
      {!compact && (
        <span className="whitespace-nowrap font-display text-base font-bold tracking-tight sm:text-lg">
          <Wordmark />
        </span>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLORS[status] ?? STATUS_COLORS.lost}`}>{STATUS_LABELS[status] ?? status}</span>;
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
