import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * The single PrismaClient for the process, and the only module in the codebase
 * that imports @prisma/client. Everything else goes through a repository.
 */
export const prisma = new PrismaClient({
  log: env.isDevelopment ? ['warn', 'error'] : ['error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error('Database ping failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Prisma's unique-constraint violation. Services translate it deliberately. */
export function isUniqueViolation(err: unknown, target?: string): boolean {
  const code = (err as { code?: string })?.code;
  if (code !== 'P2002') return false;
  if (!target) return true;
  const meta = (err as { meta?: { target?: string[] | string } })?.meta?.target;
  const fields = Array.isArray(meta) ? meta : meta ? [meta] : [];
  return fields.some((field) => field.includes(target));
}
