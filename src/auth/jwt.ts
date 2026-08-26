import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { RENDER } from '../config/constants';
import { ErrorCode, NotFoundError, UnauthorizedError } from '../errors/AppError';

/** The only module that imports jsonwebtoken. */

const ISSUER = 'momentica';
const AUDIENCE = 'momentica-app';
/** Separate audience so an access token can never stand in for a preview token. */
const PREVIEW_AUDIENCE = 'momentica-draft-preview';

export interface AccessTokenClaims {
  userId: string;
}

/**
 * Short-lived (15 min by default) and carries identity only. Entitlement lives
 * in the database: a token minted before a purchase would otherwise deny access
 * the user has already paid for, for the life of the token.
 */
export function signAccessToken(userId: string): { token: string; expiresIn: number } {
  const expiresIn = env.accessTokenTtlSeconds;
  const token = jwt.sign({}, env.jwtSecret, {
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
    expiresIn,
  });
  return { token, expiresIn };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const userId = typeof payload === 'string' ? undefined : payload.sub;
    if (!userId) throw new Error('missing subject');
    return { userId };
  } catch {
    throw new UnauthorizedError('Invalid or expired access token', ErrorCode.INVALID_TOKEN);
  }
}

/**
 * Short-lived link that lets the renderer show a creator their own unpaid draft.
 * Signed rather than stored: it expires on its own and needs no cleanup, and the
 * draft it names is worthless to anyone else.
 */
export function signDraftPreviewToken(creationId: string): { token: string; expiresAt: Date } {
  const expiresIn = RENDER.draftTokenTtlSeconds;
  const token = jwt.sign({}, env.jwtSecret, {
    subject: creationId,
    issuer: ISSUER,
    audience: PREVIEW_AUDIENCE,
    algorithm: 'HS256',
    expiresIn,
  });
  return { token, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

export function verifyDraftPreviewToken(token: string): { creationId: string } {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: ISSUER,
      audience: PREVIEW_AUDIENCE,
      algorithms: ['HS256'],
    });
    const creationId = typeof payload === 'string' ? undefined : payload.sub;
    if (!creationId) throw new Error('missing subject');
    return { creationId };
  } catch {
    // Reported as absent, not rejected: to a recipient an expired preview link
    // and a made-up one are the same thing, and saying which is which would
    // confirm that a particular draft exists.
    throw new NotFoundError('This preview link has expired', ErrorCode.NOT_FOUND);
  }
}
