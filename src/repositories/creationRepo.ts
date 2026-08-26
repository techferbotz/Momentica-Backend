import type { Creation, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import type { Principal } from '../middleware/principal';

/**
 * Every read and write here is scoped to the owning principal. A row that
 * belongs to somebody else simply doesn't match, so callers naturally report it
 * as absent rather than forbidden.
 */
export function ownerWhere(principal: Principal): Prisma.CreationWhereInput {
  return principal.kind === 'user'
    ? { ownerUserId: principal.userId }
    : { draftSessionId: principal.draftSessionId };
}

function ownerData(principal: Principal): Pick<Prisma.CreationUncheckedCreateInput, 'ownerUserId' | 'draftSessionId'> {
  return principal.kind === 'user'
    ? { ownerUserId: principal.userId, draftSessionId: null }
    : { ownerUserId: null, draftSessionId: principal.draftSessionId };
}

export async function create(
  principal: Principal,
  input: { templateId: string; data: Prisma.InputJsonValue; coverImageId?: string | null },
): Promise<Creation> {
  return prisma.creation.create({
    data: {
      templateId: input.templateId,
      data: input.data,
      coverImageId: input.coverImageId ?? null,
      ...ownerData(principal),
    },
  });
}

export async function findOwned(principal: Principal, id: string): Promise<Creation | null> {
  return prisma.creation.findFirst({
    where: { id, deletedAt: null, ...ownerWhere(principal) },
  });
}

export async function listOwned(
  principal: Principal,
  offset: number,
  limit: number,
): Promise<{ items: Creation[]; total: number }> {
  const where: Prisma.CreationWhereInput = { deletedAt: null, ...ownerWhere(principal) };
  const [items, total] = await prisma.$transaction([
    prisma.creation.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: offset, take: limit }),
    prisma.creation.count({ where }),
  ]);
  return { items, total };
}

/** Only unpublished drafts count against the per-principal cap. */
export async function countDrafts(principal: Principal): Promise<number> {
  return prisma.creation.count({
    where: { deletedAt: null, status: 'DRAFT', ...ownerWhere(principal) },
  });
}

export async function update(
  id: string,
  patch: { templateId?: string; data?: Prisma.InputJsonValue; coverImageId?: string | null },
): Promise<Creation> {
  return prisma.creation.update({ where: { id }, data: patch });
}

/**
 * Soft delete also releases the share code: a tombstoned creation holding one
 * would keep that code unusable forever.
 */
export async function softDelete(id: string): Promise<void> {
  await prisma.creation.update({
    where: { id },
    data: { deletedAt: new Date(), shareCode: null },
  });
}

export async function findByShareCode(shareCode: string): Promise<Creation | null> {
  return prisma.creation.findFirst({ where: { shareCode, deletedAt: null } });
}

export async function findById(id: string): Promise<Creation | null> {
  return prisma.creation.findFirst({ where: { id, deletedAt: null } });
}

export async function publish(
  id: string,
  input: { shareCode: string; expiresAt: Date },
): Promise<Creation> {
  return prisma.creation.update({
    where: { id },
    data: {
      status: 'PUBLISHED',
      shareCode: input.shareCode,
      publishedAt: new Date(),
      expiresAt: input.expiresAt,
    },
  });
}

/** Keeps the existing share code so links already sent keep working. */
export async function extendExpiry(id: string, expiresAt: Date): Promise<Creation> {
  return prisma.creation.update({ where: { id }, data: { expiresAt } });
}

/**
 * Counted separately from the render fetch so link-preview crawlers and
 * prefetchers don't inflate the number the creator sees.
 */
export async function recordView(id: string, day: Date): Promise<void> {
  await prisma.$transaction([
    prisma.creation.update({ where: { id }, data: { viewCount: { increment: 1 } } }),
    prisma.viewDaily.upsert({
      where: { creationId_date: { creationId: id, date: day } },
      create: { creationId: id, date: day, count: 1 },
      update: { count: { increment: 1 } },
    }),
  ]);
}
