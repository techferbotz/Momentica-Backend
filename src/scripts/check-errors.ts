/**
 * Verifies the response envelope contract end to end against the real Express
 * app: every success is { success, data }, every failure is
 * { success, message, code? }, and each AppError subclass maps to its status.
 *
 * Runs in-process on an ephemeral port. No database required.
 */
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApp } from '../app';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ErrorCode,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../errors/AppError';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';
import { check, expectEqual, expectTrue, report } from './checkUtil';

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: any;
}

/**
 * A second app wired from the same middleware as the real one. Fixture routes
 * cannot be added to `createApp()`'s output because its terminal 404 handler is
 * already mounted, and everything after it is unreachable.
 */
function buildThrowingApp(): express.Express {
  const app = express();
  app.get('/__throw/:kind', (req) => {
    const kind = req.params.kind;
    const map: Record<string, AppError> = {
      bad: new BadRequestError('bad input', ErrorCode.VALIDATION_FAILED),
      unauthorized: new UnauthorizedError('no token', ErrorCode.AUTH_REQUIRED),
      forbidden: new ForbiddenError('nope'),
      notfound: new NotFoundError('gone', ErrorCode.NOT_FOUND),
      conflict: new ConflictError('dupe'),
      toolarge: new PayloadTooLargeError('too big'),
      ratelimited: new TooManyRequestsError('slow down', ErrorCode.RATE_LIMITED, 42),
      unavailable: new ServiceUnavailableError('no storage', ErrorCode.STORAGE_UNAVAILABLE),
    };
    throw map[kind] ?? new Error('boom: raw error with a leaky message');
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function listen(app: express.Express): Promise<{ base: string; close: () => void }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

async function main(): Promise<void> {
  const real = await listen(createApp());
  const throwing = await listen(buildThrowingApp());

  const requestTo = (base: string) => async (path: string, init?: RequestInit): Promise<Reply> => {
    const res = await fetch(`${base}${path}`, init);
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.json().catch(() => null),
    };
  };
  const request = requestTo(real.base);
  const requestThrow = requestTo(throwing.base);

  await check('health returns the success envelope', async () => {
    const res = await request('/health');
    expectEqual(res.status, 200, 'status');
    expectEqual(res.body.success, true, 'success flag');
    expectEqual(res.body.data.status, 'ok', 'data.status');
    expectTrue(!('message' in res.body), 'success responses carry no message');
  });

  const cases: [string, number, string | undefined][] = [
    ['bad', 400, ErrorCode.VALIDATION_FAILED],
    ['unauthorized', 401, ErrorCode.AUTH_REQUIRED],
    ['forbidden', 403, undefined],
    ['notfound', 404, ErrorCode.NOT_FOUND],
    ['conflict', 409, undefined],
    ['toolarge', 413, undefined],
    ['ratelimited', 429, ErrorCode.RATE_LIMITED],
    ['unavailable', 503, ErrorCode.STORAGE_UNAVAILABLE],
  ];

  for (const [kind, status, code] of cases) {
    await check(`${kind} maps to ${status}`, async () => {
      const res = await requestThrow(`/__throw/${kind}`);
      expectEqual(res.status, status, 'status');
      expectEqual(res.body.success, false, 'success flag');
      expectTrue(typeof res.body.message === 'string', 'message is a string');
      expectEqual(res.body.code, code, 'code');
      expectTrue(!('data' in res.body), 'failures carry no data field');
    });
  }

  await check('429 sets Retry-After', async () => {
    const res = await requestThrow('/__throw/ratelimited');
    expectEqual(res.headers['retry-after'], '42', 'retry-after header');
  });

  await check('an unrecognised error never leaks its message', async () => {
    const res = await requestThrow('/__throw/anything-else');
    expectEqual(res.status, 500, 'status');
    expectEqual(res.body.message, 'Something went wrong', 'generic message');
    expectEqual(res.body.code, ErrorCode.INTERNAL, 'code');
    expectTrue(!JSON.stringify(res.body).includes('leaky'), 'internal detail is not echoed');
  });

  await check('unmatched routes 404 through the envelope', async () => {
    const res = await request('/no/such/route');
    expectEqual(res.status, 404, 'status');
    expectEqual(res.body.success, false, 'success flag');
    expectEqual(res.body.code, ErrorCode.NOT_FOUND, 'code');
  });

  await check('malformed JSON becomes a 400, not a 500', async () => {
    const res = await request('/__echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"nope"',
    });
    expectEqual(res.status, 400, 'status');
    expectEqual(res.body.success, false, 'success flag');
    expectEqual(res.body.code, ErrorCode.VALIDATION_FAILED, 'code');
  });

  await check('oversized JSON becomes a 413, not a 500', async () => {
    const res = await request('/__echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expectEqual(res.status, 413, 'status');
    expectEqual(res.body.code, ErrorCode.VALIDATION_FAILED, 'code');
  });

  real.close();
  throwing.close();
  report('check-errors');
}

void main();
