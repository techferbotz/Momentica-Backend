import { createHash } from 'node:crypto';

/**
 * The renderer's logger.
 *
 * Deliberately a mirror of the API's `src/utils/logger.ts` rather than an
 * import of it: that module pulls in `config/env`, whose whole job is to refuse
 * to start without DATABASE_URL, JWT_SECRET and the rest. The renderer has none
 * of those, so importing it would trade "no logging" for "does not boot". The
 * ~25 lines are worth it, and the output format matches so both halves of
 * Momentica read the same in `docker logs`.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const isDev = process.env.NODE_ENV !== 'production';
const MIN_LEVEL = isDev ? LEVEL_ORDER.debug : LEVEL_ORDER.info;

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;

  if (isDev) {
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
    console[level === 'debug' ? 'log' : level](`${level.toUpperCase()} ${message}${suffix}`);
    return;
  }

  console[level === 'debug' ? 'log' : level](
    JSON.stringify({ level, time: new Date().toISOString(), message, ...fields }),
  );
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};

/**
 * A share code is a secret. Privacy for a published moment is nothing but the
 * unguessability of eight base62 characters, so writing one into a log file —
 * which gets shipped around, tailed in terminals and pasted into issues —
 * would hand out the link itself.
 *
 * Preview codes name a public template and carry nothing, so they log as they
 * are. Everything else logs as its kind plus a short stable digest: enough to
 * follow one link through a log, useless for opening it.
 */
export function safeCode(code: string): string {
  if (code.startsWith('pv_')) return code;
  const digest = createHash('sha256').update(code).digest('hex').slice(0, 10);
  return `${code.startsWith('d_') ? 'draft' : 'share'}:${digest}`;
}
