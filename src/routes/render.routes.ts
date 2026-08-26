import { Router } from 'express';
import * as renderController from '../controllers/renderController';
import { byCodeAndIp, rateLimit } from '../middleware/rateLimit';
import { RATE_LIMITS } from '../config/constants';

/**
 * The public surface. Everything here is reachable by anyone holding a link, so
 * every route is rate-limited and none of them reveal whether a code exists
 * beyond what the response already has to say.
 */
export const renderRouter = Router();

renderRouter.get(
  '/public/render/:code',
  rateLimit(RATE_LIMITS.render, { name: 'render' }),
  renderController.render,
);

renderRouter.post(
  '/public/render/:code/view',
  rateLimit(RATE_LIMITS.view, { name: 'view' }),
  renderController.recordView,
);

renderRouter.post(
  '/public/render/:code/rsvp',
  rateLimit(RATE_LIMITS.rsvp, { name: 'rsvp', key: byCodeAndIp }),
  renderController.submitRsvp,
);
