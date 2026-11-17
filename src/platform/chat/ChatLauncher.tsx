/**
 * The floating "Chat with an Agent" button on every public page. It is tiny;
 * the conversation itself is loaded only when someone opens it.
 */
import { lazy, Suspense, useEffect, useState } from 'react';

const ChatPanel = lazy(() => import('./ChatPanel'));
const OPEN_KEY = 'tucker-chat-open';

const readOpen = () => {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};

export function ChatLauncher() {
  // A chat left open stays open when the visitor moves to another page.
  const [open, setOpen] = useState(readOpen);
  const [loaded, setLoaded] = useState(open);
  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* private mode: the chat still works, it just won't reopen by itself */
    }
  }, [open]);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
          onPointerEnter={() => setLoaded(true)}
          onFocus={() => setLoaded(true)}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-pf-brand px-5 font-semibold text-white shadow-pf-raised transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:right-6"
          aria-haspopup="dialog"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
          </svg>
          Chat with an Agent
        </button>
      )}
      {loaded && (
        <Suspense fallback={null}>
          <ChatPanel open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
