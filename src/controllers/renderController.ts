import type { Request, Response } from 'express';
import * as renderService from '../services/renderService';
import * as rsvpService from '../services/rsvpService';
import * as statsService from '../services/statsService';
import { principalOf } from '../middleware/principal';
import { PAGINATION, RSVP } from '../config/constants';
import { asObject, optionalInt, optionalString, parseLimit, requireOneOf, requireString } from '../utils/parse';
import { decodeCursor } from '../utils/cursor';
import { ok } from '../utils/respond';

export async function render(req: Request, res: Response): Promise<void> {
  const payload = await renderService.render(String(req.params.code));

  // A published page can change (the creator fixes a typo) and can expire, so
  // it must never be cached. Template previews are identical for everyone.
  res.setHeader(
    'Cache-Control',
    payload.meta.mode === 'preview' ? 'public, max-age=300' : 'no-store',
  );
  ok(res, payload);
}

export async function recordView(req: Request, res: Response): Promise<void> {
  await renderService.recordView(String(req.params.code));
  // Always the same answer: whether a code exists is not something an
  // unauthenticated caller gets to learn from a view ping.
  ok(res, { recorded: true });
}

export async function submitRsvp(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const message = optionalString(body, 'message', { maxLength: RSVP.maxMessageLength });
  const contactPhone = optionalString(body, 'contactPhone', { maxLength: 30 });

  ok(
    res,
    await rsvpService.submit(String(req.params.code), {
      guestName: requireString(body, 'guestName', { maxLength: 80 }),
      attending: requireOneOf(body, 'attending', ['YES', 'NO', 'MAYBE'] as const),
      guestCount: optionalInt(body, 'guestCount', { min: 1, max: RSVP.maxGuestCount }) ?? 1,
      ...(message ? { message } : {}),
      ...(contactPhone ? { contactPhone } : {}),
    }),
  );
}

export async function listRsvps(req: Request, res: Response): Promise<void> {
  const limit = parseLimit(req.query.limit, PAGINATION.defaultLimit, PAGINATION.maxLimit);
  const offset = decodeCursor(req.query.cursor);
  ok(res, await rsvpService.listForOwner(principalOf(req), String(req.params.id), offset, limit));
}

export async function getStats(req: Request, res: Response): Promise<void> {
  ok(res, await statsService.getStats(principalOf(req), String(req.params.id)));
}
