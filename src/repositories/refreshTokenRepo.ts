import type { RefreshToken } from '@prisma/client';
import { prisma } from './prisma';

export async function create(input: {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}): Promise<RefreshToken> {
  return prisma.refreshToken.create({ data: input });
}

export async function findByHash(tokenHash: string): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export async function markRotated(id: string, replacedById: string): Promise<void> {
  await prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date(), replacedById },
  });
}

export async function revokeByHash(tokenHash: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Theft response: one stolen token being replayed invalidates every token in its
 * rotation family, forcing both the attacker and the legitimate device to sign
 * in again.
 */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function deleteExpiredBefore(cutoff: Date): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}
