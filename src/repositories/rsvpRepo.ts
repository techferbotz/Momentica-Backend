import type { RsvpAnswer, RsvpResponse } from '@prisma/client';
import { prisma } from './prisma';

export async function create(input: {
  creationId: string;
  guestName: string;
  attending: RsvpAnswer;
  guestCount: number;
  message?: string | null;
  contactPhone?: string | null;
}): Promise<RsvpResponse> {
  return prisma.rsvpResponse.create({
    data: {
      creationId: input.creationId,
      guestName: input.guestName,
      attending: input.attending,
      guestCount: input.guestCount,
      message: input.message ?? null,
      contactPhone: input.contactPhone ?? null,
    },
  });
}

export async function countForCreation(creationId: string): Promise<number> {
  return prisma.rsvpResponse.count({ where: { creationId } });
}

export async function listForCreation(
  creationId: string,
  offset: number,
  limit: number,
): Promise<{ items: RsvpResponse[]; total: number }> {
  const [items, total] = await prisma.$transaction([
    prisma.rsvpResponse.findMany({
      where: { creationId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.rsvpResponse.count({ where: { creationId } }),
  ]);
  return { items, total };
}

/** Headline numbers for the creator: who is coming, and how many people. */
export async function summarize(
  creationId: string,
): Promise<{ yes: number; no: number; maybe: number; guests: number }> {
  const grouped = await prisma.rsvpResponse.groupBy({
    by: ['attending'],
    where: { creationId },
    _count: { _all: true },
    _sum: { guestCount: true },
  });

  const summary = { yes: 0, no: 0, maybe: 0, guests: 0 };
  for (const row of grouped) {
    const count = row._count._all;
    if (row.attending === 'YES') {
      summary.yes = count;
      summary.guests += row._sum.guestCount ?? 0;
    } else if (row.attending === 'NO') {
      summary.no = count;
    } else {
      summary.maybe = count;
    }
  }
  return summary;
}
