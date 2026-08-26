import type { User } from '@prisma/client';
import { env } from '../config/env';
import { ErrorCode, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/AppError';
import { signAccessToken } from '../auth/jwt';
import { verifyGoogleIdToken } from '../auth/googleAuth';
import * as userRepo from '../repositories/userRepo';
import * as refreshTokenRepo from '../repositories/refreshTokenRepo';
import * as draftSessionService from './draftSessionService';
import { generateOpaqueToken, hashToken, randomId, safeCompare } from '../utils/crypto';
import { logger } from '../utils/logger';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: PublicUser;
  claimed?: { creations: number; images: number };
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueSession(userId: string, familyId: string): Promise<{
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenId: string;
}> {
  const { token: accessToken, expiresIn } = signAccessToken(userId);
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  const row = await refreshTokenRepo.create({
    userId,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt,
  });

  return { accessToken, expiresIn, refreshToken, refreshTokenId: row.id };
}

/**
 * Sign-in happens at publish time, so the caller can hand us the device's draft
 * token and have its work adopted in the same round trip — that moment is the
 * conversion point and every extra call is a chance to lose the user.
 */
export async function loginWithGoogle(
  idToken: string,
  draftToken?: string,
): Promise<AuthSession> {
  const identity = await verifyGoogleIdToken(idToken);
  const user = await userRepo.upsertFromGoogle(identity);
  const issued = await issueSession(user.id, randomId());

  const claimed = draftToken ? await draftSessionService.claim(draftToken, user.id) : undefined;

  return {
    accessToken: issued.accessToken,
    expiresIn: issued.expiresIn,
    refreshToken: issued.refreshToken,
    user: toPublicUser(user),
    ...(claimed ? { claimed } : {}),
  };
}

/**
 * Rotating refresh with theft detection.
 *
 * Each refresh mints a replacement and revokes the presented token. If a token
 * that was already rotated shows up again, two parties hold the same secret —
 * we can't tell which one is the thief, so the entire rotation family is revoked
 * and both are forced to sign in again.
 */
export async function refresh(rawToken: string): Promise<AuthSession> {
  const existing = await refreshTokenRepo.findByHash(hashToken(rawToken));

  if (!existing) {
    throw new UnauthorizedError('Invalid refresh token', ErrorCode.INVALID_TOKEN);
  }

  if (existing.revokedAt) {
    await refreshTokenRepo.revokeFamily(existing.familyId);
    logger.warn('Refresh token reuse detected — family revoked', {
      userId: existing.userId,
      familyId: existing.familyId,
    });
    throw new UnauthorizedError('Session expired, please sign in again', ErrorCode.REFRESH_REUSED);
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Refresh token expired', ErrorCode.INVALID_TOKEN);
  }

  const user = await userRepo.findActiveById(existing.userId);
  if (!user) {
    throw new UnauthorizedError('Invalid refresh token', ErrorCode.INVALID_TOKEN);
  }

  const issued = await issueSession(user.id, existing.familyId);
  await refreshTokenRepo.markRotated(existing.id, issued.refreshTokenId);

  return {
    accessToken: issued.accessToken,
    expiresIn: issued.expiresIn,
    refreshToken: issued.refreshToken,
    user: toPublicUser(user),
  };
}

/** Logout is best-effort by design: an unknown token is already not a session. */
export async function logout(rawToken: string): Promise<void> {
  await refreshTokenRepo.revokeByHash(hashToken(rawToken));
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await userRepo.findActiveById(userId);
  if (!user) throw new NotFoundError('Account not found', ErrorCode.NOT_FOUND);
  return toPublicUser(user);
}

export async function deleteAccount(userId: string): Promise<void> {
  const user = await userRepo.findActiveById(userId);
  if (!user) throw new NotFoundError('Account not found', ErrorCode.NOT_FOUND);
  await userRepo.softDelete(userId);
}

export async function claimDrafts(
  draftToken: string,
  userId: string,
): Promise<{ creations: number; images: number }> {
  return draftSessionService.claim(draftToken, userId);
}

/**
 * Development-only sign-in. Google ID tokens can't be minted from a smoke test,
 * so this stands in for one. `env.ts` refuses to boot a production process that
 * carries the secret, which is the guard that actually matters.
 */
export async function testLogin(secret: string, email: string): Promise<AuthSession> {
  if (!env.testLoginSecret || !env.isDevelopment) {
    throw new NotFoundError('Route not found', ErrorCode.NOT_FOUND);
  }
  if (!safeCompare(secret, env.testLoginSecret)) {
    throw new ForbiddenError('Invalid test login secret');
  }

  const user = await userRepo.upsertFromGoogle({
    googleSub: `test:${email}`,
    email,
    name: email.split('@')[0] ?? 'Tester',
    avatarUrl: null,
  });
  const issued = await issueSession(user.id, randomId());

  return {
    accessToken: issued.accessToken,
    expiresIn: issued.expiresIn,
    refreshToken: issued.refreshToken,
    user: toPublicUser(user),
  };
}
