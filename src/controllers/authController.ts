import type { Request, Response } from 'express';
import * as authService from '../services/authService';
import * as draftSessionService from '../services/draftSessionService';
import { asObject, requireString } from '../utils/parse';
import { created, ok } from '../utils/respond';
import { ErrorCode, UnauthorizedError } from '../errors/AppError';

function requireUserId(req: Request): string {
  if (!req.userId) throw new UnauthorizedError('Authentication required', ErrorCode.AUTH_REQUIRED);
  return req.userId;
}

export async function googleSignIn(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const idToken = requireString(body, 'idToken', { maxLength: 4096 });
  const draftToken = body.draftToken === undefined ? undefined : requireString(body, 'draftToken');
  ok(res, await authService.loginWithGoogle(idToken, draftToken));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  ok(res, await authService.refresh(requireString(body, 'refreshToken')));
}

export async function logout(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  await authService.logout(requireString(body, 'refreshToken'));
  ok(res, { loggedOut: true });
}

export async function claimDrafts(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const draftToken = requireString(body, 'draftToken');
  ok(res, await authService.claimDrafts(draftToken, requireUserId(req)));
}

export async function me(req: Request, res: Response): Promise<void> {
  ok(res, await authService.getProfile(requireUserId(req)));
}

export async function deleteMe(req: Request, res: Response): Promise<void> {
  await authService.deleteAccount(requireUserId(req));
  ok(res, { deleted: true });
}

export async function createDraftSession(_req: Request, res: Response): Promise<void> {
  created(res, await draftSessionService.issue());
}

export async function testLogin(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const secret = requireString(body, 'secret');
  const email = requireString(body, 'email', { maxLength: 200 });
  ok(res, await authService.testLogin(secret, email));
}
