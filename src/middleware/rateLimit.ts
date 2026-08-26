import type { Request, RequestHandler } from 'express';
import { ErrorCode, TooManyRequestsError } from '../errors/AppError';

/**
 * In-memory sliding-window limiter.
 *
 * Per-process, so it is exactly as good as a single instance — which is what we
 * deploy. Moving to more than one instance means moving this to a shared store;
 * until then a shared store would be infrastructure with no benefit.
 *
 * Note this leans on `app.set('trust proxy', 1)`: behind nginx every request
 * originates from loopback, and without that setting every caller would share
 * one bucket.
 */

interface Window {
  hits: number[];
}

const windows = new Map<string, Window>();

const SWEEP_INTERVAL_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    // Anything older than the longest window in use is dead weight.
    if (window.hits.length === 0 || now - (window.hits[window.hits.length - 1] ?? 0) > 3_600_000) {
      windows.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS).unref();

export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

export type KeyFn = (req: Request) => string;

const byIp: KeyFn = (req) => req.ip ?? 'unknown';

export function rateLimit(
  config: RateLimitConfig,
  options: { name: string; key?: KeyFn } = { name: 'default' },
): RequestHandler {
  const keyFn = options.key ?? byIp;
  const windowMs = config.windowSeconds * 1000;

  return (req, _res, next) => {
    const key = `${options.name}:${keyFn(req)}`;
    const now = Date.now();
    const window = windows.get(key) ?? { hits: [] };

    // Drop everything that fell out of the window.
    const cutoff = now - windowMs;
    let firstLive = 0;
    while (firstLive < window.hits.length && (window.hits[firstLive] ?? 0) <= cutoff) {
      firstLive += 1;
    }
    if (firstLive > 0) window.hits.splice(0, firstLive);

    if (window.hits.length >= config.limit) {
      const oldest = window.hits[0] ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      windows.set(key, window);
      next(
        new TooManyRequestsError(
          'Too many requests, please slow down',
          ErrorCode.RATE_LIMITED,
          retryAfter,
        ),
      );
      return;
    }

    window.hits.push(now);
    windows.set(key, window);
    next();
  };
}

/** Rate-limit by signed-in user when there is one, otherwise by device or IP. */
export const byPrincipal: KeyFn = (req) => {
  const principal = req.principal;
  if (principal?.kind === 'user') return `u:${principal.userId}`;
  if (principal?.kind === 'draft') return `d:${principal.draftSessionId}`;
  return `ip:${req.ip ?? 'unknown'}`;
};

/** Rate-limit per share code plus IP, for public per-creation endpoints. */
export const byCodeAndIp: KeyFn = (req) => `${req.params.code ?? '-'}:${req.ip ?? 'unknown'}`;

/** Exposed for tests and scripts. */
export function resetRateLimits(): void {
  windows.clear();
}
