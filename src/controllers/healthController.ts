import type { Request, Response } from 'express';
import { ok } from '../utils/respond';
import { pingDatabase } from '../repositories/prisma';
import { ErrorCode, ServiceUnavailableError } from '../errors/AppError';

export function getHealth(_req: Request, res: Response): void {
  ok(res, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}

export async function getDatabaseHealth(_req: Request, res: Response): Promise<void> {
  if (!(await pingDatabase())) {
    throw new ServiceUnavailableError('Database unreachable', ErrorCode.INTERNAL);
  }
  ok(res, { status: 'ok', database: 'reachable' });
}
