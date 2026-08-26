import { env } from '../config/env';
import { ErrorCode, ServiceUnavailableError } from '../errors/AppError';
import { logger } from '../utils/logger';
import { safeCompare } from '../utils/crypto';

/**
 * The only module that knows RevenueCat exists.
 *
 * The app buys through the RevenueCat KMP SDK and hands us the store
 * transaction id. We never take its word for it: the purchase is confirmed
 * against RevenueCat's REST API, scoped to that customer, before anything is
 * granted.
 *
 * Endpoint paths are from the documented v2 API
 * (https://api.revenuecat.com/v2). The per-item field names are read strictly
 * and a payload we don't recognise raises rather than degrades — a verification
 * step that silently returns "fine" when it can't read the response would hand
 * out free hosting. Confirm the shape against a real sandbox purchase before
 * launch; a mismatch shows up as a logged raw payload, not as a bad grant.
 */

const BASE_URL = 'https://api.revenuecat.com/v2';
const REQUEST_TIMEOUT_MS = 10_000;

const config = env.revenueCat;

export function isConfigured(): boolean {
  return config !== null;
}

function requireConfig(): NonNullable<typeof config> {
  if (!config) {
    throw new ServiceUnavailableError('Billing is not configured', ErrorCode.BILLING_UNAVAILABLE);
  }
  return config;
}

export interface VerifiedPurchase {
  /** RevenueCat's own purchase id. */
  purchaseId: string;
  /** The store's transaction identifier — our idempotency key. */
  storeTransactionId: string;
  productId: string;
  store: string;
  purchasedAt: Date;
  priceMinorUnits: bigint | null;
  currency: string | null;
  raw: unknown;
}

interface RevenueCatPage {
  items?: unknown[];
  next_page?: string | null;
}

async function get(path: string): Promise<unknown> {
  const { apiKey } = requireConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('RevenueCat request failed', {
        path,
        status: response.status,
        body: body.slice(0, 500),
      });
      throw new ServiceUnavailableError(
        'Could not confirm the purchase right now',
        ErrorCode.BILLING_UNAVAILABLE,
      );
    }

    return await response.json();
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    logger.warn('RevenueCat request errored', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ServiceUnavailableError(
      'Could not confirm the purchase right now',
      ErrorCode.BILLING_UNAVAILABLE,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readTimestamp(source: Record<string, unknown>): Date | null {
  // RevenueCat reports epoch milliseconds; the field has carried both names.
  for (const key of ['purchased_at_ms', 'purchased_at']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return new Date(parsed);
      const asDate = new Date(value);
      if (!Number.isNaN(asDate.getTime())) return asDate;
    }
  }
  return null;
}

function normalize(item: Record<string, unknown>): VerifiedPurchase | null {
  const storeTransactionId = readString(item, 'store_purchase_identifier');
  const productId = readString(item, 'product_id');
  const purchaseId = readString(item, 'id');
  const purchasedAt = readTimestamp(item);

  if (!storeTransactionId || !productId || !purchaseId || !purchasedAt) return null;

  const amount = item.revenue_in_usd ?? item.price;
  const priceMinorUnits =
    typeof amount === 'number' && Number.isFinite(amount)
      ? BigInt(Math.round(amount * 100))
      : null;

  return {
    purchaseId,
    storeTransactionId,
    productId,
    store: readString(item, 'store') ?? 'unknown',
    purchasedAt,
    priceMinorUnits,
    currency: readString(item, 'currency'),
    raw: item,
  };
}

/**
 * Confirms that this specific store transaction exists on this specific
 * RevenueCat customer.
 *
 * Scoping the lookup to the customer is the security property that matters: it
 * is what stops one account from publishing with somebody else's transaction
 * id.
 */
export async function findCustomerPurchase(
  appUserId: string,
  storeTransactionId: string,
): Promise<VerifiedPurchase | null> {
  const { projectId } = requireConfig();
  const customer = encodeURIComponent(appUserId);

  let path = `/projects/${encodeURIComponent(projectId)}/customers/${customer}/purchases`;
  let unreadable = 0;

  // Bounded so a paging bug can't spin forever.
  for (let page = 0; page < 20; page += 1) {
    const body = (await get(path)) as RevenueCatPage;
    const items = Array.isArray(body.items) ? body.items : [];

    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null) continue;
      const purchase = normalize(raw as Record<string, unknown>);
      if (!purchase) {
        unreadable += 1;
        continue;
      }
      if (purchase.storeTransactionId === storeTransactionId) return purchase;
    }

    if (!body.next_page) {
      if (unreadable > 0 && items.length > 0) {
        // We saw purchases but couldn't read any of them. That is a shape
        // mismatch on our side, not a missing purchase — say so loudly instead
        // of reporting "no such purchase" and confusing a paying customer.
        logger.error('RevenueCat purchases could not be parsed', {
          unreadable,
          sample: JSON.stringify(items[0]).slice(0, 800),
        });
        throw new ServiceUnavailableError(
          'Could not confirm the purchase right now',
          ErrorCode.BILLING_UNAVAILABLE,
        );
      }
      return null;
    }

    path = body.next_page.startsWith('/') ? body.next_page : `/${body.next_page}`;
  }

  logger.warn('RevenueCat purchase paging exhausted', { appUserId });
  return null;
}

/** Webhook events we act on. Anything else is acknowledged and ignored. */
export type WebhookKind = 'purchase' | 'revoked' | 'other';

export interface WebhookEvent {
  kind: WebhookKind;
  type: string;
  appUserId: string | null;
  storeTransactionId: string | null;
  productId: string | null;
}

const REVOKING_TYPES = new Set([
  'CANCELLATION',
  'REFUND',
  'SUBSCRIPTION_PAUSED',
  'EXPIRATION',
  'TRANSFER',
]);
const GRANTING_TYPES = new Set(['NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE', 'UNCANCELLATION']);

/**
 * RevenueCat authenticates its webhooks with a fixed value you configure on the
 * Authorization header; there is no signature to verify.
 */
export function isAuthorizedWebhook(headerValue: string | undefined): boolean {
  const { webhookSecret } = requireConfig();
  if (!headerValue) return false;
  return safeCompare(headerValue, webhookSecret);
}

export function parseWebhookEvent(body: unknown): WebhookEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const event = (body as { event?: unknown }).event;
  if (typeof event !== 'object' || event === null) return null;

  const record = event as Record<string, unknown>;
  const type = readString(record, 'type');
  if (!type) return null;

  return {
    kind: GRANTING_TYPES.has(type) ? 'purchase' : REVOKING_TYPES.has(type) ? 'revoked' : 'other',
    type,
    appUserId: readString(record, 'app_user_id'),
    storeTransactionId:
      readString(record, 'transaction_id') ?? readString(record, 'store_transaction_id'),
    productId: readString(record, 'product_id'),
  };
}
