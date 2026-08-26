import type { Image, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import type { Principal } from '../middleware/principal';

export function ownerWhere(principal: Principal): Prisma.ImageWhereInput {
  return principal.kind === 'user'
    ? { ownerUserId: principal.userId }
    : { draftSessionId: principal.draftSessionId };
}

export async function create(
  principal: Principal,
  input: {
    keyFull: string;
    keyThumb: string;
    width: number;
    height: number;
    bytes: number;
    creationId?: string | null;
  },
): Promise<Image> {
  return prisma.image.create({
    data: {
      ...input,
      creationId: input.creationId ?? null,
      ...(principal.kind === 'user'
        ? { ownerUserId: principal.userId }
        : { draftSessionId: principal.draftSessionId }),
    },
  });
}

export async function findOwned(principal: Principal, id: string): Promise<Image | null> {
  return prisma.image.findFirst({ where: { id, deletedAt: null, ...ownerWhere(principal) } });
}

/**
 * Used to confirm every image referenced by a creation's data actually belongs
 * to whoever is saving it — otherwise one user could embed another's photos by
 * guessing an id.
 */
export async function findOwnedByIds(principal: Principal, ids: string[]): Promise<Image[]> {
  if (ids.length === 0) return [];
  return prisma.image.findMany({
    where: { id: { in: ids }, deletedAt: null, ...ownerWhere(principal) },
  });
}

export async function findByIds(ids: string[]): Promise<Image[]> {
  if (ids.length === 0) return [];
  return prisma.image.findMany({ where: { id: { in: ids }, deletedAt: null } });
}

export async function countOwned(principal: Principal): Promise<number> {
  return prisma.image.count({ where: { deletedAt: null, ...ownerWhere(principal) } });
}

export async function attachToCreation(ids: string[], creationId: string): Promise<void> {
  if (ids.length === 0) return;
  await prisma.image.updateMany({
    where: { id: { in: ids } },
    data: { creationId },
  });
}

export async function softDelete(id: string): Promise<void> {
  await prisma.image.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Images uploaded but never attached to a creation, older than the cutoff.
 * The cleanup script removes their S3 objects before deleting the rows.
 */
export async function findOrphans(cutoff: Date, limit: number): Promise<Image[]> {
  return prisma.image.findMany({
    where: {
      creationId: null,
      createdAt: { lt: cutoff },
    },
    take: limit,
  });
}

export async function hardDelete(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await prisma.image.deleteMany({ where: { id: { in: ids } } });
  return count;
}
