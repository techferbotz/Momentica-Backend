import type { User } from '@prisma/client';
import { prisma } from './prisma';
import type { GoogleIdentity } from '../auth/googleAuth';

/** Soft-deleted users are invisible to every read path. */
export async function findActiveById(id: string): Promise<User | null> {
  return prisma.user.findFirst({ where: { id, deletedAt: null } });
}

export async function findByGoogleSub(googleSub: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { googleSub } });
}

/**
 * Signing in again after account deletion restores the account itself but not
 * its content: creations tombstoned at deletion stay tombstoned.
 */
export async function upsertFromGoogle(identity: GoogleIdentity): Promise<User> {
  return prisma.user.upsert({
    where: { googleSub: identity.googleSub },
    create: {
      googleSub: identity.googleSub,
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
    },
    update: {
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      deletedAt: null,
    },
  });
}

export async function softDelete(id: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { deletedAt: now } }),
    prisma.creation.updateMany({
      where: { ownerUserId: id, deletedAt: null },
      data: { deletedAt: now, shareCode: null },
    }),
    prisma.image.updateMany({
      where: { ownerUserId: id, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}

export async function findDeletedBefore(cutoff: Date): Promise<Pick<User, 'id'>[]> {
  return prisma.user.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: { id: true },
  });
}

export async function hardDelete(id: string): Promise<void> {
  await prisma.user.delete({ where: { id } });
}
