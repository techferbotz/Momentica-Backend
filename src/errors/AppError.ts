/**
 * Every failure response in this API originates from one of these.
 *
 * Controllers and services `throw`; the central error handler is the only place
 * that turns a thrown value into an HTTP response. Nothing calls
 * `res.status(...).json(...)` for an error by hand.
 */

/** Machine-readable codes the mobile app and web renderer branch on. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_TEMPLATE: 'INVALID_TEMPLATE',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',

  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_GOOGLE_TOKEN: 'INVALID_GOOGLE_TOKEN',
  REFRESH_REUSED: 'REFRESH_REUSED',

  NOT_FOUND: 'NOT_FOUND',
  DRAFT_LIMIT_REACHED: 'DRAFT_LIMIT_REACHED',
  IMAGE_LIMIT_REACHED: 'IMAGE_LIMIT_REACHED',
  RSVP_CLOSED: 'RSVP_CLOSED',
  ALREADY_PUBLISHED: 'ALREADY_PUBLISHED',
  NOT_PUBLISHED: 'NOT_PUBLISHED',

  PURCHASE_NOT_VERIFIED: 'PURCHASE_NOT_VERIFIED',
  PURCHASE_ALREADY_USED: 'PURCHASE_ALREADY_USED',
  UNKNOWN_PRODUCT: 'UNKNOWN_PRODUCT',

  RATE_LIMITED: 'RATE_LIMITED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  BILLING_UNAVAILABLE: 'BILLING_UNAVAILABLE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export abstract class AppError extends Error {
  abstract readonly status: number;
  readonly code: ErrorCodeValue | undefined;
  /** Seconds the client should wait; surfaced as Retry-After on 429/503. */
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, code?: ErrorCodeValue, retryAfterSeconds?: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  readonly status = 400;
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
}

export class ForbiddenError extends AppError {
  readonly status = 403;
}

/**
 * Also the answer for rows that exist but belong to somebody else — we never
 * distinguish "not yours" from "not there", so the API can't be used to probe
 * for the existence of another user's creation.
 */
export class NotFoundError extends AppError {
  readonly status = 404;
}

export class ConflictError extends AppError {
  readonly status = 409;
}

export class PayloadTooLargeError extends AppError {
  readonly status = 413;
}

export class TooManyRequestsError extends AppError {
  readonly status = 429;
}

/** An optional feature group (S3, RevenueCat, AI) is not configured. */
export class ServiceUnavailableError extends AppError {
  readonly status = 503;
}
