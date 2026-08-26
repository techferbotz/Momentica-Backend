import { env } from '../config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = env.isDevelopment ? LEVEL_ORDER.debug : LEVEL_ORDER.info;

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;

  if (env.isDevelopment) {
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
