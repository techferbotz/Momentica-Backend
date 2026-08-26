import type { Request, Response } from 'express';
import { env } from '../config/env';
import { PAGINATION } from '../config/constants';
import * as creationService from '../services/creationService';
import { principalOf } from '../middleware/principal';
import { asObject, optionalString, parseLimit, requireString } from '../utils/parse';
import { decodeCursor } from '../utils/cursor';
import { created, ok } from '../utils/respond';

const view = (creation: Parameters<typeof creationService.toView>[0]) =>
  creationService.toView(creation, env.publicWebOrigin);

export async function createCreation(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const templateId = requireString(body, 'templateId', { maxLength: 100 });
  const coverImageId = optionalString(body, 'coverImageId');

  const creation = await creationService.create(principalOf(req), {
    templateId,
    data: body.data,
    ...(coverImageId ? { coverImageId } : {}),
  });
  created(res, view(creation));
}

export async function listCreations(req: Request, res: Response): Promise<void> {
  const limit = parseLimit(req.query.limit, PAGINATION.defaultLimit, PAGINATION.maxLimit);
  const offset = decodeCursor(req.query.cursor);
  const page = await creationService.list(principalOf(req), offset, limit);
  ok(res, { creations: page.items.map(view), nextCursor: page.nextCursor });
}

export async function getCreation(req: Request, res: Response): Promise<void> {
  const creation = await creationService.getOwned(principalOf(req), String(req.params.id));
  ok(res, view(creation));
}

export async function updateCreation(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const templateId = optionalString(body, 'templateId', { maxLength: 100 });

  const creation = await creationService.update(principalOf(req), String(req.params.id), {
    ...(templateId ? { templateId } : {}),
    ...(body.data !== undefined ? { data: body.data } : {}),
    ...(body.coverImageId !== undefined ? { coverImageId: body.coverImageId as string | null } : {}),
  });
  ok(res, view(creation));
}

export async function deleteCreation(req: Request, res: Response): Promise<void> {
  await creationService.remove(principalOf(req), String(req.params.id));
  ok(res, { deleted: true });
}

export async function createPreviewToken(req: Request, res: Response): Promise<void> {
  ok(res, await creationService.issuePreviewToken(principalOf(req), String(req.params.id)));
}

export async function getPricing(req: Request, res: Response): Promise<void> {
  ok(res, await creationService.getPricing(principalOf(req), String(req.params.id)));
}
