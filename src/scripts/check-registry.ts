/**
 * Guards the template catalogue against the mistakes that would reach users as
 * a broken feed: sample data that doesn't satisfy its own field contract, a
 * template pointing at a category that doesn't exist, a price tier with no
 * products, duplicate keys.
 *
 * Pure — no database, no network.
 */
import { CATEGORIES, TEMPLATES } from '../templates/registry';
import { getTier, TIERS } from '../config/pricing';
import { summarizeIssues, validateCreationData } from '../templates/validate';
import type { FieldDef } from '../templates/types';
import { check, expectEqual, expectTrue, report } from './checkUtil';

const SCALAR_ONLY: FieldDef['type'][] = [
  'text',
  'longText',
  'number',
  'date',
  'dateTime',
  'image',
  'imageList',
  'choice',
  'boolean',
  'color',
  'location',
];

async function main(): Promise<void> {
  await check('category ids are unique', () => {
    const ids = CATEGORIES.map((c) => c.id);
    expectEqual(new Set(ids).size, ids.length, 'unique category ids');
  });

  await check('template ids are unique', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expectEqual(new Set(ids).size, ids.length, 'unique template ids');
  });

  await check('template ids are URL-safe', () => {
    for (const template of TEMPLATES) {
      expectTrue(
        /^[a-z0-9_]+$/.test(template.id),
        `${template.id} must be lowercase letters, digits and underscores — it is a web route`,
      );
    }
  });

  for (const template of TEMPLATES) {
    await check(`${template.id}: category exists`, () => {
      expectTrue(
        CATEGORIES.some((c) => c.id === template.categoryId),
        `unknown categoryId "${template.categoryId}"`,
      );
    });

    await check(`${template.id}: tier exists and has bundles`, () => {
      const tier = getTier(template.tierKey);
      expectTrue(Boolean(tier), `unknown tierKey "${template.tierKey}"`);
      expectTrue(tier.bundles.length > 0, 'tier has no purchasable bundles');
    });

    await check(`${template.id}: field keys are unique`, () => {
      const keys = template.fields.map((f) => f.key);
      expectEqual(new Set(keys).size, keys.length, 'unique field keys');
    });

    await check(`${template.id}: field definitions are coherent`, () => {
      for (const field of template.fields) {
        if (field.type === 'choice') {
          expectTrue(
            (field.options?.length ?? 0) > 0,
            `${field.key}: a choice field needs options`,
          );
        }
        if (field.type === 'groupList') {
          expectTrue((field.fields?.length ?? 0) > 0, `${field.key}: a groupList needs child fields`);
          for (const child of field.fields ?? []) {
            expectTrue(
              SCALAR_ONLY.includes(child.type),
              `${field.key}.${child.key}: groupList children cannot nest further`,
            );
          }
        }
        if (field.minItems !== undefined && field.maxItems !== undefined) {
          expectTrue(
            field.minItems <= field.maxItems,
            `${field.key}: minItems exceeds maxItems`,
          );
        }
        if (field.required && field.type === 'boolean') {
          // A required boolean can never be "missing" in a form; it is always
          // one of two values, so requiring it is meaningless and confuses the
          // generated input screen.
          expectTrue(false, `${field.key}: a boolean field should not be required`);
        }
      }
    });

    await check(`${template.id}: sample data satisfies its own contract`, () => {
      const result = validateCreationData(template, template.sampleData, 'sample');
      expectTrue(
        result.ok,
        result.ok ? '' : `sampleData is invalid — ${summarizeIssues(result.issues, 6)}`,
      );
    });

    await check(`${template.id}: link-preview copy is present and resolvable`, () => {
      expectTrue(template.og.title.trim().length > 0, 'og.title is empty');
      expectTrue(template.og.description.trim().length > 0, 'og.description is empty');
      const fieldKeys = new Set(template.fields.map((f) => f.key));
      for (const text of [template.og.title, template.og.description]) {
        for (const match of text.matchAll(/\{([^}]+)\}/g)) {
          expectTrue(
            fieldKeys.has(match[1] ?? ''),
            `og copy references "{${match[1]}}", which is not a field on this template`,
          );
        }
      }
    });

    await check(`${template.id}: has preview media`, () => {
      expectTrue(template.thumbnailUrl.length > 0, 'thumbnailUrl is empty');
      expectTrue(template.previewImages.length > 0, 'previewImages is empty');
    });
  }

  await check('every tier is used by at least one live template', () => {
    for (const key of Object.keys(TIERS)) {
      expectTrue(
        TEMPLATES.some((t) => t.tierKey === key && t.live),
        `tier ${key} has no live template — its store products would be unsellable`,
      );
    }
  });

  report('check-registry');
}

void main();
