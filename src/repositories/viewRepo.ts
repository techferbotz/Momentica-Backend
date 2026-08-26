import type { ViewDaily } from '@prisma/client';
import { prisma } from './prisma';

export async function dailySeries(creationId: string, since: Date): Promise<ViewDaily[]> {
  return prisma.viewDaily.findMany({
    where: { creationId, date: { gte: since } },
    orderBy: { date: 'asc' },
  });
}
