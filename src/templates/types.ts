/**
 * The backend↔frontend contract.
 *
 * A template declares the shape of the data it needs; the mobile app builds its
 * input screen from that declaration, and the renderer reads values back out by
 * the same keys. Adding a template therefore means adding a registry entry and a
 * page in the web app — never a change to the mobile app.
 */

export type FieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'date'
  | 'dateTime'
  | 'image'
  | 'imageList'
  | 'choice'
  | 'boolean'
  | 'color'
  | 'location'
  | 'groupList';

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  type: FieldType;
  label: string;
  helpText?: string;
  required: boolean;
  placeholder?: string;
  defaultValue?: unknown;

  /** text | longText */
  maxLength?: number;
  /** number */
  min?: number;
  max?: number;
  /** imageList | groupList */
  minItems?: number;
  maxItems?: number;
  /** image | imageList — cropper hint for the app, e.g. "4:5" */
  aspectRatio?: string;
  /** choice */
  options?: ChoiceOption[];
  /**
   * groupList children. One level only: a repeating group of scalars covers the
   * memory-timeline shape, and arbitrary nesting would make the generated form
   * unbuildable.
   */
  fields?: FieldDef[];
}

/** A `location` value. Rendered as an address plus an optional map pin. */
export interface LocationValue {
  address: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Link-preview copy. `{fieldKey}` placeholders are filled from the creation's
 * own values, so a WhatsApp preview reads "Aarav turns 1" rather than the
 * template name. Kept as data rather than a function so the registry stays
 * declarative and checkable.
 */
export interface OpenGraphDef {
  title: string;
  description: string;
}

export type TierKey = 'A' | 'B' | 'C';

export interface CategoryDef {
  id: string;
  name: string;
  emoji: string;
  displayOrder: number;
  live: boolean;
}

export interface TemplateDef {
  /** Also the web app's route segment: /templates/{id}. */
  id: string;
  categoryId: string;
  name: string;
  tagline: string;
  description: string;
  thumbnailUrl: string;
  previewImages: string[];
  tierKey: TierKey;
  /**
   * The deploy-ordering valve. The web app ships the page first, then this flips
   * to true — the feed must never advertise a template that 404s.
   */
  live: boolean;
  displayOrder: number;
  tags: string[];
  supportsRsvp: boolean;
  og: OpenGraphDef;
  fields: FieldDef[];
  /** Powers the `pv_<templateId>` preview without seeding a database row. */
  sampleData: Record<string, unknown>;
}
