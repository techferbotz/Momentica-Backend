import type { GoneReason, RenderPayload, RouteState } from './types';

/**
 * Where the API lives. On the box this is the loopback port the backend
 * publishes on, which is the whole reason the renderer is co-located: every
 * share link is `no-store`, so SSR fetches the API on every single request.
 * That call is ~1ms over loopback and ~100ms from anywhere else.
 */
const API_BASE = (process.env.API_BASE ?? 'https://momentica.ferbotz.com/api').replace(/\/+$/, '');

/** How long we will wait on the API before drawing the unavailable page. */
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 5000);

interface Envelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
}

/**
 * The one fetch path.
 *
 * Every rendered page — feed preview, the creator's unpaid draft, a live paid
 * link — comes through here. The shape of the code decides what comes back;
 * this function does not care which it is holding and must not start caring.
 */
export async function fetchRender(code: string): Promise<RouteState> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/v1/public/render/${encodeURIComponent(code)}`, {
      headers: { accept: 'application/json' },
      // Never reuse a cached response. A creator fixing a typo must be visible
      // immediately, an expired link must actually expire — and the API sends
      // `public, max-age=300` even on its 404s, which would otherwise pin a
      // just-published link as dead for five minutes.
      cache: 'no-store',
      signal,
    });
  } catch {
    return { kind: 'gone', code, reason: 'unavailable' };
  }

  if (!response.ok) {
    return { kind: 'gone', code, reason: reasonFor(code, response.status) };
  }

  let body: Envelope<RenderPayload>;
  try {
    body = (await response.json()) as Envelope<RenderPayload>;
  } catch {
    return { kind: 'gone', code, reason: 'unavailable' };
  }

  if (!body.success || !body.data) {
    return { kind: 'gone', code, reason: reasonFor(code, response.status) };
  }

  return { kind: 'render', code, payload: body.data };
}

/**
 * A 404 on a `d_` code means the creator's ~30-minute preview token lapsed,
 * which deserves "reopen it from the app" rather than the dead-link page. The
 * API reports both as NOT_FOUND, so the distinction is drawn from the code we
 * asked about — which we already know, and which cannot drift.
 */
function reasonFor(code: string, status: number): GoneReason {
  if (status >= 500) return 'unavailable';
  if (code.startsWith('d_')) return 'draft-expired';
  return 'unknown';
}

/**
 * The view ping is fired by the browser, never the server — the server runs for
 * crawlers too and cannot tell them from a person, which is exactly what the
 * separate endpoint exists to avoid.
 *
 * Deliberately origin-relative rather than built from API_BASE: in production
 * API_BASE is a loopback address the visitor's browser cannot reach. nginx maps
 * /api/ on the public hostname to the same backend.
 */
export function viewPingPath(code: string): string {
  return `/api/v1/public/render/${encodeURIComponent(code)}/view`;
}
