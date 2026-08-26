import type { Request, Response } from 'express';
import * as billingService from '../services/billingService';
import * as creationService from '../services/creationService';
import { env } from '../config/env';
import { principalOf } from '../middleware/principal';
import { ErrorCode, UnauthorizedError } from '../errors/AppError';
import * as revenueCat from '../billing/revenueCat';
import { asObject, requireString } from '../utils/parse';
import { ok } from '../utils/respond';
import { logger } from '../utils/logger';

function present(result: billingService.PublishResult) {
  return {
    creation: creationService.toView(result.creation, env.publicWebOrigin),
    shareCode: result.shareCode,
    shareUrl: result.shareUrl,
    expiresAt: result.expiresAt,
    alreadyPublished: result.alreadyPublished,
  };
}

export async function publish(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const transactionId = requireString(body, 'storeTransactionId', { maxLength: 255 });
  const result = await billingService.publish(
    principalOf(req),
    String(req.params.id),
    transactionId,
  );
  ok(res, present(result));
}

export async function renew(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const transactionId = requireString(body, 'storeTransactionId', { maxLength: 255 });
  const result = await billingService.renew(principalOf(req), String(req.params.id), transactionId);
  ok(res, present(result));
}

export async function entitlements(req: Request, res: Response): Promise<void> {
  ok(res, await billingService.getEntitlements(principalOf(req), String(req.params.id)));
}

export async function listPurchases(req: Request, res: Response): Promise<void> {
  if (!req.userId) {
    throw new UnauthorizedError('Authentication required', ErrorCode.AUTH_REQUIRED);
  }
  const purchases = await billingService.listPurchases(req.userId, 50);
  ok(res, {
    purchases: purchases.map((purchase) => ({
      id: purchase.id,
      creationId: purchase.creationId,
      productId: purchase.productId,
      days: purchase.days,
      state: purchase.state,
      // BigInt is not JSON-serializable, and money is rendered by the client.
      priceMinorUnits: purchase.priceMinorUnits?.toString() ?? null,
      currency: purchase.currency,
      purchasedAt: purchase.purchasedAt.toISOString(),
    })),
  });
}

/**
 * RevenueCat retries anything that is not a 2xx, so this acknowledges every
 * structurally valid delivery — including events we deliberately ignore — and
 * only rejects when the caller cannot prove it is RevenueCat.
 */
export async function webhook(req: Request, res: Response): Promise<void> {
  if (!revenueCat.isAuthorizedWebhook(req.header('authorization'))) {
    logger.warn('Rejected an unauthorized billing webhook', { ip: req.ip });
    throw new UnauthorizedError('Unauthorized', ErrorCode.AUTH_REQUIRED);
  }

  const result = await billingService.handleWebhook(req.body);
  ok(res, { received: true, handled: result.handled });
}
