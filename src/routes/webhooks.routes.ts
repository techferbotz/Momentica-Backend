import { Router } from 'express';
import * as billingController from '../controllers/billingController';

/**
 * Deliberately outside every auth middleware: RevenueCat cannot present a user
 * token. The controller authenticates the caller against the configured webhook
 * secret instead.
 */
export const webhooksRouter = Router();

webhooksRouter.post('/webhooks/revenuecat', billingController.webhook);
