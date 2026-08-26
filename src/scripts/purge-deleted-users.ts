/**
 * Hard-deletes accounts that were soft-deleted long enough ago.
 *
 * The delay is deliberate: signing back in within the window restores the
 * account, and support needs a way to undo an accidental deletion. Purchases
 * cascade with the user, so run this only once the retention window your
 * accounting needs has passed.
 */
import * as userRepo from '../repositories/userRepo';
import * as s3Storage from '../storage/s3Storage';
import { disconnectPrisma, prisma } from '../repositories/prisma';
import { logger } from '../utils/logger';

const RETENTION_DAYS = 30;

async function main(): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

  const users = await userRepo.findDeletedBefore(cutoff);
  if (users.length === 0) {
    logger.info('No deleted accounts are past the retention window');
    return;
  }

  let objectsRemoved = 0;

  for (const user of users) {
    const images = await prisma.image.findMany({
      where: { ownerUserId: user.id },
      select: { keyFull: true, keyThumb: true },
    });

    if (images.length > 0 && s3Storage.isConfigured()) {
      const keys = images.flatMap((image) => [image.keyFull, image.keyThumb]);
      await s3Storage.deleteKeys(keys);
      objectsRemoved += keys.length;
    }

    // Creations, images, purchases and tokens all cascade from the user row.
    await userRepo.hardDelete(user.id);
  }

  logger.info('Purged deleted accounts', {
    accounts: users.length,
    objectsRemoved,
    retentionDays: RETENTION_DAYS,
  });
}

main()
  .catch((err: unknown) => {
    logger.error('purge-deleted-users failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
