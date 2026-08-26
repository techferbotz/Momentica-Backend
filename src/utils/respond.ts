import type { Response } from 'express';

/** The one success shape: { success: true, data }. */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

export function noContent(res: Response): void {
  ok(res, null, 200);
}
