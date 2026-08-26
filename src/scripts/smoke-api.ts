/**
 * Walks the real user journey over HTTP against a running dev stack.
 *
 * Unlike the `check:*` fixtures this one needs Postgres. Steps that depend on
 * unconfigured feature groups (S3, RevenueCat) are reported as skipped rather
 * than failed, so the script stays useful on a machine with only a database.
 *
 *   npm run dev        # in one terminal
 *   npm run smoke      # in another
 */
import { env } from '../config/env';
import { pingDatabase, disconnectPrisma } from '../repositories/prisma';
import { check, expectEqual, expectTrue, report } from './checkUtil';

const BASE = `http://127.0.0.1:${env.port}/api/v1`;

interface Reply {
  status: number;
  body: any;
}

const skipped: string[] = [];

async function call(
  path: string,
  init: RequestInit & { draftToken?: string; accessToken?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.draftToken) headers['x-draft-token'] = init.draftToken;
  if (init.accessToken) headers.authorization = `Bearer ${init.accessToken}`;

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function envelopeOk(reply: Reply, what: string): any {
  expectTrue(reply.body?.success === true, `${what} — expected success, got ${JSON.stringify(reply.body)?.slice(0, 300)}`);
  return reply.body.data;
}

/**
 * Builds a valid draft payload from a template's sample data, dropping anything
 * that would need an uploaded photo. Returns null when the template genuinely
 * cannot be completed without storage.
 */
function buildDraftData(
  fields: any[],
  sampleValues: Record<string, unknown>,
): Record<string, unknown> | null {
  const data: Record<string, unknown> = {};

  for (const field of fields) {
    const sample = sampleValues[field.key];

    if (field.type === 'image') {
      if (field.required) return null;
      continue;
    }

    if (field.type === 'imageList') {
      if ((field.minItems ?? 0) > 0) return null;
      continue;
    }

    if (field.type === 'groupList') {
      if (!Array.isArray(sample)) {
        if (field.required) return null;
        continue;
      }
      const childImageKeys = (field.fields ?? [])
        .filter((child: any) => child.type === 'image' || child.type === 'imageList')
        .map((child: any) => child.key);
      if ((field.fields ?? []).some((c: any) => c.required && childImageKeys.includes(c.key))) {
        return null;
      }
      const items = sample.map((item: any) => {
        const copy: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item ?? {})) {
          if (childImageKeys.includes(key)) continue;
          if (value === null || value === undefined) continue;
          copy[key] = value;
        }
        return copy;
      });
      const min = field.minItems ?? 0;
      if (items.length < min) return null;
      data[field.key] = items.slice(0, field.maxItems ?? items.length);
      continue;
    }

    if (sample !== undefined && sample !== null) data[field.key] = sample;
    else if (field.required) return null;
  }

  return data;
}

async function main(): Promise<void> {
  if (!(await pingDatabase())) {
    console.error(
      'smoke-api: cannot reach the database.\n' +
        '  Start it with:  docker compose up -d\n' +
        `  DATABASE_URL currently points at: ${env.databaseUrl.replace(/:[^:@]*@/, ':***@')}`,
    );
    process.exit(1);
  }

  const health = await fetch(`http://127.0.0.1:${env.port}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`smoke-api: no server on port ${env.port}. Start it with: npm run dev`);
    process.exit(1);
  }

  // ---- Catalogue -----------------------------------------------------------
  let templateId = '';

  await check('the feed lists live categories with templates', async () => {
    const data = envelopeOk(await call('/feed'), 'feed');
    expectTrue(Array.isArray(data.sections) && data.sections.length > 0, 'feed has sections');
    const first = data.sections[0];
    expectTrue(first.templates.length > 0, 'first section has templates');
    templateId = first.templates[0].id;
    expectTrue(
      first.templates[0].previewCode === `pv_${templateId}`,
      'template card carries its preview code',
    );
  });

  await check('template detail carries the field contract and pricing', async () => {
    const data = envelopeOk(await call(`/templates/${templateId}`), 'template detail');
    expectTrue(Array.isArray(data.fields) && data.fields.length > 0, 'fields present');
    expectTrue(data.pricing.bundles.length > 0, 'pricing bundles present');
  });

  await check('an unknown template is not found', async () => {
    expectEqual((await call('/templates/no_such_template')).status, 404, 'status');
  });

  // ---- Preview render (no auth, no data) -----------------------------------
  await check('the preview code renders sample data', async () => {
    const data = envelopeOk(await call(`/public/render/pv_${templateId}`), 'preview render');
    expectEqual(data.meta.mode, 'preview', 'mode');
    expectTrue(data.values !== null, 'sample values present');
    expectTrue(data.og.title.length > 0, 'link preview title');
  });

  // ---- Anonymous draft -----------------------------------------------------
  let draftToken = '';
  let creationId = '';

  await check('a device can open a draft session', async () => {
    const data = envelopeOk(await call('/draft-sessions', { method: 'POST' }), 'draft session');
    expectTrue(typeof data.draftToken === 'string' && data.draftToken.length > 20, 'token issued');
    draftToken = data.draftToken;
  });

  await check('creating without a principal is rejected', async () => {
    const reply = await call('/creations', {
      method: 'POST',
      body: JSON.stringify({ templateId, data: {} }),
    });
    expectEqual(reply.status, 401, 'status');
  });

  await check('invalid placeholder data is rejected with a useful message', async () => {
    const reply = await call('/creations', {
      method: 'POST',
      draftToken,
      body: JSON.stringify({ templateId, data: {} }),
    });
    expectEqual(reply.status, 400, 'status');
    expectEqual(reply.body.code, 'VALIDATION_FAILED', 'code');
    expectTrue(reply.body.message.length > 0, 'message names the offending fields');
  });

  await check('an anonymous device can create a draft', async () => {
    // Not every template can be completed without storage configured — some
    // require photos. Try each live template and keep the first that goes
    // through, rather than assuming the feed's first card is usable.
    const feed = envelopeOk(await call('/feed'), 'feed');
    const candidates: string[] = feed.sections.flatMap((section: any) =>
      section.templates.map((t: any) => t.id),
    );

    const rejections: string[] = [];

    for (const candidate of candidates) {
      const detail = envelopeOk(await call(`/templates/${candidate}`), 'template detail');
      const sample = envelopeOk(await call(`/public/render/pv_${candidate}`), 'preview');
      const data = buildDraftData(detail.fields, sample.values);
      if (data === null) {
        rejections.push(`${candidate}: needs photo uploads`);
        continue;
      }

      const reply = await call('/creations', {
        method: 'POST',
        draftToken,
        body: JSON.stringify({ templateId: candidate, data }),
      });

      if (reply.status === 201) {
        templateId = candidate;
        creationId = envelopeOk(reply, 'create').id;
        return;
      }
      rejections.push(`${candidate}: ${reply.body?.message ?? reply.status}`);
    }

    throw new Error(`no template could be completed without uploads — ${rejections.join(' | ')}`);
  });

  if (!creationId) {
    console.error('smoke-api: could not create a draft without image uploads; aborting early.');
    report('smoke-api');
    return;
  }

  await check('another device cannot see that draft', async () => {
    const other = envelopeOk(await call('/draft-sessions', { method: 'POST' }), 'other session');
    const reply = await call(`/creations/${creationId}`, { draftToken: other.draftToken });
    // Absent, not forbidden: existence is not something to leak.
    expectEqual(reply.status, 404, 'status');
    expectEqual(reply.body.code, 'NOT_FOUND', 'code');
  });

  await check('server-owned fields cannot be written by the client', async () => {
    const reply = await call(`/creations/${creationId}`, {
      method: 'PUT',
      draftToken,
      body: JSON.stringify({ shareCode: 'HACKED01', status: 'PUBLISHED', viewCount: 9999 }),
    });
    expectEqual(reply.status, 200, 'status');
    const data = envelopeOk(reply, 'update');
    expectEqual(data.shareCode, null, 'share code unchanged');
    expectEqual(data.status, 'DRAFT', 'status unchanged');
    expectEqual(data.viewCount, 0, 'view count unchanged');
  });

  await check('the creator can preview their own unpaid draft', async () => {
    const token = envelopeOk(
      await call(`/creations/${creationId}/preview-token`, { method: 'POST', draftToken }),
      'preview token',
    );
    expectTrue(token.code.startsWith('d_'), 'draft code shape');

    const data = envelopeOk(await call(`/public/render/${token.code}`), 'draft render');
    expectEqual(data.meta.mode, 'draft', 'mode');
    expectTrue(data.values !== null, 'draft values present');
  });

  await check('pricing for the draft is available before payment', async () => {
    const data = envelopeOk(
      await call(`/creations/${creationId}/pricing`, { draftToken }),
      'pricing',
    );
    expectTrue(data.bundles.length > 0, 'bundles present');
  });

  // ---- Sign in and claim ---------------------------------------------------
  let accessToken = '';
  let refreshToken = '';

  await check('the dev login mints a session', async () => {
    if (!env.testLoginSecret) {
      skipped.push('sign-in (TEST_LOGIN_SECRET not set)');
      return;
    }
    const data = envelopeOk(
      await call('/auth/test-login', {
        method: 'POST',
        body: JSON.stringify({
          secret: env.testLoginSecret,
          email: `smoke-${Date.now()}@momentica.test`,
        }),
      }),
      'test login',
    );
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    expectTrue(accessToken.length > 0 && refreshToken.length > 0, 'tokens issued');
  });

  if (accessToken) {
    await check('signing in adopts the drafts made anonymously', async () => {
      const data = envelopeOk(
        await call('/auth/claim-drafts', {
          method: 'POST',
          accessToken,
          body: JSON.stringify({ draftToken }),
        }),
        'claim',
      );
      expectTrue(data.creations >= 1, 'at least one draft claimed');

      const mine = envelopeOk(await call('/creations', { accessToken }), 'list');
      expectTrue(
        mine.creations.some((c: { id: string }) => c.id === creationId),
        'the claimed draft is now on the account',
      );
    });

    await check('the device token no longer reaches the claimed draft', async () => {
      expectEqual((await call(`/creations/${creationId}`, { draftToken })).status, 404, 'status');
    });

    await check('refresh rotates, and replaying the old token kills the family', async () => {
      const rotated = envelopeOk(
        await call('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        }),
        'refresh',
      );
      expectTrue(rotated.refreshToken !== refreshToken, 'a new refresh token was issued');

      const replay = await call('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      expectEqual(replay.status, 401, 'replay is rejected');
      expectEqual(replay.body.code, 'REFRESH_REUSED', 'theft detected');

      const afterRevoke = await call('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: rotated.refreshToken }),
      });
      expectEqual(afterRevoke.status, 401, 'the whole family was revoked');
    });

    await check('stats are readable for an owned creation', async () => {
      const data = envelopeOk(
        await call(`/creations/${creationId}/stats`, { accessToken }),
        'stats',
      );
      expectEqual(data.totalViews, 0, 'no views yet');
      expectEqual(data.series.length, 30, 'a full 30-day series');
    });

    await check('publishing reports billing as unavailable when unconfigured', async () => {
      const reply = await call(`/creations/${creationId}/publish`, {
        method: 'POST',
        accessToken,
        body: JSON.stringify({ storeTransactionId: 'smoke-txn-1' }),
      });
      if (env.revenueCat) {
        // With billing configured the transaction is fake, so it must not verify.
        expectEqual(reply.status, 400, 'unverifiable purchase is refused');
        expectEqual(reply.body.code, 'PURCHASE_NOT_VERIFIED', 'code');
      } else {
        expectEqual(reply.status, 503, 'status');
        expectEqual(reply.body.code, 'BILLING_UNAVAILABLE', 'code');
        skipped.push('publish and renew (RevenueCat not configured)');
      }
    });
  }

  // ---- Public surface ------------------------------------------------------
  await check('an unknown share code is not found', async () => {
    const reply = await call('/public/render/aB3xK9pQ');
    expectEqual(reply.status, 404, 'status');
    expectEqual(reply.body.success, false, 'failure envelope');
  });

  await check('a malformed code is not found either', async () => {
    expectEqual((await call('/public/render/nope')).status, 404, 'status');
  });

  await check('the view ping never reveals whether a code exists', async () => {
    const real = await call('/public/render/aB3xK9pQ/view', { method: 'POST' });
    expectEqual(real.status, 200, 'status');
    expectEqual(real.body.data.recorded, true, 'same answer regardless');
  });

  if (!env.s3) skipped.push('image upload (S3 not configured)');

  await check('the draft can be deleted', async () => {
    const auth = accessToken ? { accessToken } : { draftToken };
    expectEqual(
      (await call(`/creations/${creationId}`, { method: 'DELETE', ...auth })).status,
      200,
      'status',
    );
    expectEqual((await call(`/creations/${creationId}`, { ...auth })).status, 404, 'gone after delete');
  });

  if (skipped.length > 0) {
    console.log(`\nskipped (not configured):\n${skipped.map((s) => `  - ${s}`).join('\n')}`);
  }
  report('smoke-api');
}

main()
  .catch((err: unknown) => {
    console.error('smoke-api crashed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
