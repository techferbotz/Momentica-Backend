import type { TierKey } from '../templates/types';

/**
 * How a published link is paid for.
 *
 * Play and the App Store only sell products whose price is fixed ahead of time
 * in their consoles, so "N days at a per-day rate" is expressed as a small grid
 * of duration bundles per price tier. RevenueCat surfaces the actual prices to
 * the app through Offerings; this backend never asserts a price — it only maps a
 * verified product id back to the number of days it bought.
 *
 * `displayPerDay` is copy for the feed ("from Rs.100/day"), not a computation
 * input.
 */

export const DURATIONS = [1, 3, 7, 30, 90] as const;
export type Duration = (typeof DURATIONS)[number];

export interface Bundle {
  days: Duration;
  /** Store product identifier, e.g. `publish_tierB_30d`. */
  productId: string;
}

export interface TierDef {
  key: TierKey;
  label: string;
  displayPerDay: string;
  bundles: Bundle[];
}

function productIdFor(tier: TierKey, days: Duration): string {
  return `publish_tier${tier}_${days}d`;
}

function bundlesFor(tier: TierKey): Bundle[] {
  return DURATIONS.map((days) => ({ days, productId: productIdFor(tier, days) }));
}

export const TIERS: Record<TierKey, TierDef> = {
  A: { key: 'A', label: 'Simple', displayPerDay: 'from Rs.50/day', bundles: bundlesFor('A') },
  B: { key: 'B', label: 'Signature', displayPerDay: 'from Rs.100/day', bundles: bundlesFor('B') },
  C: { key: 'C', label: 'Premium', displayPerDay: 'from Rs.200/day', bundles: bundlesFor('C') },
};

export function getTier(key: TierKey): TierDef {
  return TIERS[key];
}

const productIndex = new Map<string, { tierKey: TierKey; days: Duration }>();
for (const tier of Object.values(TIERS)) {
  for (const bundle of tier.bundles) {
    productIndex.set(bundle.productId, { tierKey: tier.key, days: bundle.days });
  }
}

/**
 * Maps a store product id back to what it bought. Returns undefined for a
 * product we don't sell, which the billing service treats as a hard failure
 * rather than a default duration.
 */
export function resolveProduct(
  productId: string,
): { tierKey: TierKey; days: Duration } | undefined {
  return productIndex.get(productId);
}

export function allProductIds(): string[] {
  return [...productIndex.keys()];
}
