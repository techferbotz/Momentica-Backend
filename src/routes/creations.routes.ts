import { Router } from 'express';
import * as creationController from '../controllers/creationController';
import * as renderController from '../controllers/renderController';
import { requirePrincipal } from '../middleware/principal';

/**
 * Drafts are owned by an anonymous device before sign-in and by the account
 * afterwards, so these take a principal rather than requiring auth.
 *
 * The middleware is attached per route rather than to the `/creations` prefix:
 * publishing and renewal live on the same prefix but need a stricter check, and
 * a prefix-level guard would silently run twice for them.
 */
export const creationsRouter = Router();

creationsRouter.post('/creations', requirePrincipal, creationController.createCreation);
creationsRouter.get('/creations', requirePrincipal, creationController.listCreations);
creationsRouter.get('/creations/:id', requirePrincipal, creationController.getCreation);
creationsRouter.put('/creations/:id', requirePrincipal, creationController.updateCreation);
creationsRouter.delete('/creations/:id', requirePrincipal, creationController.deleteCreation);

creationsRouter.post(
  '/creations/:id/preview-token',
  requirePrincipal,
  creationController.createPreviewToken,
);
creationsRouter.get('/creations/:id/pricing', requirePrincipal, creationController.getPricing);

// Owner-facing readouts.
creationsRouter.get('/creations/:id/rsvps', requirePrincipal, renderController.listRsvps);
creationsRouter.get('/creations/:id/stats', requirePrincipal, renderController.getStats);
