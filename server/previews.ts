import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type Router } from 'express';
import compression from 'compression';

/**
 * Client website previews: static exports in ./previews/<name>/, served at
 * /preview/<name>/. Mounted before Tucker's helmet/CSP so the exported sites'
 * inline bootstrap scripts can run; they get their own, path-scoped headers.
 * Previews are never indexed and never touch Tucker's API or data.
 */
export function previewsRouter(root = resolve('previews')): Router | null {
  if (!existsSync(root)) return null;
  const router = express.Router();
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
    express.static(root, {
      index: 'index.html',
      redirect: true,
      dotfiles: 'ignore',
      setHeaders(res, path) {
        res.setHeader('Cache-Control', path.includes('/_next/static/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
      },
    }),
  );
  // Unknown path inside a preview: that preview's own 404 page.
  router.use((req, res) => {
    const name = /^\/([a-z0-9-]+)(?:\/|$)/.exec(req.path)?.[1];
    const page = name ? resolve(root, name, '404.html') : null;
    if (page && page.startsWith(root) && existsSync(page)) {
      res.status(404).type('html').send(readFileSync(page, 'utf8'));
      return;
    }
    res.status(404).type('text/plain').send('Not found');
  });
  return router;
}
