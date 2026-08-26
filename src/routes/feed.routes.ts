import { Router } from 'express';
import * as feedController from '../controllers/feedController';

/**
 * The public catalogue. No auth: the app browses it before anyone signs in, and
 * it is identical for every caller, so it is safe to cache at the edge.
 */
export const feedRouter = Router();

const cacheable = Router();
cacheable.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  next();
});

cacheable.get('/feed', feedController.getFeed);
cacheable.get('/categories', feedController.listCategories);
cacheable.get('/categories/:id/templates', feedController.listTemplates);
cacheable.get('/templates/:id', feedController.getTemplate);

feedRouter.use(cacheable);
