import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { UPLOAD } from '../config/constants';
import { BadRequestError, ErrorCode, PayloadTooLargeError } from '../errors/AppError';

/**
 * The only module that imports multer.
 *
 * Files are held in memory: they go straight to sharp and then to S3, so
 * writing them to disk would only add cleanup we would eventually get wrong.
 * The size cap is what keeps that safe.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD.maxBytes, files: 1, fields: 4 },
  fileFilter(_req, file, callback) {
    const allowed: readonly string[] = UPLOAD.allowedMimeTypes;
    if (!allowed.includes(file.mimetype)) {
      callback(new BadRequestError('Only image files can be uploaded', ErrorCode.VALIDATION_FAILED));
      return;
    }
    callback(null, true);
  },
});

const single = upload.single(UPLOAD.fieldName);

/**
 * Wraps multer so its own error type never reaches the central handler, which
 * would otherwise report an oversized photo as a generic 500.
 */
export const uploadSingleImage: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  single(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const megabytes = Math.round(UPLOAD.maxBytes / (1024 * 1024));
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          next(
            new PayloadTooLargeError(
              `Images must be under ${megabytes} MB`,
              ErrorCode.VALIDATION_FAILED,
            ),
          );
          return;
        case 'LIMIT_UNEXPECTED_FILE':
          next(
            new BadRequestError(
              `Send the image as a single "${UPLOAD.fieldName}" field`,
              ErrorCode.VALIDATION_FAILED,
            ),
          );
          return;
        default:
          next(new BadRequestError('Upload rejected', ErrorCode.VALIDATION_FAILED));
          return;
      }
    }
    next(err);
  });
};
