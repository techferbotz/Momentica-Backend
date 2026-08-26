import type { FieldDef, TemplateDef } from './types';

/**
 * Validates a creation's `data` against its template's field contract.
 *
 * Pure and database-free by design: it checks shape, type and bounds only.
 * Whether an image actually exists and belongs to the caller is a separate,
 * DB-backed question answered in creationService — keeping it out of here is
 * what lets this run in a check script with no Postgres.
 */

export interface ValidationIssue {
  /** Dotted path, e.g. `memories[1].title`. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Image values take one of two shapes:
 *   - `input`  — `{ imageId }`, what the app sends. Storing the id (not a URL)
 *                keeps ownership checkable and survives a CDN change.
 *   - `sample` — a resolved `{ full, thumb, width, height }`, used by registry
 *                sample data, which has no database rows behind it.
 */
export type ImageMode = 'input' | 'sample';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

class Collector {
  readonly issues: ValidationIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }
}

function validateImage(
  value: unknown,
  path: string,
  mode: ImageMode,
  issues: Collector,
): unknown {
  if (!isPlainObject(value)) {
    issues.add(path, 'must be an image reference');
    return undefined;
  }

  if (mode === 'input') {
    const imageId = value.imageId;
    if (typeof imageId !== 'string' || imageId.trim() === '') {
      issues.add(path, 'must be an object with an "imageId"');
      return undefined;
    }
    return { imageId: imageId.trim() };
  }

  const { full, thumb, width, height } = value;
  if (typeof full !== 'string' || typeof thumb !== 'string') {
    issues.add(path, 'must have "full" and "thumb" URLs');
    return undefined;
  }
  if (typeof width !== 'number' || typeof height !== 'number') {
    issues.add(path, 'must have numeric "width" and "height"');
    return undefined;
  }
  return { full, thumb, width, height };
}

function validateScalar(
  field: FieldDef,
  value: unknown,
  path: string,
  mode: ImageMode,
  issues: Collector,
): unknown {
  switch (field.type) {
    case 'text':
    case 'longText': {
      if (typeof value !== 'string') {
        issues.add(path, 'must be text');
        return undefined;
      }
      const trimmed = value.trim();
      if (field.required && trimmed === '') {
        issues.add(path, 'is required');
        return undefined;
      }
      if (field.maxLength !== undefined && trimmed.length > field.maxLength) {
        issues.add(path, `must be at most ${field.maxLength} characters`);
        return undefined;
      }
      return trimmed;
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.add(path, 'must be a number');
        return undefined;
      }
      if (field.min !== undefined && value < field.min) {
        issues.add(path, `must be at least ${field.min}`);
        return undefined;
      }
      if (field.max !== undefined && value > field.max) {
        issues.add(path, `must be at most ${field.max}`);
        return undefined;
      }
      return value;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        issues.add(path, 'must be true or false');
        return undefined;
      }
      return value;
    }

    case 'date': {
      if (typeof value !== 'string' || !DATE_RE.test(value) || !isRealDate(value)) {
        issues.add(path, 'must be a date in YYYY-MM-DD form');
        return undefined;
      }
      return value;
    }

    case 'dateTime': {
      if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
        issues.add(path, 'must be an ISO 8601 date and time');
        return undefined;
      }
      return value;
    }

    case 'color': {
      if (typeof value !== 'string' || !COLOR_RE.test(value)) {
        issues.add(path, 'must be a hex colour like #ff88aa');
        return undefined;
      }
      return value.toLowerCase();
    }

    case 'choice': {
      if (typeof value !== 'string') {
        issues.add(path, 'must be one of the offered options');
        return undefined;
      }
      const allowed = (field.options ?? []).map((o) => o.value);
      if (!allowed.includes(value)) {
        issues.add(path, `must be one of: ${allowed.join(', ')}`);
        return undefined;
      }
      return value;
    }

    case 'location': {
      if (!isPlainObject(value)) {
        issues.add(path, 'must be a location');
        return undefined;
      }
      const address = value.address;
      if (typeof address !== 'string' || address.trim() === '') {
        issues.add(`${path}.address`, 'is required');
        return undefined;
      }
      const out: Record<string, unknown> = { address: address.trim() };
      for (const coord of ['latitude', 'longitude'] as const) {
        const raw = value[coord];
        if (raw === undefined || raw === null) continue;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          issues.add(`${path}.${coord}`, 'must be a number');
          return undefined;
        }
        out[coord] = raw;
      }
      return out;
    }

    case 'image':
      return validateImage(value, path, mode, issues);

    default: {
      issues.add(path, 'has an unsupported field type');
      return undefined;
    }
  }
}

function validateField(
  field: FieldDef,
  raw: unknown,
  path: string,
  mode: ImageMode,
  issues: Collector,
): { present: boolean; value?: unknown } {
  const absent = raw === undefined || raw === null || raw === '';

  if (absent) {
    if (field.required) {
      issues.add(path, 'is required');
    }
    return { present: false };
  }

  if (field.type === 'imageList') {
    if (!Array.isArray(raw)) {
      issues.add(path, 'must be a list of images');
      return { present: false };
    }
    const min = field.minItems ?? 0;
    const max = field.maxItems ?? raw.length;
    if (raw.length < min) {
      issues.add(path, `needs at least ${min} ${min === 1 ? 'photo' : 'photos'}`);
      return { present: false };
    }
    if (raw.length > max) {
      issues.add(path, `takes at most ${max} ${max === 1 ? 'photo' : 'photos'}`);
      return { present: false };
    }
    const items = raw.map((item, i) => validateImage(item, `${path}[${i}]`, mode, issues));
    return { present: true, value: items };
  }

  if (field.type === 'groupList') {
    if (!Array.isArray(raw)) {
      issues.add(path, 'must be a list');
      return { present: false };
    }
    const min = field.minItems ?? 0;
    const max = field.maxItems ?? raw.length;
    if (raw.length < min) {
      issues.add(path, `needs at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
      return { present: false };
    }
    if (raw.length > max) {
      issues.add(path, `takes at most ${max} ${max === 1 ? 'entry' : 'entries'}`);
      return { present: false };
    }

    const children = field.fields ?? [];
    const items = raw.map((item, i) => {
      const itemPath = `${path}[${i}]`;
      if (!isPlainObject(item)) {
        issues.add(itemPath, 'must be an object');
        return {};
      }
      // One level of nesting only — a group's children are always scalars.
      return validateObject(children, item, itemPath, mode, issues);
    });
    return { present: true, value: items };
  }

  return { present: true, value: validateScalar(field, raw, path, mode, issues) };
}

function validateObject(
  fields: FieldDef[],
  data: Record<string, unknown>,
  basePath: string,
  mode: ImageMode,
  issues: Collector,
): Record<string, unknown> {
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      issues.add(basePath ? `${basePath}.${key}` : key, 'is not a field on this template');
    }
  }

  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const path = basePath ? `${basePath}.${field.key}` : field.key;
    const result = validateField(field, data[field.key], path, mode, issues);
    if (result.present && result.value !== undefined) {
      out[field.key] = result.value;
    } else if (!result.present && field.defaultValue !== undefined) {
      out[field.key] = field.defaultValue;
    }
  }
  return out;
}

/**
 * Returns the normalized value (trimmed strings, defaults filled in, unknown
 * keys reported rather than silently dropped) or the full list of problems.
 */
export function validateCreationData(
  template: TemplateDef,
  data: unknown,
  mode: ImageMode = 'input',
): ValidationResult {
  if (!isPlainObject(data)) {
    return { ok: false, issues: [{ path: 'data', message: 'must be an object' }] };
  }

  const issues = new Collector();
  const value = validateObject(template.fields, data, '', mode, issues);

  return issues.issues.length > 0 ? { ok: false, issues: issues.issues } : { ok: true, value };
}

/** Every image id referenced anywhere in a validated `data` payload. */
export function collectImageIds(template: TemplateDef, data: Record<string, unknown>): string[] {
  const ids: string[] = [];

  const take = (value: unknown): void => {
    if (isPlainObject(value) && typeof value.imageId === 'string') ids.push(value.imageId);
  };

  for (const field of template.fields) {
    const value = data[field.key];
    if (field.type === 'image') {
      take(value);
    } else if (field.type === 'imageList' && Array.isArray(value)) {
      value.forEach(take);
    } else if (field.type === 'groupList' && Array.isArray(value)) {
      for (const item of value) {
        if (!isPlainObject(item)) continue;
        for (const child of field.fields ?? []) {
          if (child.type === 'image') take(item[child.key]);
          else if (child.type === 'imageList' && Array.isArray(item[child.key])) {
            (item[child.key] as unknown[]).forEach(take);
          }
        }
      }
    }
  }

  return [...new Set(ids)];
}

/** Human-readable summary for a BadRequest message. */
export function summarizeIssues(issues: ValidationIssue[], max = 4): string {
  const shown = issues.slice(0, max).map((i) => `${i.path} ${i.message}`);
  const extra = issues.length - shown.length;
  return extra > 0 ? `${shown.join('; ')} (and ${extra} more)` : shown.join('; ');
}
