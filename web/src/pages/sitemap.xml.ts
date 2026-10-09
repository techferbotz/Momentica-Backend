import type { APIRoute } from 'astro';
import { MANIFEST } from '../templates/manifest';
import { PUBLIC_ORIGIN } from '../lib/og';

/**
 * Only the shopfront. Share links are deliberately absent: a sitemap listing
 * them would hand a crawler the exact thing the eight-character code exists to
 * keep unguessable.
 *
 * Built from the renderer's MANIFEST rather than the backend's live template
 * list, so it advertises what this renderer can actually draw. Listing a
 * template the backend has flipped live but we have not built yet would point
 * crawlers at a page that 404s — the same ordering trap, one layer out.
 */
export const GET: APIRoute = () => {
  const urls = [
    { loc: `${PUBLIC_ORIGIN}/`, priority: '1.0' },
    ...MANIFEST.map((entry) => ({
      loc: `${PUBLIC_ORIGIN}/templates/${entry.id}`,
      priority: '0.8',
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <priority>${u.priority}</priority>\n  </url>`)
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
