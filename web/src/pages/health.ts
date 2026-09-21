import type { APIRoute } from 'astro';

/**
 * The renderer's own liveness, for the container healthcheck. Separate from
 * /api/health, which nginx routes to the backend — this one answers whether
 * the Node process serving pages is up.
 *
 * Seven characters, so it can never collide with an 8-char share code; and a
 * static route wins over the [code] dynamic route regardless.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ success: true, data: { status: 'ok' } }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
