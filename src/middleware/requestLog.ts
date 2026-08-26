import type { RequestHandler } from 'express';
import { logger } from '../utils/logger';

const QUIET_PATHS = new Set(['/health', '/health/db']);

export const requestLog: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const fields = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
    };

    if (QUIET_PATHS.has(req.path) && res.statusCode < 400) {
      logger.debug('request', fields);
    } else if (res.statusCode >= 500) {
      logger.error('request', fields);
    } else if (res.statusCode >= 400) {
      logger.warn('request', fields);
    } else {
      logger.info('request', fields);
    }
  });

  next();
};
