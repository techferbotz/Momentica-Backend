/** Tunable limits. Everything policy-shaped lives here rather than inline in services. */

export const BODY = {
  /** express.json default is 100 KB — too small for `data` with long text and group lists. */
  jsonLimit: '1mb',
} as const;

export const PAGINATION = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

export const CREATION_LIMITS = {
  /** Drafts one principal (anonymous device or logged-in user) may hold at once. */
  maxDraftsPerPrincipal: 20,
  maxImagesPerPrincipal: 60,
  /** Unclaimed draft sessions untouched for this long are purged with their images. */
  abandonedDraftDays: 7,
} as const;

export const SHARE_CODE = {
  length: 8,
  /** Full base62. Codes are tapped from a link, never typed, so glyph ambiguity is fine. */
  alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  maxGenerationAttempts: 8,
} as const;

export const RENDER = {
  previewCodePrefix: 'pv_',
  draftCodePrefix: 'd_',
  /** How long a creator's pre-payment preview link stays valid. */
  draftTokenTtlSeconds: 30 * 60,
} as const;

export const UPLOAD = {
  maxBytes: 8 * 1024 * 1024,
  fieldName: 'file',
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  full: { maxDimension: 1280, quality: 75 },
  thumb: { maxDimension: 512, quality: 60 },
} as const;

export const RSVP = {
  maxPerCreation: 2000,
  maxGuestCount: 20,
  maxMessageLength: 500,
} as const;

export const STATS = {
  dailySeriesDays: 30,
} as const;

/**
 * Sliding-window rate limits: `limit` requests per `windowSeconds`.
 * In-memory, so these are per-process — fine on a single instance, and the
 * documented scale-out step is a shared store.
 */
export const RATE_LIMITS = {
  render: { limit: 60, windowSeconds: 60 },
  view: { limit: 30, windowSeconds: 60 },
  rsvp: { limit: 5, windowSeconds: 60 },
  auth: { limit: 10, windowSeconds: 60 },
  draftSession: { limit: 10, windowSeconds: 3600 },
  upload: { limit: 20, windowSeconds: 3600 },
  publish: { limit: 20, windowSeconds: 3600 },
  ai: { limit: 10, windowSeconds: 60 },
} as const;
