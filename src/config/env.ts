/**
 * The ONLY module in this codebase permitted to read `process.env`.
 *
 * Everything is validated once, at startup, and the process refuses to boot on a
 * bad configuration. Optional feature groups (S3, RevenueCat, AI) resolve to
 * `null` when absent so the app still boots and the owning module answers 503 —
 * but a *partially* configured group is treated as a mistake and fails hard,
 * because silently disabling a feature someone thought they had enabled is worse
 * than not starting.
 */
import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

export type NodeEnv = 'development' | 'production' | 'test';

const problems: string[] = [];

function readRequired(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    problems.push(`${key} is required but missing`);
    return '';
  }
  return value;
}

function readOptional(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function readNumber(key: string, fallback: number): number {
  const raw = readOptional(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    problems.push(`${key} must be a number, got "${raw}"`);
    return fallback;
  }
  return parsed;
}

/**
 * Feature groups are all-or-nothing: every key present enables it, none present
 * disables it, and anything in between is a configuration error.
 */
function readGroup<T extends Record<string, string>>(
  label: string,
  keys: { [K in keyof T]: string },
): T | null {
  const entries = Object.entries(keys) as [keyof T, string][];
  const found = entries.map(([field, envKey]) => [field, readOptional(envKey)] as const);
  const present = found.filter(([, value]) => value !== undefined);

  if (present.length === 0) return null;

  if (present.length !== entries.length) {
    const missing = found
      .filter(([, value]) => value === undefined)
      .map(([field]) => keys[field])
      .join(', ');
    problems.push(`${label} is partially configured — also set: ${missing}`);
    return null;
  }

  return Object.fromEntries(found) as T;
}

const rawNodeEnv = readOptional('NODE_ENV') ?? 'production';
if (!['development', 'production', 'test'].includes(rawNodeEnv)) {
  problems.push(`NODE_ENV must be development, production or test, got "${rawNodeEnv}"`);
}
const nodeEnv = rawNodeEnv as NodeEnv;
const isProduction = nodeEnv === 'production';

const jwtSecret = readRequired('JWT_SECRET');
if (jwtSecret && jwtSecret.length < 32) {
  problems.push('JWT_SECRET must be at least 32 characters');
}

/**
 * The dev-only login bypass mints tokens for arbitrary users. Refusing to boot a
 * production process that carries the secret is the guard that matters — a
 * route-registration check alone would be defeated by a copied .env file.
 */
const testLoginSecret = readOptional('TEST_LOGIN_SECRET') ?? null;
if (testLoginSecret && isProduction) {
  problems.push('TEST_LOGIN_SECRET must not be set when NODE_ENV=production');
}

const publicWebOrigin = readRequired('PUBLIC_WEB_ORIGIN').replace(/\/+$/, '');

const s3 = readGroup('S3 storage', {
  region: 'AWS_REGION',
  bucket: 'AWS_S3_BUCKET',
  accessKeyId: 'AWS_ACCESS_KEY_ID',
  secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
  publicBaseUrl: 'S3_PUBLIC_BASE_URL',
});

const revenueCat = readGroup('RevenueCat billing', {
  apiKey: 'REVENUECAT_API_KEY',
  projectId: 'REVENUECAT_PROJECT_ID',
  webhookSecret: 'REVENUECAT_WEBHOOK_SECRET',
});

const anthropicApiKey = readOptional('ANTHROPIC_API_KEY');

export const env = {
  nodeEnv,
  isProduction,
  isDevelopment: nodeEnv === 'development',
  port: readNumber('PORT', 3000),

  databaseUrl: readRequired('DATABASE_URL'),

  jwtSecret,
  accessTokenTtlSeconds: readNumber('ACCESS_TOKEN_TTL_SECONDS', 15 * 60),
  refreshTokenTtlDays: readNumber('REFRESH_TOKEN_TTL_DAYS', 60),
  googleClientId: readRequired('GOOGLE_CLIENT_ID'),
  testLoginSecret,

  /** Where the rendered experiences live, e.g. https://momentica.ferbotz.com */
  publicWebOrigin,
  /** Extra browser origins allowed to call this API, comma-separated. */
  corsOrigins: (readOptional('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),

  s3,
  revenueCat,
  ai: anthropicApiKey
    ? { apiKey: anthropicApiKey, model: readOptional('AI_MODEL') ?? 'claude-opus-5' }
    : null,
} as const;

if (problems.length > 0) {
  throw new Error(
    `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
      'See .env.example for the full list.',
  );
}

export type Env = typeof env;
