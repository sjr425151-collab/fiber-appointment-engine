import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { MONROE } from './shared/market.ts';
import { renderHtml } from './server/html.ts';

/**
 * Production: leaves the %%PLACEHOLDERS%% for the server, which renders each
 * location's <head> at request time, and adds font preloads.
 * Development: renders the default market so `npm run dev` matches production.
 */
function seoHead(): Plugin {
  let dev = false;
  return {
    name: 'seo-head',
    configResolved(c) {
      dev = c.command === 'serve';
    },
    transformIndexHtml(html, ctx) {
      if (dev) {
        return renderHtml(html, {
          siteUrl: 'http://localhost:5173',
          canonicalPath: '/',
          boot: {
            market: MONROE,
            markets: [{ slug: MONROE.slug, name: MONROE.name, state: MONROE.state }],
            defaultSlug: MONROE.slug,
            flags: { env: 'development', platform: true, sampleData: process.env.SAMPLE_DATA_ENABLED === 'true' },
          },
        });
      }
      const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /(sora|inter)-latin-wght-normal-.*\.woff2$/.test(f));
      const links = fonts.map((f) => `<link rel="preload" as="font" type="font/woff2" href="/${f}" crossorigin />`).join('\n    ');
      return html.replace('</title>', `</title>\n    ${links}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seoHead()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    // dist/.vite/manifest.json lets the server preload lazy chunks for /savings pages.
    manifest: true,
  },
});
