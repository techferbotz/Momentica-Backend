import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authRouter } from './auth.routes';
import { feedRouter } from './feed.routes';
import { creationsRouter } from './creations.routes';
import { imagesRouter } from './images.routes';
import { renderRouter } from './render.routes';
import { billingRouter } from './billing.routes';
import { webhooksRouter } from './webhooks.routes';

/** Everything domain-facing is versioned; ops endpoints sit at the root. */
export const apiRouter = Router();
apiRouter.use(authRouter);
apiRouter.use(feedRouter);
apiRouter.use(creationsRouter);
apiRouter.use(imagesRouter);
apiRouter.use(billingRouter);
apiRouter.use(renderRouter);
apiRouter.use(webhooksRouter);

export const rootRouter = Router();
rootRouter.use(healthRouter);
rootRouter.use('/api/v1', apiRouter);
