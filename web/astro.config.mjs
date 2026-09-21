// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

/**
 * Server-rendered, always. Link previews in WhatsApp and Instagram are most of
 * this product's distribution and a crawler will not run JavaScript, so the
 * Open Graph tags have to exist in the HTML the server sends.
 *
 * `site` is what relative og:image paths are absolutised against — the backend
 * returns them origin-relative for previews and absolute (S3) for published
 * creations, and OG requires absolute either way.
 */
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: 'https://momentica.ferbotz.com',
  devToolbar: { enabled: false },
  server: { port: 4321, host: true },
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
  vite: {
    resolve: {
      alias: {
        // Mirrors the `paths` in tsconfig.json so Vite resolves what TypeScript
        // resolves. Needed because the template manifest imports the backend's
        // registry as a VALUE, not just a type — that is what turns a drifted
        // field key into a failed build instead of a blank space on a page.
        '@api': fileURLToPath(new URL('../src', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
});
