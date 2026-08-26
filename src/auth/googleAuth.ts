import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { ErrorCode, UnauthorizedError } from '../errors/AppError';

/** The only module that imports google-auth-library. */

export interface GoogleIdentity {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

const client = new OAuth2Client(env.googleClientId);

/**
 * Verifies the signature, expiry and issuer of a Google ID token, and pins the
 * audience to our client id — without the audience check a token minted for any
 * other Google app would authenticate here.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new UnauthorizedError('Google sign-in failed', ErrorCode.INVALID_GOOGLE_TOKEN);
  }

  if (!payload?.sub) {
    throw new UnauthorizedError('Google sign-in failed', ErrorCode.INVALID_GOOGLE_TOKEN);
  }
  if (payload.aud !== env.googleClientId) {
    throw new UnauthorizedError('Google sign-in failed', ErrorCode.INVALID_GOOGLE_TOKEN);
  }
  if (!payload.email) {
    throw new UnauthorizedError('Google account has no email address', ErrorCode.INVALID_GOOGLE_TOKEN);
  }

  return {
    googleSub: payload.sub,
    email: payload.email,
    name: payload.name?.trim() || payload.email.split('@')[0] || 'Friend',
    avatarUrl: payload.picture ?? null,
  };
}
