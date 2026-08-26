/**
 * Hand-written request-body parsing.
 *
 * Every helper throws BadRequestError, so controllers can parse straight into
 * typed locals and let the central error handler shape the response.
 */
import { BadRequestError, ErrorCode } from '../errors/AppError';

function fail(message: string): never {
  throw new BadRequestError(message, ErrorCode.VALIDATION_FAILED);
}

export function asObject(value: unknown, what = 'Request body'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

export interface StringOptions {
  maxLength?: number;
  minLength?: number;
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  options: StringOptions = {},
): string {
  const raw = obj[key];
  if (typeof raw !== 'string') fail(`"${key}" is required and must be a string`);
  const value = raw.trim();
  const { minLength = 1, maxLength } = options;
  if (value.length < minLength) fail(`"${key}" must be at least ${minLength} characters`);
  if (maxLength !== undefined && value.length > maxLength) {
    fail(`"${key}" must be at most ${maxLength} characters`);
  }
  return value;
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  options: StringOptions = {},
): string | undefined {
  if (obj[key] === undefined || obj[key] === null || obj[key] === '') return undefined;
  return requireString(obj, key, options);
}

export function requireOneOf<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = requireString(obj, key);
  if (!(allowed as readonly string[]).includes(value)) {
    fail(`"${key}" must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function optionalInt(
  obj: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value)) fail(`"${key}" must be a whole number`);
  if (options.min !== undefined && value < options.min) {
    fail(`"${key}" must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    fail(`"${key}" must be at most ${options.max}`);
  }
  return value;
}

/** Clamped page size from a query string. */
export function parseLimit(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    fail('"limit" must be a positive whole number');
  }
  return Math.min(value, max);
}
