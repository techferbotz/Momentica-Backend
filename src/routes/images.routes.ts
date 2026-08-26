import { Router } from 'express';
import * as imageController from '../controllers/imageController';
import { requirePrincipal } from '../middleware/principal';
import { byPrincipal, rateLimit } from '../middleware/rateLimit';
import { uploadSingleImage } from '../middleware/upload';
import { RATE_LIMITS } from '../config/constants';

export const imagesRouter = Router();

imagesRouter.use('/images', requirePrincipal);

imagesRouter.post(
  '/images',
  rateLimit(RATE_LIMITS.upload, { name: 'upload', key: byPrincipal }),
  uploadSingleImage,
  imageController.uploadImage,
);
imagesRouter.delete('/images/:id', imageController.deleteImage);
