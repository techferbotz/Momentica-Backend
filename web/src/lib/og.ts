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
export function openGraphFor(code: string, payload: RenderPayload, ogCard?: string): OpenGraph {
  const fromApi = absolutize(payload.og.imageUrl);

  // Which image belongs on the link card depends on whose it is.
  //
  // A creator's own photo always wins — it is the point of the moment. But for
  // previews the API points at the template's CAROUSEL still, which is a
  // phone-shaped WebP built for the app's detail screen: wrong aspect for a
  // 1.91:1 card, and a format WhatsApp's crawler has never handled reliably.
  // For those we prefer the purpose-built 1200x630 JPEG instead.
  //
  // A moment shared with no card at all is still the worst outcome, so this
  // falls through to whatever it can get.
  const imageUrl = fromApi && !isOurStill(fromApi) ? fromApi : (absolutize(ogCard) ?? fromApi);

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
