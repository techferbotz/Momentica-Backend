import type { RenderPayload } from './types';

/** The public hostname. Not API_BASE, which is a loopback address in production. */
export const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN ?? 'https://momentica.ferbotz.com').replace(
  /\/+$/,
  '',
);

export interface OpenGraph {
  title: string;
  description: string;
  imageUrl: string | null;
  pageUrl: string;
  /** Only set when we authored the image and therefore know its box. */
  imageWidth?: number;
  imageHeight?: number;
}

/** Preview stills are ours, authored to the OG card's aspect. */
const OG_CARD = { width: 1200, height: 630 } as const;

/**
 * `og.imageUrl` arrives in two different shapes and both have to end up
 * absolute, because a relative og:image produces no preview card at all:
 *
 *   preview   "/templates/greeting_open_letter/p1.webp"  — hosted by us
 *   published "https://momentica-media.s3.../full.webp"  — the creator's photo
 *
 * RENDER.md documents only the absolute form. Handling both is not defensive
 * padding; the relative form is what the live API returns today.
 */
export function absolutize(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.trim().length === 0) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${PUBLIC_ORIGIN}${trimmed}`;
  return `${PUBLIC_ORIGIN}/${trimmed}`;
}

/**
 * Link-preview copy for a page that has something to show. Titles arrive with
 * the recipient's name already interpolated, so the renderer places copy and
 * never composes it.
 */
export function openGraphFor(code: string, payload: RenderPayload, fallbackImage?: string): OpenGraph {
  // A moment shared with no preview card at all is a worse outcome than a
  // generic one, so fall back to the template's own still.
  const imageUrl = absolutize(payload.og.imageUrl) ?? absolutize(fallbackImage);

  return {
    title: payload.og.title,
    description: payload.og.description,
    imageUrl,
    pageUrl: `${PUBLIC_ORIGIN}/${code}`,
    // Dimensions only where we know them. A creator's photo is 4:5 or 1:1 and
    // whatever size their phone produced — claiming 1200x630 for it would make
    // the crop worse, not better.
    ...(imageUrl && isOurStill(imageUrl)
      ? { imageWidth: OG_CARD.width, imageHeight: OG_CARD.height }
      : {}),
  };
}

function isOurStill(url: string): boolean {
  return url.startsWith(`${PUBLIC_ORIGIN}/templates/`);
}
