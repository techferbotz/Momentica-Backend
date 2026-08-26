import type { Creation, Prisma } from '@prisma/client';
import { CREATION_LIMITS, PAGINATION, RENDER } from '../config/constants';
import { getTier } from '../config/pricing';
import {
  BadRequestError,
  ConflictError,
  ErrorCode,
  ForbiddenError,
  NotFoundError,
} from '../errors/AppError';
import { signDraftPreviewToken } from '../auth/jwt';
import type { Principal } from '../middleware/principal';
import * as creationRepo from '../repositories/creationRepo';
import * as imageRepo from '../repositories/imageRepo';
import { getLiveTemplate } from '../templates/registry';
import type { TemplateDef } from '../templates/types';
import { collectImageIds, summarizeIssues, validateCreationData } from '../templates/validate';
import { encodeCursor } from '../utils/cursor';

/**
 * Drafts: create, edit, list, delete, and hand out a preview link.
 *
 * Publishing and renewal live in billingService — they need a verified purchase
 * and shouldn't be reachable from here.
 */

export interface CreationView {
  id: string;
  templateId: string;
  templateName: string;
  status: Creation['status'];
  data: unknown;
  coverImageId: string | null;
  shareCode: string | null;
  shareUrl: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export function isExpired(creation: Pick<Creation, 'expiresAt'>): boolean {
  return creation.expiresAt !== null && creation.expiresAt.getTime() <= Date.now();
}

export function shareUrlFor(shareCode: string | null, publicWebOrigin: string): string | null {
  return shareCode ? `${publicWebOrigin}/${shareCode}` : null;
}

export function toView(creation: Creation, publicWebOrigin: string): CreationView {
  const template = getLiveTemplate(creation.templateId);
  return {
    id: creation.id,
    templateId: creation.templateId,
    templateName: template?.name ?? creation.templateId,
    status: creation.status,
    data: creation.data,
    coverImageId: creation.coverImageId,
    shareCode: creation.shareCode,
    shareUrl: shareUrlFor(creation.shareCode, publicWebOrigin),
    publishedAt: creation.publishedAt?.toISOString() ?? null,
    expiresAt: creation.expiresAt?.toISOString() ?? null,
    isExpired: isExpired(creation),
    viewCount: creation.viewCount,
    createdAt: creation.createdAt.toISOString(),
    updatedAt: creation.updatedAt.toISOString(),
  };
}

function requireTemplate(templateId: string): TemplateDef {
  const template = getLiveTemplate(templateId);
  if (!template) {
    throw new BadRequestError('Unknown template', ErrorCode.INVALID_TEMPLATE);
  }
  return template;
}

/**
 * Shape and bounds come from the pure validator; whether the referenced images
 * exist and belong to this principal is a database question, so it is answered
 * here rather than inside the validator.
 */
async function validateAndResolve(
  principal: Principal,
  template: TemplateDef,
  rawData: unknown,
): Promise<{ data: Record<string, unknown>; imageIds: string[] }> {
  const result = validateCreationData(template, rawData, 'input');
  if (!result.ok) {
    throw new BadRequestError(summarizeIssues(result.issues), ErrorCode.VALIDATION_FAILED);
  }

  const imageIds = collectImageIds(template, result.value);
  if (imageIds.length > 0) {
    const owned = await imageRepo.findOwnedByIds(principal, imageIds);
    if (owned.length !== imageIds.length) {
      const ownedIds = new Set(owned.map((image) => image.id));
      const missing = imageIds.filter((id) => !ownedIds.has(id));
      throw new BadRequestError(
        `Unknown image reference: ${missing.join(', ')}`,
        ErrorCode.VALIDATION_FAILED,
      );
    }
  }

  return { data: result.value, imageIds };
}

export async function create(
  principal: Principal,
  input: { templateId: string; data: unknown; coverImageId?: string },
): Promise<Creation> {
  const template = requireTemplate(input.templateId);

  const draftCount = await creationRepo.countDrafts(principal);
  if (draftCount >= CREATION_LIMITS.maxDraftsPerPrincipal) {
    throw new ConflictError(
      `You already have ${CREATION_LIMITS.maxDraftsPerPrincipal} drafts. Publish or delete one first.`,
      ErrorCode.DRAFT_LIMIT_REACHED,
    );
  }

  const { data, imageIds } = await validateAndResolve(principal, template, input.data);
  await assertCoverImage(principal, input.coverImageId, imageIds);

  const creation = await creationRepo.create(principal, {
    templateId: template.id,
    data: data as Prisma.InputJsonValue,
    coverImageId: input.coverImageId ?? imageIds[0] ?? null,
  });

  await imageRepo.attachToCreation(imageIds, creation.id);
  return creation;
}

async function assertCoverImage(
  principal: Principal,
  coverImageId: string | undefined,
  referencedIds: string[],
): Promise<void> {
  if (!coverImageId) return;
  if (referencedIds.includes(coverImageId)) return;
  const image = await imageRepo.findOwned(principal, coverImageId);
  if (!image) {
    throw new BadRequestError('Unknown cover image', ErrorCode.VALIDATION_FAILED);
  }
}

export async function getOwned(principal: Principal, id: string): Promise<Creation> {
  const creation = await creationRepo.findOwned(principal, id);
  if (!creation) {
    throw new NotFoundError('Creation not found', ErrorCode.NOT_FOUND);
  }
  return creation;
}

export async function list(
  principal: Principal,
  offset: number,
  limit: number,
): Promise<{ items: Creation[]; nextCursor: string | null }> {
  const bounded = Math.min(limit, PAGINATION.maxLimit);
  const { items, total } = await creationRepo.listOwned(principal, offset, bounded);
  const seen = offset + items.length;
  return { items, nextCursor: seen < total ? encodeCursor(seen) : null };
}

/**
 * Only content fields are writable. Publication state, share code, expiry and
 * view count are server-owned: a client that could set them could grant itself
 * free hosting or un-publish a link it had already sent out.
 */
export async function update(
  principal: Principal,
  id: string,
  input: { templateId?: string; data?: unknown; coverImageId?: string | null },
): Promise<Creation> {
  const existing = await getOwned(principal, id);

  const template = requireTemplate(input.templateId ?? existing.templateId);
  const rawData = input.data ?? existing.data;
  const { data, imageIds } = await validateAndResolve(principal, template, rawData);

  if (input.coverImageId) {
    await assertCoverImage(principal, input.coverImageId, imageIds);
  }

  const updated = await creationRepo.update(id, {
    templateId: template.id,
    data: data as Prisma.InputJsonValue,
    ...(input.coverImageId !== undefined ? { coverImageId: input.coverImageId } : {}),
  });

  await imageRepo.attachToCreation(imageIds, id);
  return updated;
}

export async function remove(principal: Principal, id: string): Promise<void> {
  await getOwned(principal, id);
  await creationRepo.softDelete(id);
}

/**
 * The pre-payment preview: a signed, short-lived code the renderer accepts in
 * place of a share code. Only the owner can mint one.
 */
export async function issuePreviewToken(
  principal: Principal,
  id: string,
): Promise<{ code: string; expiresAt: string }> {
  const creation = await getOwned(principal, id);
  const template = requireTemplate(creation.templateId);

  const result = validateCreationData(template, creation.data, 'input');
  if (!result.ok) {
    throw new BadRequestError(
      `This draft is not ready to preview: ${summarizeIssues(result.issues)}`,
      ErrorCode.VALIDATION_FAILED,
    );
  }

  const { token, expiresAt } = signDraftPreviewToken(creation.id);
  return { code: `${RENDER.draftCodePrefix}${token}`, expiresAt: expiresAt.toISOString() };
}

/** What the paywall sheet needs: the bundles for this creation's template tier. */
export async function getPricing(
  principal: Principal,
  id: string,
): Promise<{ tierKey: string; label: string; displayPerDay: string; bundles: unknown[] }> {
  const creation = await getOwned(principal, id);
  const template = requireTemplate(creation.templateId);
  const tier = getTier(template.tierKey);
  return {
    tierKey: tier.key,
    label: tier.label,
    displayPerDay: tier.displayPerDay,
    bundles: tier.bundles,
  };
}

/**
 * Publishing requires an account: the purchase has to belong to someone, and a
 * device that loses its draft token would otherwise lose a link it paid for.
 */
export function assertUserPrincipal(principal: Principal): string {
  if (principal.kind !== 'user') {
    throw new ForbiddenError('Sign in to continue', ErrorCode.AUTH_REQUIRED);
  }
  return principal.userId;
}
