import { BadRequestError, ErrorCode } from '../errors/AppError';

/**
 * Opaque offset cursors.
 *
 * Encoded rather than raw so the shape stays ours to change — a client that
 * learns to construct `?cursor=40` will break the day this becomes keyset
 * pagination over a database.
 */

export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw !== 'string') {
    throw new BadRequestError('Invalid cursor', ErrorCode.VALIDATION_FAILED);
  }

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const match = /^o:(\d+)$/.exec(decoded);
  if (!match) {
    throw new BadRequestError('Invalid cursor', ErrorCode.VALIDATION_FAILED);
  }
  return Number(match[1]);
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function paginate<T>(all: T[], offset: number, limit: number): Page<T> {
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items, nextCursor: next < all.length ? encodeCursor(next) : null };
}
