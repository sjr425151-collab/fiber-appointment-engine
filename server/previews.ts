import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import compression from 'compression';

/** The single client preview this app serves, and the only path it answers on. */
export const PREVIEW_PATH = '/preview/dynamicconstruction';
const DEFAULT_HOSTS = ['livefiberconnect.com', 'www.livefiberconnect.com'];

/**
 * Dynamic Construction MI website preview: a static export in
 * ./previews/dynamicconstruction, served ONLY at PREVIEW_PATH and ONLY on the
 * preview hosts (livefiberconnect.com by default; override with PREVIEW_HOSTS).
 * On any other host (e.g. trytucker.com) or path, requests fall straight
 * through to Tucker unchanged. Mounted before Tucker's helmet/CSP so the
 * export's inline bootstrap scripts run; it sets its own path-scoped headers.
 * Never indexed; no access to Tucker's API, cookies or data.
 */
export function previewRouter(dir = resolve('previews', 'dynamicconstruction'), hosts = previewHosts()): Router | null {
  if (!existsSync(resolve(dir, 'index.html'))) return null;
  const allowed = new Set(hosts);
  const router = express.Router();

  // Wrong host → not ours: hand back to Tucker as if this router didn't exist.
  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (!allowed.has((req.hostname ?? '').toLowerCase())) return next('router');
    next();
  });
  router.use(compression());
  router.use((_req, res, next) => {
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  router.use(
    express.static(dir, {
      index: 'index.html',
      redirect: true,
      dotfiles: 'ignore',
      setHeaders(res, path) {
        res.setHeader('Cache-Control', path.includes('/_next/static/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
      },
    }),
  );
  // Unknown path inside the preview: the preview's own 404 page.
  const notFound = readFileSync(resolve(dir, '404.html'), 'utf8');
  router.use((_req, res) => {
    res.status(404).type('html').send(notFound);
  });
  return router;
}

function previewHosts(): string[] {
  const env = process.env.PREVIEW_HOSTS?.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return env?.length ? env : DEFAULT_HOSTS;
}
