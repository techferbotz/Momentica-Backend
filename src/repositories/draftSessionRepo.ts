import type { DraftSession } from '@prisma/client';
import { prisma } from './prisma';

export async function create(tokenHash: string): Promise<DraftSession> {
  return prisma.draftSession.create({ data: { tokenHash } });
}

export async function findByHash(tokenHash: string): Promise<DraftSession | null> {
  return prisma.draftSession.findUnique({ where: { tokenHash } });
}

export async function touch(id: string): Promise<void> {
  await prisma.draftSession.update({ where: { id }, data: { lastSeenAt: new Date() } });
}

/**
 * Moves everything the device made anonymously onto the signed-in account.
 * `draftSessionId` is cleared in the same step: leaving it set would keep the
 * rows in the session's cascade path, so purging the session later would delete
 * creations the user now owns.
 */
export async function claimFor(
  draftSessionId: string,
  userId: string,
): Promise<{ creations: number; images: number }> {
  const [, creations, images] = await prisma.$transaction([
    prisma.draftSession.update({
      where: { id: draftSessionId },
      data: { claimedByUserId: userId, lastSeenAt: new Date() },
    }),
    prisma.creation.updateMany({
      where: { draftSessionId, deletedAt: null },
      data: { ownerUserId: userId, draftSessionId: null },
    }),
    prisma.image.updateMany({
      where: { draftSessionId, deletedAt: null },
      data: { ownerUserId: userId, draftSessionId: null },
    }),
  ]);

  return { creations: creations.count, images: images.count };
}

export async function findAbandoned(cutoff: Date, limit: number): Promise<DraftSession[]> {
  return prisma.draftSession.findMany({
    where: { claimedByUserId: null, lastSeenAt: { lt: cutoff } },
    take: limit,
  });
}

export async function deleteById(id: string): Promise<void> {
  await prisma.draftSession.delete({ where: { id } });
}
