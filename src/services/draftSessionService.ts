import * as draftSessionRepo from '../repositories/draftSessionRepo';
import { generateOpaqueToken, hashToken } from '../utils/crypto';

/**
 * Anonymous ownership for the pre-login part of the flow.
 *
 * A device gets an opaque token on first use and holds it locally. Everything it
 * creates before signing in belongs to that session; at sign-in the session's
 * contents are moved onto the account.
 */

export interface IssuedDraftSession {
  draftToken: string;
  draftSessionId: string;
}

export async function issue(): Promise<IssuedDraftSession> {
  const draftToken = generateOpaqueToken();
  const session = await draftSessionRepo.create(hashToken(draftToken));
  return { draftToken, draftSessionId: session.id };
}

/** Returns null rather than throwing so callers decide whether absence is fatal. */
export async function resolve(draftToken: string): Promise<string | null> {
  const session = await draftSessionRepo.findByHash(hashToken(draftToken));
  return session ? session.id : null;
}

export async function touch(draftSessionId: string): Promise<void> {
  await draftSessionRepo.touch(draftSessionId);
}

/**
 * Idempotent: claiming an already-claimed session simply moves whatever is left,
 * so a retried sign-in can't lose a draft.
 */
export async function claim(
  draftToken: string,
  userId: string,
): Promise<{ creations: number; images: number }> {
  const draftSessionId = await resolve(draftToken);
  if (!draftSessionId) return { creations: 0, images: 0 };
  return draftSessionRepo.claimFor(draftSessionId, userId);
}
