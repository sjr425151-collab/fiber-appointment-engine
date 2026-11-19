/**
 * Tucker's chat launcher: his face in a round button, fixed at the bottom right of
 * every public page, plus a one-time greeting bubble. The conversation itself
 * (ChatPanel) loads only when someone is about to open it.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const ChatPanel = lazy(() => import('./ChatPanel'));
/** Any button on the page can open the chat by sending this event. */
export const OPEN_CHAT_EVENT = 'tucker:open-chat';
export const openChat = () => window.dispatchEvent(new Event(OPEN_CHAT_EVENT));

const OPEN_KEY = 'tucker-chat-open';
const GREETED_KEY = 'tucker-chat-greeted';
const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode: the chat still works */
    }
  },
};

/** Tucker's face; the 192 px file covers phones with dense screens. */
export function TuckerFace({ size, className = '' }: { size: number; className?: string }) {
  return (
    <picture>
      <source type="image/webp" srcSet="/media/tucker-face-96.webp 96w, /media/tucker-face-192.webp 192w" sizes={`${size}px`} />
      <img
        src="/media/tucker-face-96.png"
        srcSet="/media/tucker-face-96.png 96w, /media/tucker-face-192.png 192w"
        sizes={`${size}px`}
        width={size}
        height={size}
        alt=""
        decoding="async"
        loading="lazy"
        className={`block rounded-full ${className}`}
      />
    </picture>
  );
}

export function ChatLauncher() {
  // A chat left open stays open when the visitor moves to another page.
  const [open, setOpen] = useState(() => store.get(OPEN_KEY) === '1');
  const [loaded, setLoaded] = useState(open);
  // Closing the chat returns keyboard focus to the launcher (not on the first render).
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) requestAnimationFrame(() => button.current?.focus());
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const show = () => {
      setLoaded(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, show);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, show);
  }, []);
  useEffect(() => store.set(OPEN_KEY, open ? '1' : '0'), [open]);

  // The greeting: offered once per visit, after a moment, never while someone is typing, and only
  // where it covers nothing people use (form fields, buttons, links). If the page scrolls something
  // under it, it steps aside and comes back when the space is clear. Dismissing it ends it for the visit.
  const [due, setDue] = useState(false);
  const [clear, setClear] = useState(false);
  useEffect(() => {
    if (open || store.get(GREETED_KEY)) return;
    const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;
    let timer = window.setTimeout(function attempt() {
      if (typing()) timer = window.setTimeout(attempt, 4000);
      else setDue(true);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!due || open) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const l = button.current?.getBoundingClientRect();
      if (!l) return;
      // Where the bubble sits: above the launcher, right-aligned, up to 264 × 96 px.
      const zone = { left: l.right - Math.min(264, window.innerWidth - 32), right: l.right, top: l.top - 108, bottom: l.top };
      const blocked = [...document.querySelectorAll('main a, main button, main input, main select, main textarea, main label, header a, header button')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !(r.right <= zone.left || r.left >= zone.right || r.bottom <= zone.top || r.top >= zone.bottom);
      });
      setClear(!blocked);
      if (!blocked) store.set(GREETED_KEY, '1');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [due, open]);
  // Shown while due and the space is clear; ended (for this visit) by opening the chat or dismissing it.
  const greeting = due && clear && !open;
  const dismissGreeting = () => setDue(false);

  const launch = () => {
    setDue(false);
    setLoaded(true);
    setOpen(true);
  };

  return (
    <>
      {!open && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
          {greeting && (
            <div
              role="status"
              className="tucker-greet relative flex max-w-[16.5rem] items-start gap-1 rounded-2xl rounded-br-md border border-pf-line bg-pf-surface py-2.5 pl-4 pr-1 text-[15px] leading-snug text-pf-ink shadow-pf-raised"
            >
              <button type="button" onClick={launch} className="py-0.5 text-left">
                Hey, I’m Tucker! 🐻 Want to see if you’re overpaying?
              </button>
              <button
                type="button"
                onClick={dismissGreeting}
                aria-label="Dismiss Tucker’s greeting"
                className="-my-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-pf-subtle hover:bg-pf-bg hover:text-pf-ink"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          )}
          <button
            ref={button}
            type="button"
            onClick={launch}
            onPointerEnter={() => setLoaded(true)}
            onFocus={() => setLoaded(true)}
            aria-haspopup="dialog"
            aria-label="Chat with Tucker"
            title="Chat with Tucker"
            className="tucker-launch group relative grid h-14 w-14 place-items-center rounded-full bg-pf-surface p-[3px] shadow-[0_10px_28px_-10px_rgba(16,24,40,.45),0_0_0_1px_rgba(16,24,40,.06)] ring-2 ring-pf-brand transition-transform duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.04] active:scale-95 focus-visible:outline-none focus-visible:ring-4 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100 motion-reduce:active:scale-100 sm:h-16 sm:w-16"
          >
            <TuckerFace size={58} className="h-full w-full" />
            {/* A small chat mark tells people this is a conversation, not just a picture. */}
            <span aria-hidden className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-pf-brand text-white ring-2 ring-pf-surface">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
              </svg>
            </span>
          </button>
        </div>
      )}
      {loaded && (
        <Suspense fallback={null}>
          <ChatPanel open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
