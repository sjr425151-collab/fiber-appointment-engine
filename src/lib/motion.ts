/** Motion & device-capability helpers. Everything here avoids React state. */

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/** True on devices/networks where we should skip video and heavy effects. */
export function isConstrained(): boolean {
  const nav = navigator as Navigator & { connection?: NetworkInformation; deviceMemory?: number };
  const c = nav.connection;
  if (c?.saveData) return true;
  if (c?.effectiveType && /(^|-)2g|3g/.test(c.effectiveType)) return true;
  if ((nav.deviceMemory ?? 8) <= 2) return true;
  if ((nav.hardwareConcurrency ?? 8) <= 2) return true;
  return false;
}

/**
 * Scroll-linked parallax for elements marked `data-depth="0.3"` inside `root`.
 * A depth of 0.3 means the layer moves at 30% of scroll speed. Updates run in a
 * single requestAnimationFrame per scroll burst, only write `transform`
 * (compositor-only — no layout or paint), and stop while the root is
 * off-screen. Returns a cleanup function.
 */
export function attachParallax(root: HTMLElement): () => void {
  if (prefersReducedMotion() || isConstrained()) return () => {};

  const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-depth]')).map((el) => ({
    el,
    depth: Number(el.dataset.depth) || 0,
  }));
  if (!layers.length) return () => {};

  let visible = true;
  let frame = 0;
  let last = -1;

  const update = () => {
    frame = 0;
    const y = Math.min(window.scrollY, root.offsetHeight + root.offsetTop);
    if (y === last) return;
    last = y;
    for (const { el, depth } of layers) el.style.transform = `translate3d(0, ${(y * depth).toFixed(1)}px, 0)`;
  };
  const onScroll = () => {
    if (visible && !frame) frame = requestAnimationFrame(update);
  };

  for (const { el } of layers) el.style.willChange = 'transform';
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    for (const { el } of layers) el.style.willChange = visible ? 'transform' : 'auto';
    if (visible) onScroll();
  });
  io.observe(root);
  window.addEventListener('scroll', onScroll, { passive: true });
  update();

  return () => {
    io.disconnect();
    window.removeEventListener('scroll', onScroll);
    if (frame) cancelAnimationFrame(frame);
    for (const { el } of layers) {
      el.style.transform = '';
      el.style.willChange = '';
    }
  };
}

/** Run `fn` after the page has loaded and the main thread is idle. */
export function afterLoadIdle(fn: () => void): () => void {
  let cancelled = false;
  let idleId: number | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (cancelled) return;
    if ('requestIdleCallback' in window) idleId = window.requestIdleCallback(() => !cancelled && fn(), { timeout: 2500 });
    else timeoutId = setTimeout(() => !cancelled && fn(), 300);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
    if (idleId !== undefined) window.cancelIdleCallback(idleId);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };
}
