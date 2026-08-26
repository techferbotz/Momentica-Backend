import type { Request, Response } from 'express';
import * as imageService from '../services/imageService';
import { principalOf } from '../middleware/principal';
import { BadRequestError, ErrorCode } from '../errors/AppError';
import { UPLOAD } from '../config/constants';
import { created, ok } from '../utils/respond';

export async function uploadImage(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    throw new BadRequestError(
      `Attach an image as a "${UPLOAD.fieldName}" field`,
      ErrorCode.VALIDATION_FAILED,
    );
  }
  created(res, await imageService.upload(principalOf(req), file));
}

export async function deleteImage(req: Request, res: Response): Promise<void> {
  await imageService.remove(principalOf(req), String(req.params.id));
  ok(res, { deleted: true });
}
