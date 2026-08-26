import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { UPLOAD } from '../config/constants';
import { BadRequestError, ErrorCode } from '../errors/AppError';

/** The only module that imports sharp. */

export interface ProcessedVariant {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ProcessedImage {
  full: ProcessedVariant;
  thumb: ProcessedVariant;
}

async function toWebp(
  input: Buffer,
  maxDimension: number,
  quality: number,
): Promise<ProcessedVariant> {
  const { data, info } = await sharp(input)
    // Phones record orientation in EXIF rather than rotating pixels; without
    // this, portrait photos render sideways.
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height };
}

/**
 * Two WebP variants: one for the page, one for grids and link previews.
 *
 * sharp drops metadata unless asked to keep it, which is exactly what we want —
 * holiday photos routinely carry GPS coordinates, and these files end up on a
 * public URL.
 */
export async function process(input: Buffer): Promise<ProcessedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw new BadRequestError('That file is not a readable image', ErrorCode.VALIDATION_FAILED);
  }

  if (!metadata.width || !metadata.height) {
    throw new BadRequestError('That file is not a readable image', ErrorCode.VALIDATION_FAILED);
  }

  const [full, thumb] = await Promise.all([
    toWebp(input, UPLOAD.full.maxDimension, UPLOAD.full.quality),
    toWebp(input, UPLOAD.thumb.maxDimension, UPLOAD.thumb.quality),
  ]);

  return { full, thumb };
}
