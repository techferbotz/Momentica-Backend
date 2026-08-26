import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { ErrorCode, ServiceUnavailableError } from '../errors/AppError';
import { logger } from '../utils/logger';

/**
 * The only module that imports the AWS SDK.
 *
 * When the S3 environment group is absent the rest of the API still boots and
 * works; only the endpoints that genuinely need object storage answer 503. That
 * keeps a misconfigured deploy debuggable instead of dead.
 */

const config = env.s3;

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!config) {
    throw new ServiceUnavailableError(
      'Image storage is not configured',
      ErrorCode.STORAGE_UNAVAILABLE,
    );
  }
  client ??= new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return client;
}

export function isConfigured(): boolean {
  return config !== null;
}

export function assertConfigured(): void {
  if (!config) {
    throw new ServiceUnavailableError(
      'Image storage is not configured',
      ErrorCode.STORAGE_UNAVAILABLE,
    );
  }
}

/**
 * Objects are keyed by image id alone — deliberately no user or creation
 * segment, so two published links can't be tied back to the same author by
 * comparing their image URLs.
 */
export function keyFor(imageId: string, variant: 'full' | 'thumb'): string {
  return `img/${imageId}/${variant}.webp`;
}

export function publicUrl(key: string): string {
  if (!config) {
    throw new ServiceUnavailableError(
      'Image storage is not configured',
      ErrorCode.STORAGE_UNAVAILABLE,
    );
  }
  return `${config.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
}

export async function putImage(key: string, body: Buffer): Promise<void> {
  assertConfigured();
  await getClient().send(
    new PutObjectCommand({
      Bucket: config?.bucket,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      // Recipients are anonymous, so objects must be fetchable without
      // credentials. The unguessable key is what keeps them private.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

export async function deleteKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  assertConfigured();

  // The API caps a single delete request at 1000 objects.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const result = await getClient().send(
      new DeleteObjectsCommand({
        Bucket: config?.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (result.Errors?.length) {
      logger.warn('Some objects failed to delete', {
        count: result.Errors.length,
        first: result.Errors[0]?.Key,
      });
    }
  }
}
