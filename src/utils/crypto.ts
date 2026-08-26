import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Opaque token for refresh tokens and draft sessions: 32 random bytes, base64url. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are stored only as their sha256 digest, so a database dump can't be
 * replayed against the API. A plain digest (no salt/stretching) is correct here:
 * the input is 256 bits of entropy, not a guessable password.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare for shared secrets (webhook signatures, dev login). */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length isn't leaked through timing.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function randomId(): string {
  return randomBytes(16).toString('hex');
}
