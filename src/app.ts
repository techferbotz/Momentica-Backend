import express from 'express';
import cors from 'cors';
import type { CorsOptions } from 'cors';
import { env } from './config/env';
import { BODY } from './config/constants';
import { rootRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLog } from './middleware/requestLog';
import { logger } from './utils/logger';
import { disconnectPrisma } from './repositories/prisma';

export function createApp(): express.Express {
  const app = express();

  /**
   * nginx terminates TLS and proxies from loopback. Without this every request
   * appears to come from 127.0.0.1, collapsing all per-IP rate limits into one
   * shared bucket that throttles every recipient at once.
   */
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const allowedOrigins = new Set([env.publicWebOrigin, ...env.corsOrigins]);
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      // No Origin header: native app, server-to-server, curl. Not a browser, so
      // CORS has nothing to protect here.
      if (!origin) return callback(null, true);
      callback(null, allowedOrigins.has(origin.replace(/\/+$/, '')));
    },
    credentials: false,
    maxAge: 86400,
  };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: BODY.jsonLimit }));
  app.use(requestLog);

  app.use(rootRouter);

  // Terminal 404 — a bare '*' path is invalid under Express 5's path-to-regexp.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function start(): void {
  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info('Momentica API listening', {
      port: env.port,
      env: env.nodeEnv,
      storage: env.s3 ? 'enabled' : 'disabled',
      billing: env.revenueCat ? 'enabled' : 'disabled',
      ai: env.ai ? 'enabled' : 'disabled',
    });
  });

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(() => {
      void disconnectPrisma().finally(() => process.exit(0));
    });
    // Don't hang forever on lingering keep-alive sockets.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start();
}
