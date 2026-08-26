import { Router } from 'express';
import * as billingController from '../controllers/billingController';
import { requireAuth, requirePrincipal } from '../middleware/principal';
import { byPrincipal, rateLimit } from '../middleware/rateLimit';
import { RATE_LIMITS } from '../config/constants';

export const billingRouter = Router();

const publishLimit = rateLimit(RATE_LIMITS.publish, { name: 'publish', key: byPrincipal });

/**
 * Publishing needs an account rather than just a device: the purchase has to
 * belong to someone, and a device that lost its draft token would otherwise
 * lose a link it had paid for.
 */
billingRouter.post(
  '/creations/:id/publish',
  requireAuth,
  publishLimit,
  billingController.publish,
);
billingRouter.post('/creations/:id/renew', requireAuth, publishLimit, billingController.renew);
billingRouter.get('/creations/:id/entitlements', requirePrincipal, billingController.entitlements);

billingRouter.get('/me/purchases', requireAuth, billingController.listPurchases);
