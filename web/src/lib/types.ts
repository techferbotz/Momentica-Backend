/**
 * The renderer's view of the API contract.
 *
 * The envelope comes straight from the API's own source — a type-only import,
 * erased at compile time, so nothing about Express or Prisma reaches this
 * bundle. If the backend changes the payload shape, this fails to compile.
 */
import type { RenderMode, RenderPayload } from '@api/services/renderService';
import type { FieldDef, LocationValue, TemplateDef } from '@api/templates/types';

export type { FieldDef, LocationValue, RenderMode, RenderPayload, TemplateDef };

/**
 * A resolved image, as it actually arrives.
 *
 * Deliberately NOT the API's `imageService.ImageView`, which requires `id`.
 * Preview payloads are built from a template's `sampleData`, which bypasses
 * `toView()` and carries no id at all — so importing ImageView here would
 * promise a field that is absent in exactly the mode we render most often.
 *
 * `full` is <=1280px, `thumb` <=512px. An image deleted after publishing
 * resolves to `null` rather than vanishing, so every consumer of this type has
 * to handle null and draw a gap instead of a broken <img>.
 */
export interface ResolvedImage {
  id?: string;
  full: string;
  thumb: string;
  width: number;
  height: number;
}

/** What a route resolved to, before anything is drawn. */
export type RouteState =
  | { kind: 'render'; code: string; payload: RenderPayload }
  | { kind: 'gone'; code: string; reason: GoneReason };

/**
 * Why there is nothing to render. The API reports every one of these as
 * `NOT_FOUND` and differentiates only in the human message, so the renderer
 * decides from the shape of the code it asked about rather than by parsing
 * prose that is free to change.
 */
export type GoneReason =
  /** An 8-char share code that resolves to nothing, or a malformed path. */
  | 'unknown'
  /** A `d_` draft preview token past its ~30 minute life. */
  | 'draft-expired'
  /** The API itself is unreachable or erroring — not the link's fault. */
  | 'unavailable';
