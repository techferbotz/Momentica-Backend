/**
 * Boots the real app and exercises every route that does not touch the
 * database: the catalogue, template previews, auth refusals, rate limiting,
 * CORS and cache headers.
 *
 * Complements `check-errors` (which proves the envelope) and `smoke-api` (which
 * needs Postgres). No database required.
 */
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { RATE_LIMITS } from '../config/constants';
import { env } from '../config/env';
import { resetRateLimits } from '../middleware/rateLimit';
import { CATEGORIES, TEMPLATES } from '../templates/registry';
import { check, expectEqual, expectTrue, report } from './checkUtil';

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: any;
}

async function main(): Promise<void> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const call = async (path: string, init?: RequestInit): Promise<Reply> => {
    const response = await fetch(`${base}${path}`, init);
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.json().catch(() => null),
    };
  };
  const api = (path: string, init?: RequestInit) => call(`/api/v1${path}`, init);

  const liveTemplate = TEMPLATES.find((t) => t.live);
  if (!liveTemplate) throw new Error('the registry has no live template to exercise');

  // ---- catalogue -----------------------------------------------------------
  await check('the feed returns live categories with templates', async () => {
    const reply = await api('/feed');
    expectEqual(reply.status, 200, 'status');
    const sections = reply.body.data.sections;
    expectTrue(Array.isArray(sections) && sections.length > 0, 'sections present');
    for (const section of sections) {
      expectTrue(section.templates.length > 0, `${section.category.id} has no templates`);
    }
  });

  await check('the feed is cacheable, since it is identical for everyone', async () => {
    const reply = await api('/feed');
    expectTrue(
      (reply.headers['cache-control'] ?? '').includes('max-age'),
      `expected a cache header, got "${reply.headers['cache-control']}"`,
    );
  });

  await check('categories are listed in display order', async () => {
    const reply = await api('/categories');
    const ids = reply.body.data.categories.map((c: { id: string }) => c.id);
    const expected = CATEGORIES.filter((c) => c.live)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((c) => c.id);
    expectEqual(ids, expected, 'category order');
  });

  await check('templates in a category paginate', async () => {
    const categoryId = liveTemplate.categoryId;
    const first = await api(`/categories/${categoryId}/templates?limit=1`);
    expectEqual(first.status, 200, 'status');
    expectEqual(first.body.data.templates.length, 1, 'one item returned');

    const liveInCategory = TEMPLATES.filter((t) => t.live && t.categoryId === categoryId).length;
    if (liveInCategory > 1) {
      expectTrue(first.body.data.nextCursor !== null, 'a next cursor is offered');
      const second = await api(
        `/categories/${categoryId}/templates?limit=1&cursor=${first.body.data.nextCursor}`,
      );
      expectEqual(second.status, 200, 'second page status');
      expectTrue(
        second.body.data.templates[0].id !== first.body.data.templates[0].id,
        'the second page is a different template',
      );
    }
  });

  await check('a forged cursor is rejected rather than silently ignored', async () => {
    const reply = await api(`/categories/${liveTemplate.categoryId}/templates?cursor=42`);
    expectEqual(reply.status, 400, 'status');
    expectEqual(reply.body.code, 'VALIDATION_FAILED', 'code');
  });

  await check('an unknown category is not found', async () => {
    expectEqual((await api('/categories/no_such/templates')).status, 404, 'status');
  });

  await check('template detail carries the form contract and pricing', async () => {
    const reply = await api(`/templates/${liveTemplate.id}`);
    expectEqual(reply.status, 200, 'status');
    const data = reply.body.data;
    expectEqual(data.fields.length, liveTemplate.fields.length, 'field count');
    expectEqual(data.previewCode, `pv_${liveTemplate.id}`, 'preview code');
    expectTrue(data.pricing.bundles.length > 0, 'bundles present');
    expectTrue(typeof data.pricing.displayPerDay === 'string', 'per-day copy present');
  });

  await check('an unknown template is not found', async () => {
    expectEqual((await api('/templates/no_such_template')).status, 404, 'status');
  });

  // ---- render --------------------------------------------------------------
  await check('a preview code renders the sample data', async () => {
    const reply = await api(`/public/render/pv_${liveTemplate.id}`);
    expectEqual(reply.status, 200, 'status');
    const data = reply.body.data;
    expectEqual(data.templateId, liveTemplate.id, 'template id');
    expectEqual(data.meta.mode, 'preview', 'mode');
    expectTrue(data.values !== null, 'values present');
    expectTrue(data.og.title.length > 0, 'link-preview title');
    expectTrue(data.og.imageUrl !== null, 'link-preview image');
  });

  await check('preview link copy is filled in from the sample data', async () => {
    const reply = await api(`/public/render/pv_${liveTemplate.id}`);
    expectTrue(
      !reply.body.data.og.title.includes('{'),
      `unresolved placeholder in "${reply.body.data.og.title}"`,
    );
  });

  await check('a preview for an unknown template is not found', async () => {
    expectEqual((await api('/public/render/pv_nope')).status, 404, 'status');
  });

  await check('a malformed render code is not found', async () => {
    expectEqual((await api('/public/render/short')).status, 404, 'status');
    expectEqual((await api('/public/render/d_not-a-real-token')).status, 404, 'status');
  });

  // ---- auth refusals (these return before touching the database) ------------
  await check('creation routes refuse an anonymous caller', async () => {
    for (const [method, path] of [
      ['GET', '/creations'],
      ['POST', '/creations'],
      ['GET', '/creations/abc'],
      ['PUT', '/creations/abc'],
      ['DELETE', '/creations/abc'],
      ['GET', '/creations/abc/stats'],
    ] as const) {
      const reply = await api(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
      });
      expectEqual(reply.status, 401, `${method} ${path}`);
      expectEqual(reply.body.code, 'AUTH_REQUIRED', `${method} ${path} code`);
    }
  });

  await check('publishing refuses a device token, not just an absent one', async () => {
    const reply = await api('/creations/abc/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-draft-token': 'some-device-token' },
      body: '{}',
    });
    // requireAuth runs before anything reads the database.
    expectEqual(reply.status, 401, 'status');
  });

  await check('a garbage bearer token is rejected', async () => {
    const reply = await api('/me', { headers: { authorization: 'Bearer not.a.jwt' } });
    expectEqual(reply.status, 401, 'status');
    expectEqual(reply.body.code, 'INVALID_TOKEN', 'code');
  });

  await check('the billing webhook rejects an unauthenticated caller', async () => {
    const reply = await api('/webhooks/revenuecat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: { type: 'CANCELLATION' } }),
    });
    // 401 when billing is configured, 503 when it is not — never 200.
    expectTrue([401, 503].includes(reply.status), `expected 401 or 503, got ${reply.status}`);
  });

  await check('the dev login is only mounted in development', async () => {
    const reply = await api('/auth/test-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong', email: 'x@y.z' }),
    });
    if (env.isDevelopment && env.testLoginSecret) {
      expectEqual(reply.status, 403, 'a wrong secret is refused');
    } else {
      expectEqual(reply.status, 404, 'the route does not exist outside development');
    }
  });

  // ---- cross-cutting -------------------------------------------------------
  await check('rate limiting kicks in and reports when to retry', async () => {
    resetRateLimits();
    const path = `/public/render/pv_${liveTemplate.id}`;
    let limited: Reply | null = null;

    for (let i = 0; i < RATE_LIMITS.render.limit + 2; i += 1) {
      const reply = await api(path);
      if (reply.status === 429) {
        limited = reply;
        break;
      }
    }

    expectTrue(limited !== null, 'expected a 429 once the window filled');
    expectEqual(limited?.body.code, 'RATE_LIMITED', 'code');
    expectTrue(Number(limited?.headers['retry-after']) > 0, 'Retry-After is set');
    resetRateLimits();
  });

  await check('CORS allows the web renderer and refuses everyone else', async () => {
    const allowed = await api('/feed', { headers: { origin: env.publicWebOrigin } });
    expectEqual(
      allowed.headers['access-control-allow-origin'],
      env.publicWebOrigin,
      'the renderer origin is allowed',
    );

    const denied = await api('/feed', { headers: { origin: 'https://evil.example.com' } });
    expectEqual(
      denied.headers['access-control-allow-origin'],
      undefined,
      'an unknown origin gets no allow header',
    );
  });

  await check('the server does not advertise its stack', async () => {
    const reply = await call('/health');
    expectEqual(reply.headers['x-powered-by'], undefined, 'x-powered-by is disabled');
  });

  server.close();
  report('check-routes');
}

void main();
