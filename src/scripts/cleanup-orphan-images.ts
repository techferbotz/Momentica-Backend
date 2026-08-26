/**
 * Removes photos that were uploaded but never attached to a creation.
 *
 * The upload endpoint deliberately accepts a photo before the creation exists,
 * so an abandoned form leaves objects behind. The grace period keeps a
 * half-finished session from having its photos pulled out from under it.
 */
import * as imageRepo from '../repositories/imageRepo';
import * as s3Storage from '../storage/s3Storage';
import { disconnectPrisma } from '../repositories/prisma';
import { logger } from '../utils/logger';

const GRACE_HOURS = 48;
const BATCH = 500;

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_HOURS * 60 * 60 * 1000);
  const orphans = await imageRepo.findOrphans(cutoff, BATCH);

  if (orphans.length === 0) {
    logger.info('No orphaned images to clean up');
    return;
  }

  if (s3Storage.isConfigured()) {
    await s3Storage.deleteKeys(orphans.flatMap((image) => [image.keyFull, image.keyThumb]));
  } else {
    logger.warn('Storage is not configured — deleting rows but leaving any objects in place');
  }

  const removed = await imageRepo.hardDelete(orphans.map((image) => image.id));
  logger.info('Cleaned up orphaned images', { removed, graceHours: GRACE_HOURS });
}

main()
  .catch((err: unknown) => {
    logger.error('cleanup-orphan-images failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
