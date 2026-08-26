/**
 * The product grid is the bridge between a store purchase and how long a link
 * stays live. A product id that maps to the wrong duration, or to nothing,
 * either short-changes a paying customer or hands out free hosting — so the
 * mapping is checked in both directions.
 */
import { DURATIONS, TIERS, allProductIds, getTier, resolveProduct } from '../config/pricing';
import { TEMPLATES } from '../templates/registry';
import { check, expectEqual, expectTrue, report } from './checkUtil';

async function main(): Promise<void> {
  await check('every tier offers every duration', () => {
    for (const tier of Object.values(TIERS)) {
      expectEqual(
        tier.bundles.map((b) => b.days),
        [...DURATIONS],
        `tier ${tier.key} durations`,
      );
    }
  });

  await check('product ids are unique across the whole grid', () => {
    const ids = allProductIds();
    expectEqual(new Set(ids).size, ids.length, 'unique product ids');
    expectEqual(ids.length, Object.keys(TIERS).length * DURATIONS.length, 'grid size');
  });

  await check('every product resolves back to its own tier and duration', () => {
    for (const tier of Object.values(TIERS)) {
      for (const bundle of tier.bundles) {
        const resolved = resolveProduct(bundle.productId);
        expectTrue(Boolean(resolved), `${bundle.productId} did not resolve`);
        expectEqual(resolved?.tierKey, tier.key, `${bundle.productId} tier`);
        expectEqual(resolved?.days, bundle.days, `${bundle.productId} days`);
      }
    }
  });

  await check('an unknown product resolves to nothing, never a default', () => {
    expectEqual(resolveProduct('publish_tierZ_30d'), undefined, 'unknown tier');
    expectEqual(resolveProduct('publish_tierA_45d'), undefined, 'unknown duration');
    expectEqual(resolveProduct(''), undefined, 'empty product id');
    expectEqual(resolveProduct('premium_monthly'), undefined, 'a product from another model');
  });

  await check('durations are ascending and positive', () => {
    let previous = 0;
    for (const days of DURATIONS) {
      expectTrue(days > previous, `durations must ascend, ${days} followed ${previous}`);
      previous = days;
    }
  });

  await check('every template tier is a real tier with display copy', () => {
    for (const template of TEMPLATES) {
      const tier = getTier(template.tierKey);
      expectTrue(Boolean(tier), `${template.id}: unknown tier ${template.tierKey}`);
      expectTrue(tier.displayPerDay.length > 0, `tier ${tier.key} has no display copy`);
      expectTrue(tier.label.length > 0, `tier ${tier.key} has no label`);
    }
  });

  report('check-pricing');
}

void main();
