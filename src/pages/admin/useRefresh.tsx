/**
 * Keeps an admin page's numbers current: a Refresh button, the time of the last update, and a quiet
 * reload every minute while the tab is visible (and as soon as someone comes back to the tab).
 * Pages add `tick` to the dependencies of the effects that load their data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const AUTO_MS = 60_000;

export function useRefresh() {
  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const last = useRef(0);
  const refresh = useCallback(() => {
    last.current = Date.now();
    setTick((t) => t + 1);
    setUpdatedAt(new Date());
  }, []);
  useEffect(() => {
    last.current = Date.now();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, AUTO_MS);
    // Coming back to a tab that sat in the background: refresh if the numbers are older than a minute.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current >= AUTO_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  return { tick, updatedAt, refresh };
}

export function RefreshButton({ updatedAt, onRefresh }: { updatedAt: Date; onRefresh: () => void }) {
  const time = updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400" aria-live="polite">
        Updated {time} · refreshes every minute
      </span>
      <button type="button" onClick={onRefresh} className="btn-ghost py-2 text-sm">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
        </svg>
        Refresh
      </button>
    </div>
  );
}
