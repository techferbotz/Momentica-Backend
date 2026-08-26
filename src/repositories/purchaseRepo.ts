import type { Prisma, Purchase, PurchaseState } from '@prisma/client';
import { prisma } from './prisma';

export async function findByTransactionId(rcTransactionId: string): Promise<Purchase | null> {
  return prisma.purchase.findUnique({ where: { rcTransactionId } });
}

export async function create(input: {
  userId: string;
  creationId: string;
  rcTransactionId: string;
  rcAppUserId: string;
  productId: string;
  tierKey: string;
  days: number;
  priceMinorUnits: bigint | null;
  currency: string | null;
  purchasedAt: Date;
  raw: Prisma.InputJsonValue;
}): Promise<Purchase> {
  return prisma.purchase.create({ data: input });
}

export async function listForUser(userId: string, limit: number): Promise<Purchase[]> {
  return prisma.purchase.findMany({
    where: { userId },
    orderBy: { purchasedAt: 'desc' },
    take: limit,
  });
}

export async function setState(id: string, state: PurchaseState): Promise<Purchase> {
  return prisma.purchase.update({ where: { id }, data: { state } });
}
