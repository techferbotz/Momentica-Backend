import { TEMPLATES } from '@api/templates/registry';
import type { FieldDef } from '@api/templates/types';
import data from './manifest.json';

/**
 * What the renderer knows about each template it implements.
 *
 * The data lives in `manifest.json` rather than in this file so that plain Node
 * can read it without a TypeScript runner — that is what lets
 * `scripts/check-templates.mjs` verify it against the live API.
 *
 * Separate from `pageRegistry.ts`, which imports `.astro` components that only
 * Astro can load.
 */
export interface TemplateManifestEntry {
  id: string;
  /** The 1200x630 JPEG link-preview card. Preferred over the API's own
   * preview still, which is phone-shaped WebP built for the app carousel. */
  ogCard: string;
  /** Every value key this template's page reads. Verified by validateManifest. */
  readsKeys: readonly string[];
}

export const MANIFEST: readonly TemplateManifestEntry[] = data.templates;

const BY_ID = new Map(MANIFEST.map((entry) => [entry.id, entry]));

export function manifestFor(templateId: string): TemplateManifestEntry | undefined {
  return BY_ID.get(templateId);
}

/**
 * Templates the backend advertises but the renderer has not built yet.
 * Surfaced on the holding page so "the feed links to a page that 404s" is
 * something you read rather than discover from a recipient.
 */
export function unimplementedLiveTemplates(): string[] {
  return TEMPLATES.filter((template) => template.live && !BY_ID.has(template.id)).map((t) => t.id);
}

/**
 * Does every key a template reads actually exist in the backend's field
 * definitions? Returns problems rather than throwing.
 *
 * Pure on purpose. An earlier version asserted this at module scope, which in
 * `output: 'server'` runs on first request rather than at build — so a drifted
 * key produced a hung request instead of a failed build. A check that fails
 * later and worse than no check is not a check.
 */
export function validateManifest(): string[] {
  const problems: string[] = [];

  for (const entry of MANIFEST) {
    const backend = TEMPLATES.find((template) => template.id === entry.id);

    if (!backend) {
      problems.push(
        `"${entry.id}" is implemented by the renderer but absent from the backend registry.`,
      );
      continue;
    }

    const declared = declaredKeys(backend.fields);
    const missing = entry.readsKeys.filter((key) => !declared.has(key));

    if (missing.length > 0) {
      problems.push(
        `"${entry.id}" reads keys the backend does not declare: ${missing.join(', ')}. ` +
          `Declared: ${[...declared].join(', ')}.`,
      );
    }
  }

  return problems;
}

function declaredKeys(fields: FieldDef[]): Set<string> {
  return new Set(fields.map((field) => field.key));
}
