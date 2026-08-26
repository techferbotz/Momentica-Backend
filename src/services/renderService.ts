import type { Creation } from '@prisma/client';
import { RENDER } from '../config/constants';
import { ErrorCode, NotFoundError } from '../errors/AppError';
import { verifyDraftPreviewToken } from '../auth/jwt';
import * as creationRepo from '../repositories/creationRepo';
import * as imageService from '../services/imageService';
import { getLiveTemplate } from '../templates/registry';
import type { FieldDef, TemplateDef } from '../templates/types';
import { collectImageIds } from '../templates/validate';
import { isShareCodeShaped } from '../utils/shareCode';

/**
 * One endpoint serves every rendered page, so the web app has a single fetch
 * path regardless of what it is showing. The code's shape decides which:
 *
 *   pv_<templateId>  feed preview, from the registry's sample data
 *   d_<token>        the creator's own draft, before payment
 *   <8 base62 chars> a published, paid link
 *
 * Expiry is reported as a mode rather than an error. The renderer needs the
 * link-preview copy to draw a branded "this has ended" page with a renew
 * prompt, and the failure envelope has nowhere to carry it.
 */

export type RenderMode = 'preview' | 'draft' | 'published' | 'expired';

export interface RenderPayload {
  templateId: string;
  values: Record<string, unknown> | null;
  meta: {
    mode: RenderMode;
    expiresAt: string | null;
    showBranding: boolean;
  };
  og: {
    title: string;
    description: string;
    imageUrl: string | null;
  };
  features: {
    rsvp: boolean;
  };
  /** Present only for a published link, so the view ping can address it. */
  creationId?: string;
}

function requireTemplate(templateId: string): TemplateDef {
  const template = getLiveTemplate(templateId);
  if (!template) {
    throw new NotFoundError('This experience is no longer available', ErrorCode.NOT_FOUND);
  }
  return template;
}

/** Fills `{fieldKey}` placeholders in the link-preview copy from the values. */
function interpolate(text: string, values: Record<string, unknown>): string {
  return text
    .replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = values[key];
      if (value === undefined || value === null) return '';
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isImageRef(value: unknown): value is { imageId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { imageId?: unknown }).imageId === 'string'
  );
}

/**
 * Swaps stored image ids for the URLs the page will load. An id with no row
 * behind it becomes null rather than a broken reference, so a photo deleted
 * after publishing degrades to a gap instead of a broken page.
 */
function resolveImages(
  fields: FieldDef[],
  values: Record<string, unknown>,
  images: Map<string, imageService.ImageView>,
): Record<string, unknown> {
  const swap = (value: unknown): unknown =>
    isImageRef(value) ? (images.get(value.imageId) ?? null) : value;

  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) continue;

    if (field.type === 'image') {
      out[field.key] = swap(value);
    } else if (field.type === 'imageList' && Array.isArray(value)) {
      out[field.key] = value.map(swap);
    } else if (field.type === 'groupList' && Array.isArray(value)) {
      out[field.key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? resolveImages(field.fields ?? [], item as Record<string, unknown>, images)
          : item,
      );
    } else {
      out[field.key] = value;
    }
  }
  return out;
}

function ogImageFrom(
  creation: Creation | null,
  values: Record<string, unknown>,
  images: Map<string, imageService.ImageView>,
): string | null {
  if (creation?.coverImageId) {
    const cover = images.get(creation.coverImageId);
    if (cover) return cover.full;
  }
  // Otherwise the first resolved image anywhere in the payload.
  for (const value of Object.values(values)) {
    if (isImageRef(value)) {
      const resolved = images.get(value.imageId);
      if (resolved) return resolved.full;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isImageRef(item)) {
          const resolved = images.get(item.imageId);
          if (resolved) return resolved.full;
        }
      }
    }
  }
  return null;
}

async function buildPayload(
  template: TemplateDef,
  storedValues: Record<string, unknown>,
  mode: RenderMode,
  creation: Creation | null,
): Promise<RenderPayload> {
  const imageIds = collectImageIds(template, storedValues);
  const images = await imageService.resolveMany(imageIds);

  return {
    templateId: template.id,
    values: resolveImages(template.fields, storedValues, images),
    meta: {
      mode,
      expiresAt: creation?.expiresAt?.toISOString() ?? null,
      // Free hosting does not exist in this model — every live link is paid —
      // but the flag keeps the renderer's contract stable if that changes.
      showBranding: true,
    },
    og: {
      title: interpolate(template.og.title, storedValues) || template.name,
      description: interpolate(template.og.description, storedValues) || template.tagline,
      imageUrl: ogImageFrom(creation, storedValues, images),
    },
    features: { rsvp: template.supportsRsvp && isRsvpEnabled(template, storedValues) },
    ...(mode === 'published' && creation ? { creationId: creation.id } : {}),
  };
}

/** A template may offer RSVP but the creator can still switch it off. */
function isRsvpEnabled(template: TemplateDef, values: Record<string, unknown>): boolean {
  const toggle = template.fields.find((f) => f.type === 'boolean' && f.key === 'rsvpEnabled');
  if (!toggle) return true;
  const value = values.rsvpEnabled;
  return value === undefined ? Boolean(toggle.defaultValue) : value === true;
}

async function renderTemplatePreview(templateId: string): Promise<RenderPayload> {
  const template = requireTemplate(templateId);
  // Sample data already carries resolved URLs, so it bypasses image lookup.
  return {
    templateId: template.id,
    values: template.sampleData,
    meta: { mode: 'preview', expiresAt: null, showBranding: true },
    og: {
      title: interpolate(template.og.title, template.sampleData) || template.name,
      description: template.tagline,
      imageUrl: template.previewImages[0] ?? template.thumbnailUrl,
    },
    features: { rsvp: template.supportsRsvp },
  };
}

async function renderDraft(token: string): Promise<RenderPayload> {
  const { creationId } = verifyDraftPreviewToken(token);
  const creation = await creationRepo.findById(creationId);
  if (!creation) {
    throw new NotFoundError('This preview link has expired', ErrorCode.NOT_FOUND);
  }
  const template = requireTemplate(creation.templateId);
  return buildPayload(template, creation.data as Record<string, unknown>, 'draft', creation);
}

async function renderPublished(shareCode: string): Promise<RenderPayload> {
  const creation = await creationRepo.findByShareCode(shareCode);
  if (!creation || creation.status !== 'PUBLISHED') {
    throw new NotFoundError('This experience is no longer available', ErrorCode.NOT_FOUND);
  }

  const template = requireTemplate(creation.templateId);
  const expired = creation.expiresAt !== null && creation.expiresAt.getTime() <= Date.now();

  if (expired) {
    // Enough to draw the ended page and offer a renewal; none of the content.
    const payload = await buildPayload(
      template,
      creation.data as Record<string, unknown>,
      'expired',
      creation,
    );
    return { ...payload, values: null };
  }

  return buildPayload(template, creation.data as Record<string, unknown>, 'published', creation);
}

export async function render(code: string): Promise<RenderPayload> {
  if (code.startsWith(RENDER.previewCodePrefix)) {
    return renderTemplatePreview(code.slice(RENDER.previewCodePrefix.length));
  }
  if (code.startsWith(RENDER.draftCodePrefix)) {
    return renderDraft(code.slice(RENDER.draftCodePrefix.length));
  }
  if (isShareCodeShaped(code)) {
    return renderPublished(code);
  }
  throw new NotFoundError('This experience is no longer available', ErrorCode.NOT_FOUND);
}

/**
 * Recorded by an explicit ping rather than as a side effect of the render fetch,
 * so link-preview crawlers and prefetchers don't inflate the count the creator
 * sees. Only live published links count.
 */
export async function recordView(code: string): Promise<void> {
  if (!isShareCodeShaped(code)) return;

  const creation = await creationRepo.findByShareCode(code);
  if (!creation || creation.status !== 'PUBLISHED') return;
  if (creation.expiresAt !== null && creation.expiresAt.getTime() <= Date.now()) return;

  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  await creationRepo.recordView(creation.id, day);
}

/** Resolves a share code to a live published creation, or throws. */
export async function requireLiveCreation(code: string): Promise<Creation> {
  const creation = isShareCodeShaped(code) ? await creationRepo.findByShareCode(code) : null;
  if (!creation || creation.status !== 'PUBLISHED') {
    throw new NotFoundError('This experience is no longer available', ErrorCode.NOT_FOUND);
  }
  if (creation.expiresAt !== null && creation.expiresAt.getTime() <= Date.now()) {
    throw new NotFoundError('This experience has ended', ErrorCode.NOT_FOUND);
  }
  return creation;
}
