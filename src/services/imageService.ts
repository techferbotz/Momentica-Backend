import type { Image } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CREATION_LIMITS } from '../config/constants';
import { BadRequestError, ConflictError, ErrorCode, NotFoundError } from '../errors/AppError';
import type { Principal } from '../middleware/principal';
import * as imageRepo from '../repositories/imageRepo';
import * as imageCompressor from '../media/imageCompressor';
import * as s3Storage from '../storage/s3Storage';

export interface ImageView {
  id: string;
  full: string;
  thumb: string;
  width: number;
  height: number;
}

export function toView(image: Image): ImageView {
  return {
    id: image.id,
    full: s3Storage.publicUrl(image.keyFull),
    thumb: s3Storage.publicUrl(image.keyThumb),
    width: image.width,
    height: image.height,
  };
}

/**
 * Upload is reachable before sign-in, which makes it the app's main cost risk:
 * an anonymous device can burn storage without ever creating an account. The
 * per-principal count cap is the backstop behind the route's rate limit.
 */
export async function upload(
  principal: Principal,
  file: { buffer: Buffer; size: number },
): Promise<ImageView> {
  s3Storage.assertConfigured();

  const existing = await imageRepo.countOwned(principal);
  if (existing >= CREATION_LIMITS.maxImagesPerPrincipal) {
    throw new ConflictError(
      'You have reached the photo limit. Delete some photos to add more.',
      ErrorCode.IMAGE_LIMIT_REACHED,
    );
  }

  if (file.size === 0) {
    throw new BadRequestError('The uploaded file is empty', ErrorCode.VALIDATION_FAILED);
  }

  const processed = await imageCompressor.process(file.buffer);

  // The id is minted here so both variants share it and the S3 keys are known
  // before the row exists — an upload that fails halfway leaves objects with no
  // row, which the orphan cleanup sweeps up.
  const imageId = randomUUID();
  const keyFull = s3Storage.keyFor(imageId, 'full');
  const keyThumb = s3Storage.keyFor(imageId, 'thumb');

  await Promise.all([
    s3Storage.putImage(keyFull, processed.full.buffer),
    s3Storage.putImage(keyThumb, processed.thumb.buffer),
  ]);

  const image = await imageRepo.create(principal, {
    keyFull,
    keyThumb,
    width: processed.full.width,
    height: processed.full.height,
    bytes: processed.full.buffer.byteLength + processed.thumb.buffer.byteLength,
  });

  return toView(image);
}

export async function remove(principal: Principal, id: string): Promise<void> {
  const image = await imageRepo.findOwned(principal, id);
  if (!image) {
    throw new NotFoundError('Photo not found', ErrorCode.NOT_FOUND);
  }
  // Tombstoned only. The objects are removed by the cleanup script, which can
  // confirm no other row still points at those keys.
  await imageRepo.softDelete(id);
}

/**
 * Turns the image ids stored in a creation's data into URLs the renderer can
 * use. Missing ids are simply absent from the map so a deleted photo degrades
 * to a gap rather than a broken page.
 */
export async function resolveMany(ids: string[]): Promise<Map<string, ImageView>> {
  if (ids.length === 0 || !s3Storage.isConfigured()) return new Map();
  const images = await imageRepo.findByIds(ids);
  return new Map(images.map((image) => [image.id, toView(image)]));
}
