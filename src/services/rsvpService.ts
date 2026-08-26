import type { RsvpAnswer, RsvpResponse } from '@prisma/client';
import { PAGINATION, RSVP } from '../config/constants';
import { ConflictError, ErrorCode, ForbiddenError } from '../errors/AppError';
import type { Principal } from '../middleware/principal';
import * as rsvpRepo from '../repositories/rsvpRepo';
import * as creationService from './creationService';
import * as renderService from './renderService';
import { getLiveTemplate } from '../templates/registry';
import { encodeCursor } from '../utils/cursor';

export interface RsvpView {
  id: string;
  guestName: string;
  attending: RsvpAnswer;
  guestCount: number;
  message: string | null;
  contactPhone: string | null;
  createdAt: string;
}

function toView(rsvp: RsvpResponse): RsvpView {
  return {
    id: rsvp.id,
    guestName: rsvp.guestName,
    attending: rsvp.attending,
    guestCount: rsvp.guestCount,
    message: rsvp.message,
    contactPhone: rsvp.contactPhone,
    createdAt: rsvp.createdAt.toISOString(),
  };
}

export interface RsvpInput {
  guestName: string;
  attending: RsvpAnswer;
  guestCount: number;
  message?: string;
  contactPhone?: string;
}

/**
 * Submitted by anonymous guests against a share code. The route rate-limits per
 * IP and creation; this cap bounds the total, so one determined submitter can't
 * grow a wedding's guest list without limit.
 */
export async function submit(code: string, input: RsvpInput): Promise<{ received: true }> {
  const creation = await renderService.requireLiveCreation(code);
  const template = getLiveTemplate(creation.templateId);

  if (!template?.supportsRsvp) {
    throw new ForbiddenError('This experience does not collect RSVPs', ErrorCode.RSVP_CLOSED);
  }

  const values = creation.data as Record<string, unknown>;
  if (values.rsvpEnabled === false) {
    throw new ForbiddenError('RSVPs are closed for this event', ErrorCode.RSVP_CLOSED);
  }

  const existing = await rsvpRepo.countForCreation(creation.id);
  if (existing >= RSVP.maxPerCreation) {
    throw new ConflictError('This guest list is full', ErrorCode.RSVP_CLOSED);
  }

  await rsvpRepo.create({
    creationId: creation.id,
    guestName: input.guestName,
    attending: input.attending,
    guestCount: input.guestCount,
    message: input.message ?? null,
    contactPhone: input.contactPhone ?? null,
  });

  // Deliberately no echo of what was stored: the submitter is anonymous, and
  // returning the row would let anyone with the link read back other guests.
  return { received: true };
}

export async function listForOwner(
  principal: Principal,
  creationId: string,
  offset: number,
  limit: number,
): Promise<{
  rsvps: RsvpView[];
  nextCursor: string | null;
  summary: { yes: number; no: number; maybe: number; guests: number };
}> {
  const creation = await creationService.getOwned(principal, creationId);
  const bounded = Math.min(limit, PAGINATION.maxLimit);

  const [{ items, total }, summary] = await Promise.all([
    rsvpRepo.listForCreation(creation.id, offset, bounded),
    rsvpRepo.summarize(creation.id),
  ]);

  const seen = offset + items.length;
  return {
    rsvps: items.map(toView),
    nextCursor: seen < total ? encodeCursor(seen) : null,
    summary,
  };
}
