/**
 * Deletes anonymous draft sessions nobody ever claimed, along with the drafts
 * and photos attached to them.
 *
 * Anonymous creation is what makes the flow work, and this is its cost: people
 * browse, start something, and never come back. Run daily.
 */
import { CREATION_LIMITS } from '../config/constants';
import * as draftSessionRepo from '../repositories/draftSessionRepo';
import * as s3Storage from '../storage/s3Storage';
import { disconnectPrisma, prisma } from '../repositories/prisma';
import { logger } from '../utils/logger';

const BATCH = 200;

async function main(): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - CREATION_LIMITS.abandonedDraftDays);

  const sessions = await draftSessionRepo.findAbandoned(cutoff, BATCH);
  if (sessions.length === 0) {
    logger.info('No abandoned draft sessions to purge');
    return;
  }

  let objectsRemoved = 0;

  for (const session of sessions) {
    // Collect the S3 keys before the rows cascade away with the session.
    const images = await prisma.image.findMany({
      where: { draftSessionId: session.id },
      select: { keyFull: true, keyThumb: true },
    });

    if (images.length > 0 && s3Storage.isConfigured()) {
      const keys = images.flatMap((image) => [image.keyFull, image.keyThumb]);
      await s3Storage.deleteKeys(keys);
      objectsRemoved += keys.length;
    }

    await draftSessionRepo.deleteById(session.id);
  }

  logger.info('Purged abandoned draft sessions', {
    sessions: sessions.length,
    objectsRemoved,
    olderThanDays: CREATION_LIMITS.abandonedDraftDays,
  });
}

main()
  .catch((err: unknown) => {
    logger.error('purge-abandoned-drafts failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
