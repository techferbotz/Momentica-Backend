import { ErrorCode, NotFoundError } from '../errors/AppError';
import { getTier } from '../config/pricing';
import { RENDER } from '../config/constants';
import {
  getCategory,
  getLiveTemplate,
  listLiveCategories,
  listLiveTemplates,
} from '../templates/registry';
import type { CategoryDef, FieldDef, TemplateDef } from '../templates/types';
import { paginate, type Page } from '../utils/cursor';

/**
 * The read-only catalogue the app browses. Everything here comes from the code
 * registry, so these responses are safe to cache hard.
 */

export interface CategoryView {
  id: string;
  name: string;
  emoji: string;
}

export interface TemplateCardView {
  id: string;
  categoryId: string;
  name: string;
  tagline: string;
  thumbnailUrl: string;
  tierKey: string;
  displayPerDay: string;
  tags: string[];
  /** Feed "Preview" opens the renderer with this code. */
  previewCode: string;
}

export interface TemplateDetailView extends TemplateCardView {
  description: string;
  previewImages: string[];
  supportsRsvp: boolean;
  /** Drives the generated input screen. */
  fields: FieldDef[];
  pricing: { tierKey: string; label: string; displayPerDay: string; bundles: unknown[] };
}

function toCategoryView(category: CategoryDef): CategoryView {
  return { id: category.id, name: category.name, emoji: category.emoji };
}

export function previewCodeFor(templateId: string): string {
  return `${RENDER.previewCodePrefix}${templateId}`;
}

function toCard(template: TemplateDef): TemplateCardView {
  return {
    id: template.id,
    categoryId: template.categoryId,
    name: template.name,
    tagline: template.tagline,
    thumbnailUrl: template.thumbnailUrl,
    tierKey: template.tierKey,
    displayPerDay: getTier(template.tierKey).displayPerDay,
    tags: template.tags,
    previewCode: previewCodeFor(template.id),
  };
}

export interface FeedSection {
  category: CategoryView;
  templates: TemplateCardView[];
}

/** The home screen: every live category with a handful of its templates. */
export function getFeed(perCategory = 6): FeedSection[] {
  return listLiveCategories()
    .map((category) => ({
      category: toCategoryView(category),
      templates: listLiveTemplates(category.id).slice(0, perCategory).map(toCard),
    }))
    .filter((section) => section.templates.length > 0);
}

export function listCategories(): CategoryView[] {
  return listLiveCategories().map(toCategoryView);
}

export function listTemplatesInCategory(
  categoryId: string,
  offset: number,
  limit: number,
): Page<TemplateCardView> {
  const category = getCategory(categoryId);
  if (!category?.live) {
    throw new NotFoundError('Category not found', ErrorCode.NOT_FOUND);
  }
  const page = paginate(listLiveTemplates(categoryId), offset, limit);
  return { items: page.items.map(toCard), nextCursor: page.nextCursor };
}

export function getTemplateDetail(templateId: string): TemplateDetailView {
  const template = getLiveTemplate(templateId);
  if (!template) {
    throw new NotFoundError('Template not found', ErrorCode.NOT_FOUND);
  }
  const tier = getTier(template.tierKey);

  return {
    ...toCard(template),
    description: template.description,
    previewImages: template.previewImages,
    supportsRsvp: template.supportsRsvp,
    fields: template.fields,
    pricing: {
      tierKey: tier.key,
      label: tier.label,
      displayPerDay: tier.displayPerDay,
      bundles: tier.bundles,
    },
  };
}
