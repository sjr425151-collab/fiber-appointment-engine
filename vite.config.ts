import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { SITE, structuredData } from './shared/content.ts';

/**
 * Fills SEO tags at build time. The public origin stays as the __SITE_URL__
 * placeholder and is substituted by the server at runtime (SITE_URL env), so
 * one build can be deployed to any domain.
 */
function seo(): Plugin {
  let dev = false;
  return {
    name: 'seo-head',
    configResolved(c) {
      dev = c.command === 'serve';
    },
    transformIndexHtml(html, ctx) {
      const ld = JSON.stringify(structuredData('__SITE_URL__')).replace(/</g, '\\u003c');
      const out = html
        .replaceAll('%SITE_TITLE%', SITE.title)
        .replaceAll('%SITE_DESCRIPTION%', SITE.description)
        .replaceAll('%SITE_NAME%', SITE.name)
        .replace('<!--__JSON_LD__-->', `<script type="application/ld+json">${ld}</script>`);
      if (dev) return out.replaceAll('__SITE_URL__', 'http://localhost:5173');
      // Preload the two Latin font files used above the fold.
      const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /(sora|inter)-latin-wght-normal-.*\.woff2$/.test(f));
      const links = fonts.map((f) => `<link rel="preload" as="font" type="font/woff2" href="/${f}" crossorigin />`).join('\n    ');
      return out.replace('<!--__JSON_LD__-->', '').replace('</title>', `</title>\n    ${links}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seo()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
  },
});
