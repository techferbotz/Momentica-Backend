import { Router } from 'express';
import { getDatabaseHealth, getHealth } from '../controllers/healthController';

export const healthRouter = Router();

healthRouter.get('/health', getHealth);
healthRouter.get('/health/db', getDatabaseHealth);
