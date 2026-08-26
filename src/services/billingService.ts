import type { Creation, Prisma, Purchase } from '@prisma/client';
import { env } from '../config/env';
import { SHARE_CODE } from '../config/constants';
import { resolveProduct } from '../config/pricing';
import {
  BadRequestError,
  ConflictError,
  ErrorCode,
  ServiceUnavailableError,
} from '../errors/AppError';
import type { Principal } from '../middleware/principal';
import * as creationRepo from '../repositories/creationRepo';
import * as purchaseRepo from '../repositories/purchaseRepo';
import { isUniqueViolation } from '../repositories/prisma';
import * as revenueCat from '../billing/revenueCat';
import { getLiveTemplate } from '../templates/registry';
import { summarizeIssues, validateCreationData } from '../templates/validate';
import { generateShareCode } from '../utils/shareCode';
import { logger } from '../utils/logger';
import * as creationService from './creationService';

/**
 * Turning a verified purchase into a live link.
 *
 * Two properties matter more than anything else here:
 *   - A transaction can be spent exactly once. The unique constraint on
 *     `rcTransactionId` is the enforcement; the code around it just makes the
 *     outcomes friendly.
 *   - Retrying is safe. A user who pays and then loses the network must be able
 *     to call publish again and get the same link rather than pay twice.
 */

export interface PublishResult {
  creation: Creation;
  shareCode: string;
  shareUrl: string;
  expiresAt: string;
  alreadyPublished: boolean;
}

function assertConfigured(): void {
  if (!revenueCat.isConfigured()) {
    throw new ServiceUnavailableError('Billing is not configured', ErrorCode.BILLING_UNAVAILABLE);
  }
}

/**
 * The RevenueCat app user id. Setting it to our own user id at sign-in is what
 * lets purchases be scoped to an account server-side; a mismatch here would let
 * one account spend another's transaction.
 */
function appUserIdFor(userId: string): string {
  return userId;
}

async function assignShareCode(creationId: string, expiresAt: Date): Promise<Creation> {
  for (let attempt = 0; attempt < SHARE_CODE.maxGenerationAttempts; attempt += 1) {
    const shareCode = generateShareCode();
    try {
      return await creationRepo.publish(creationId, { shareCode, expiresAt });
    } catch (err) {
      if (isUniqueViolation(err, 'shareCode')) continue;
      throw err;
    }
  }
  // 62^8 possibilities: reaching here means something is wrong with the random
  // source, not that we were unlucky.
  logger.error('Exhausted share code attempts', { creationId });
  throw new ServiceUnavailableError('Could not create a link right now', ErrorCode.INTERNAL);
}

function ensureReadyToPublish(creation: Creation): void {
  const template = getLiveTemplate(creation.templateId);
  if (!template) {
    throw new BadRequestError('This template is no longer available', ErrorCode.INVALID_TEMPLATE);
  }
  const result = validateCreationData(template, creation.data, 'input');
  if (!result.ok) {
    throw new BadRequestError(
      `This creation is not ready to publish: ${summarizeIssues(result.issues)}`,
      ErrorCode.VALIDATION_FAILED,
    );
  }
}

/**
 * Confirms the transaction against RevenueCat and returns what it bought.
 * Scoped to the buyer, so somebody else's transaction id verifies as absent.
 */
async function verifyAndPrice(
  userId: string,
  storeTransactionId: string,
): Promise<{ purchase: revenueCat.VerifiedPurchase; tierKey: string; days: number }> {
  const purchase = await revenueCat.findCustomerPurchase(
    appUserIdFor(userId),
    storeTransactionId,
  );
  if (!purchase) {
    throw new BadRequestError(
      'We could not find that purchase. If you were charged, try again in a moment.',
      ErrorCode.PURCHASE_NOT_VERIFIED,
    );
  }

  const product = resolveProduct(purchase.productId);
  if (!product) {
    // Never fall back to a default duration: an unrecognised product means our
    // grid and the store console have drifted, and guessing gives away hosting.
    logger.error('Verified purchase has an unknown product', {
      productId: purchase.productId,
      storeTransactionId,
    });
    throw new BadRequestError('That product is not available', ErrorCode.UNKNOWN_PRODUCT);
  }

  return { purchase, tierKey: product.tierKey, days: product.days };
}

function addDays(from: Date, days: number): Date {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export async function publish(
  principal: Principal,
  creationId: string,
  storeTransactionId: string,
): Promise<PublishResult> {
  assertConfigured();
  const userId = creationService.assertUserPrincipal(principal);
  const creation = await creationService.getOwned(principal, creationId);

  // Retry after a dropped response: the transaction was already spent on this
  // creation, so hand back the same link instead of asking for another payment.
  const existing = await purchaseRepo.findByTransactionId(storeTransactionId);
  if (existing) {
    if (existing.creationId !== creation.id || existing.userId !== userId) {
      throw new ConflictError(
        'That purchase has already been used',
        ErrorCode.PURCHASE_ALREADY_USED,
      );
    }
    const current = await creationRepo.findById(creation.id);
    if (current?.shareCode && current.expiresAt) {
      return toResult(current, true);
    }
  }

  if (creation.status === 'PUBLISHED' && creation.shareCode) {
    throw new ConflictError('This creation is already published', ErrorCode.ALREADY_PUBLISHED);
  }

  ensureReadyToPublish(creation);
  const { purchase, tierKey, days } = await verifyAndPrice(userId, storeTransactionId);

  await recordPurchase({
    userId,
    creationId: creation.id,
    purchase,
    tierKey,
    days,
  });

  const published = await assignShareCode(creation.id, addDays(new Date(), days));
  return toResult(published, false);
}

/**
 * Extends an existing link rather than minting a new one, so anything already
 * shared keeps working. Renewing early adds to the remaining time instead of
 * discarding it.
 */
export async function renew(
  principal: Principal,
  creationId: string,
  storeTransactionId: string,
): Promise<PublishResult> {
  assertConfigured();
  const userId = creationService.assertUserPrincipal(principal);
  const creation = await creationService.getOwned(principal, creationId);

  if (creation.status !== 'PUBLISHED' || !creation.shareCode) {
    throw new ConflictError('Publish this creation before renewing it', ErrorCode.NOT_PUBLISHED);
  }

  const existing = await purchaseRepo.findByTransactionId(storeTransactionId);
  if (existing) {
    if (existing.creationId !== creation.id || existing.userId !== userId) {
      throw new ConflictError(
        'That purchase has already been used',
        ErrorCode.PURCHASE_ALREADY_USED,
      );
    }
    const current = await creationRepo.findById(creation.id);
    if (current) return toResult(current, true);
  }

  const { purchase, tierKey, days } = await verifyAndPrice(userId, storeTransactionId);

  await recordPurchase({ userId, creationId: creation.id, purchase, tierKey, days });

  const from =
    creation.expiresAt && creation.expiresAt.getTime() > Date.now() ? creation.expiresAt : new Date();
  const renewed = await creationRepo.extendExpiry(creation.id, addDays(from, days));
  return toResult(renewed, false);
}

async function recordPurchase(input: {
  userId: string;
  creationId: string;
  purchase: revenueCat.VerifiedPurchase;
  tierKey: string;
  days: number;
}): Promise<void> {
  try {
    await purchaseRepo.create({
      userId: input.userId,
      creationId: input.creationId,
      rcTransactionId: input.purchase.storeTransactionId,
      rcAppUserId: appUserIdFor(input.userId),
      productId: input.purchase.productId,
      tierKey: input.tierKey,
      days: input.days,
      priceMinorUnits: input.purchase.priceMinorUnits,
      currency: input.purchase.currency,
      purchasedAt: input.purchase.purchasedAt,
      raw: input.purchase.raw as Prisma.InputJsonValue,
    });
  } catch (err) {
    if (isUniqueViolation(err, 'rcTransactionId')) {
      // Two publishes raced with the same transaction. The unique constraint is
      // the arbiter; the loser reports it as already spent.
      throw new ConflictError(
        'That purchase has already been used',
        ErrorCode.PURCHASE_ALREADY_USED,
      );
    }
    throw err;
  }
}

function toResult(creation: Creation, alreadyPublished: boolean): PublishResult {
  if (!creation.shareCode || !creation.expiresAt) {
    throw new ServiceUnavailableError('Could not create a link right now', ErrorCode.INTERNAL);
  }
  return {
    creation,
    shareCode: creation.shareCode,
    shareUrl: `${env.publicWebOrigin}/${creation.shareCode}`,
    expiresAt: creation.expiresAt.toISOString(),
    alreadyPublished,
  };
}

export async function listPurchases(userId: string, limit: number): Promise<Purchase[]> {
  return purchaseRepo.listForUser(userId, limit);
}

/**
 * Refunds and chargebacks arrive here. The link is expired immediately rather
 * than deleted: the creator keeps the draft and can republish, and anyone
 * holding the link sees the normal ended page.
 */
export async function handleWebhook(body: unknown): Promise<{ handled: boolean }> {
  const event = revenueCat.parseWebhookEvent(body);
  if (!event) return { handled: false };

  if (event.kind !== 'revoked' || !event.storeTransactionId) {
    return { handled: false };
  }

  const purchase = await purchaseRepo.findByTransactionId(event.storeTransactionId);
  if (!purchase) return { handled: false };

  await purchaseRepo.setState(purchase.id, 'REFUNDED');

  const creation = await creationRepo.findById(purchase.creationId);
  if (creation && (creation.expiresAt === null || creation.expiresAt.getTime() > Date.now())) {
    await creationRepo.extendExpiry(creation.id, new Date());
    logger.info('Revoked a link after a billing event', {
      type: event.type,
      creationId: creation.id,
    });
  }

  return { handled: true };
}

export async function getEntitlements(
  principal: Principal,
  creationId: string,
): Promise<{ published: boolean; expiresAt: string | null; daysRemaining: number | null }> {
  const creation = await creationService.getOwned(principal, creationId);
  if (!creation.expiresAt) {
    return { published: creation.status === 'PUBLISHED', expiresAt: null, daysRemaining: null };
  }
  const remaining = creation.expiresAt.getTime() - Date.now();
  return {
    published: creation.status === 'PUBLISHED',
    expiresAt: creation.expiresAt.toISOString(),
    daysRemaining: remaining > 0 ? Math.ceil(remaining / (24 * 60 * 60 * 1000)) : 0,
  };
}
