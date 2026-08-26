import type { RequestHandler } from 'express';
import { ErrorCode, UnauthorizedError } from '../errors/AppError';
import { verifyAccessToken } from '../auth/jwt';
import * as draftSessionService from '../services/draftSessionService';

/**
 * Who owns the rows this request touches. Before sign-in that's an anonymous
 * device; afterwards it's the account. Repositories scope every query by it.
 */
export type Principal =
  | { kind: 'user'; userId: string }
  | { kind: 'draft'; draftSessionId: string };

export const DRAFT_TOKEN_HEADER = 'x-draft-token';

function readBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

/** Signed-in users only. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = readBearer(req.header('authorization'));
  if (!token) {
    next(new UnauthorizedError('Authentication required', ErrorCode.AUTH_REQUIRED));
    return;
  }
  const { userId } = verifyAccessToken(token);
  req.userId = userId;
  req.principal = { kind: 'user', userId };
  next();
};

/**
 * A signed-in user or an anonymous device. An access token always wins: once
 * someone is signed in, their drafts have been claimed and the device token is
 * stale.
 */
export const requirePrincipal: RequestHandler = async (req, _res, next) => {
  try {
    const bearer = readBearer(req.header('authorization'));
    if (bearer) {
      const { userId } = verifyAccessToken(bearer);
      req.userId = userId;
      req.principal = { kind: 'user', userId };
      next();
      return;
    }

    const draftToken = req.header(DRAFT_TOKEN_HEADER)?.trim();
    if (draftToken) {
      const draftSessionId = await draftSessionService.resolve(draftToken);
      if (draftSessionId) {
        req.principal = { kind: 'draft', draftSessionId };
        void draftSessionService.touch(draftSessionId).catch(() => undefined);
        next();
        return;
      }
    }

    next(
      new UnauthorizedError(
        'Sign in or send a draft session token',
        ErrorCode.AUTH_REQUIRED,
      ),
    );
  } catch (err) {
    next(err);
  }
};

export function principalOf(req: { principal?: Principal }): Principal {
  if (!req.principal) {
    // A programming error: the route forgot requirePrincipal.
    throw new UnauthorizedError('Authentication required', ErrorCode.AUTH_REQUIRED);
  }
  return req.principal;
}
