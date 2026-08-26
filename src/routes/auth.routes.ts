import { Router } from 'express';
import * as authController from '../controllers/authController';
import { requireAuth } from '../middleware/principal';
import { rateLimit } from '../middleware/rateLimit';
import { RATE_LIMITS } from '../config/constants';
import { env } from '../config/env';

export const authRouter = Router();

const authLimit = rateLimit(RATE_LIMITS.auth, { name: 'auth' });
const draftSessionLimit = rateLimit(RATE_LIMITS.draftSession, { name: 'draft-session' });

authRouter.post('/auth/google', authLimit, authController.googleSignIn);
authRouter.post('/auth/refresh', authLimit, authController.refresh);
authRouter.post('/auth/logout', authController.logout);
authRouter.post('/auth/claim-drafts', requireAuth, authController.claimDrafts);

authRouter.get('/me', requireAuth, authController.me);
authRouter.delete('/me', requireAuth, authController.deleteMe);

/** Anonymous device identity, issued before the user has an account. */
authRouter.post('/draft-sessions', draftSessionLimit, authController.createDraftSession);

/**
 * Registered only in development and only with a secret configured. `env.ts`
 * additionally refuses to boot a production process that has the secret set, so
 * a copied .env can't quietly re-enable this.
 */
if (env.isDevelopment && env.testLoginSecret) {
  authRouter.post('/auth/test-login', authLimit, authController.testLogin);
}
