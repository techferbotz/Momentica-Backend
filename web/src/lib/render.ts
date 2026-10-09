import { logger, safeCode } from './log';
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

/**
 * A render fetch slower than this is worth knowing about. On loopback the call
 * runs in single-digit milliseconds, so anything near this means the API is
 * struggling or the box is swapping — and since every share link is no-store,
 * that latency lands on every recipient.
 */
const SLOW_MS = Number(process.env.API_SLOW_MS ?? 400);

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
  const started = Date.now();
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
  } catch (error) {
    // The recipient sees "we can't load this right now" and nothing else. This
    // line is the only trace that it ever happened.
    logger.error('render fetch failed', {
      code: safeCode(code),
      ms: Date.now() - started,
      reason: signal.aborted ? 'timeout' : 'network',
      timeoutMs: TIMEOUT_MS,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'gone', code, reason: 'unavailable' };
  }

  const ms = Date.now() - started;
  if (ms >= SLOW_MS) {
    logger.warn('render fetch slow', { code: safeCode(code), ms, status: response.status });
  }

  if (!response.ok) {
    const reason = reasonFor(code, response.status);
    // A 404 is routine — most of them are mistyped or expired links, and
    // logging each one at error level would bury the ones that matter.
    if (response.status >= 500) {
      logger.error('render fetch returned a server error', {
        code: safeCode(code),
        status: response.status,
        ms,
      });
    } else {
      logger.debug('render code did not resolve', { code: safeCode(code), status: response.status, reason });
    }
    return { kind: 'gone', code, reason };
  }

  let body: Envelope<RenderPayload>;
  try {
    body = (await response.json()) as Envelope<RenderPayload>;
  } catch (error) {
    logger.error('render response was not valid JSON', {
      code: safeCode(code),
      status: response.status,
      ms,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'gone', code, reason: 'unavailable' };
  }

  if (!body.success || !body.data) {
    // A 200 that carries a failure envelope means the contract moved under us.
    logger.error('render response was 200 but carried no data', {
      code: safeCode(code),
      ms,
      apiCode: body.code,
      apiMessage: body.message,
    });
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
