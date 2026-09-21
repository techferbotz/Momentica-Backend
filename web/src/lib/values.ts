import type { LocationValue, ResolvedImage } from './types';

/**
 * The only thing in the renderer that touches raw payload JSON.
 *
 * Two rules from the contract are enforced here so that no template has to
 * remember them:
 *
 *   1. An optional field left empty is ABSENT from `values`, not null. Six
 *      templates each remembering that is six chances to render "undefined"
 *      into someone's proposal.
 *   2. An image deleted after publishing resolves to null. Callers get null and
 *      draw a gap; they never get a broken URL.
 */
export class Values {
  private readonly raw: Record<string, unknown>;

  constructor(raw: Record<string, unknown> | null | undefined) {
    this.raw = raw ?? {};
  }

  /** True only when the key is present AND carries something renderable. */
  has(key: string): boolean {
    const value = this.raw[key];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  text(key: string, fallback = ''): string {
    const value = this.raw[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number') return String(value);
    return fallback;
  }

  number(key: string): number | undefined {
    const value = this.raw[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  boolean(key: string, fallback = false): boolean {
    const value = this.raw[key];
    return typeof value === 'boolean' ? value : fallback;
  }

  /** `choice` fields arrive as one of the field's option values. */
  choice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const value = this.raw[key];
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  }

  /** `date` is "YYYY-MM-DD"; `dateTime` is ISO 8601 with an offset. */
  date(key: string): Date | undefined {
    const value = this.raw[key];
    if (typeof value !== 'string') return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  location(key: string): LocationValue | undefined {
    const value = this.raw[key];
    if (!isRecord(value) || typeof value.address !== 'string') return undefined;
    return {
      address: value.address,
      latitude: typeof value.latitude === 'number' ? value.latitude : undefined,
      longitude: typeof value.longitude === 'number' ? value.longitude : undefined,
    };
  }

  /** A single `image` field. Null when absent, or deleted after publishing. */
  image(key: string): ResolvedImage | null {
    return asImage(this.raw[key]);
  }

  /** An `imageList`. Entries that failed to resolve are dropped, not rendered as gaps. */
  images(key: string): ResolvedImage[] {
    const value = this.raw[key];
    if (!Array.isArray(value)) return [];
    return value.map(asImage).filter((image): image is ResolvedImage => image !== null);
  }

  /**
   * A `groupList` — one level deep only, per the contract. Each entry is
   * wrapped in its own Values so a group's children get the same absent-field
   * handling as the top level.
   */
  groups(key: string): Values[] {
    const value = this.raw[key];
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).map((item) => new Values(item));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asImage(value: unknown): ResolvedImage | null {
  if (!isRecord(value)) return null;
  const { full, thumb, width, height, id } = value;
  if (typeof full !== 'string' || typeof width !== 'number' || typeof height !== 'number') {
    return null;
  }
  return {
    ...(typeof id === 'string' ? { id } : {}),
    full,
    thumb: typeof thumb === 'string' ? thumb : full,
    width,
    height,
  };
}
