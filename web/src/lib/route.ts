import { fetchRender } from './render';
import { manifestFor } from '../templates/manifest';
import type { RouteState } from './types';

export interface RouteOutcome {
  state: RouteState;
  status: number;
  cacheControl: string;
  robots: string;
}

/**
 * Resolve a code to everything a route needs: what to draw, what status to
 * send, and how it may be cached and indexed.
 *
 * There is deliberately no "is this code shaped like a code" guard in front of
 * the fetch. The contract is explicit that the code's shape is the API's
 * decision — duplicating that dispatch here would mean a new code shape 404s
 * at the web layer while the API resolves it perfectly well.
 */
export async function resolveRoute(code: string): Promise<RouteOutcome> {
  const state = await fetchRender(code);

  if (state.kind === 'gone') {
    return {
      state,
      // The API being down is not the link's fault, and a 404 would tell a
      // crawler this moment no longer exists.
      status: state.reason === 'unavailable' ? 503 : 404,
      cacheControl: 'no-store',
      robots: 'noindex, nofollow',
    };
  }

  // The backend resolved a template this renderer has not built. A real state
  // during a rollout: `live` is the valve and it can be flipped a deploy early.
  // Better a branded unavailable page with an honest 404 than a crash or a
  // blank 200 that a crawler will happily cache as the moment itself.
  if (!manifestFor(state.payload.templateId)) {
    return {
      state: { kind: 'gone', code, reason: 'unknown' },
      status: 404,
      cacheControl: 'no-store',
      robots: 'noindex, nofollow',
    };
  }

  const mode = state.payload.meta.mode;

  // `preview` is the shopfront and the one thing worth finding in search.
  // Everything else is somebody's private moment: privacy here is the
  // unguessability of an 8-character code, and a search engine indexing
  // "A message for Ananya" would defeat that outright. noindex does not
  // affect WhatsApp link previews — different mechanism entirely.
  if (mode === 'preview') {
    return {
      state,
      status: 200,
      cacheControl: 'public, max-age=300',
      robots: 'index, follow',
    };
  }

  return {
    state,
    // `expired` is 200 on purpose. It is a real page with real content, and a
    // 410 makes some crawlers drop the preview card — so a re-shared expired
    // link would lose the copy that makes it worth re-sharing.
    status: 200,
    cacheControl: 'no-store',
    robots: 'noindex, nofollow',
  };
}
