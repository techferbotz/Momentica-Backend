import type { ErrorRequestHandler, RequestHandler } from 'express';
import {
  AppError,
  BadRequestError,
  ErrorCode,
  NotFoundError,
  PayloadTooLargeError,
} from '../errors/AppError';
import { logger } from '../utils/logger';

/** Body-parser and multer failures arrive as plain errors carrying a `type`/`name`. */
interface TaggedError {
  type?: string;
  name?: string;
  code?: string;
  message?: string;
}

function translateKnownLibraryError(err: unknown): AppError | null {
  const tagged = err as TaggedError;

  // express.json() rejections — malformed or oversized JSON bodies.
  if (tagged?.type === 'entity.parse.failed') {
    return new BadRequestError('Request body is not valid JSON', ErrorCode.VALIDATION_FAILED);
  }
  if (tagged?.type === 'entity.too.large') {
    return new PayloadTooLargeError('Request body is too large', ErrorCode.VALIDATION_FAILED);
  }

  // Duck-typed rather than imported: multer stays behind middleware/upload.ts.
  // That module already translates these, so this is only a safety net.
  if (tagged?.name === 'MulterError') {
    const message =
      tagged.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large'
        : tagged.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Unexpected file field'
          : 'File upload rejected';
    return new BadRequestError(message, ErrorCode.VALIDATION_FAILED);
  }

  return null;
}

/** Terminal 404 for anything no route matched. Mounted with `app.use`, not a path. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found', ErrorCode.NOT_FOUND));
};

/**
 * The single place a failure becomes a response.
 * Express 5 forwards rejected async handler promises here automatically.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = err instanceof AppError ? err : translateKnownLibraryError(err);

  if (appError) {
    if (appError.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    }
    // A 500 we raised ourselves is a bug and gets a stack. Other 5xx (503 from an
    // unconfigured feature group) are operational, not defects — warn, no stack.
    if (appError.status === 500) {
      logger.error(appError.message, { path: req.path, method: req.method, stack: appError.stack });
    } else if (appError.status > 500) {
      logger.warn(appError.message, { path: req.path, method: req.method, code: appError.code });
    }
    res.status(appError.status).json({
      success: false,
      message: appError.message,
      ...(appError.code ? { code: appError.code } : {}),
    });
    return;
  }

  // Anything unrecognised is a bug. Log everything, tell the client nothing —
  // internal messages can leak schema details, file paths and query fragments.
  logger.error('Unhandled error', {
    path: req.path,
    method: req.method,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({
    success: false,
    message: 'Something went wrong',
    code: ErrorCode.INTERNAL,
  });
};
