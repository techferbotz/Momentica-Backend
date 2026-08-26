import type { Request, Response } from 'express';
import * as feedService from '../services/feedService';
import { PAGINATION } from '../config/constants';
import { decodeCursor } from '../utils/cursor';
import { parseLimit } from '../utils/parse';
import { ok } from '../utils/respond';

export function getFeed(_req: Request, res: Response): void {
  ok(res, { sections: feedService.getFeed() });
}

export function listCategories(_req: Request, res: Response): void {
  ok(res, { categories: feedService.listCategories() });
}

export function listTemplates(req: Request, res: Response): void {
  const limit = parseLimit(req.query.limit, PAGINATION.defaultLimit, PAGINATION.maxLimit);
  const offset = decodeCursor(req.query.cursor);
  const page = feedService.listTemplatesInCategory(String(req.params.id), offset, limit);
  ok(res, { templates: page.items, nextCursor: page.nextCursor });
}

export function getTemplate(req: Request, res: Response): void {
  ok(res, feedService.getTemplateDetail(String(req.params.id)));
}
