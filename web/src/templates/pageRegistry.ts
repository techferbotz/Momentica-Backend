import GreetingOpenLetter from './greeting_open_letter/index.astro';
import { manifestFor } from './manifest';

/**
 * id -> the page that draws it. The one file a seventh template edits, besides
 * its own folder and one manifest line.
 *
 * Astro does not export a stable public type for a component module, so the
 * value is loosely typed here rather than pinned to an internal path that
 * moves between versions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AstroPage = any;

const PAGES: Record<string, AstroPage> = {
  greeting_open_letter: GreetingOpenLetter,
};

export interface ResolvedTemplate {
  Page: AstroPage;
  ogCard: string;
}

/**
 * Undefined means the backend resolved a template this renderer has not built.
 * That is a real state during a rollout — the backend's `live` flag is the
 * valve, and it can be flipped a deploy too early — so the route treats it as
 * a page that is not available rather than crashing.
 */
export function templateFor(templateId: string): ResolvedTemplate | undefined {
  const Page = PAGES[templateId];
  const manifest = manifestFor(templateId);
  if (!Page || !manifest) return undefined;
  return { Page, ogCard: manifest.ogCard };
}
