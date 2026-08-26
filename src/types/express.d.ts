import type { Principal } from '../middleware/principal';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. */
      userId?: string;
      /** Set by `requirePrincipal` — the signed-in user or the anonymous device. */
      principal?: Principal;
    }
  }
}

export {};
