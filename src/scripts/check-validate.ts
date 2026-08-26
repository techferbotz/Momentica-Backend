/**
 * Accept/reject fixtures for the placeholder validator — the one thing standing
 * between untrusted form input and what the renderer will read back out.
 *
 * Pure — no database, no network.
 */
import type { TemplateDef } from '../templates/types';
import { collectImageIds, validateCreationData } from '../templates/validate';
import { check, expectEqual, expectTrue, report } from './checkUtil';

const template: TemplateDef = {
  id: 'fixture',
  categoryId: 'birthday',
  name: 'Fixture',
  tagline: '',
  description: '',
  thumbnailUrl: 't',
  previewImages: ['p'],
  tierKey: 'A',
  live: true,
  displayOrder: 1,
  tags: [],
  supportsRsvp: false,
  og: { title: 'Fixture for {name}', description: 'A fixture' },
  fields: [
    { key: 'name', type: 'text', label: 'Name', required: true, maxLength: 10 },
    { key: 'note', type: 'longText', label: 'Note', required: false, maxLength: 20 },
    { key: 'age', type: 'number', label: 'Age', required: false, min: 1, max: 12 },
    { key: 'day', type: 'date', label: 'Day', required: false },
    { key: 'at', type: 'dateTime', label: 'At', required: false },
    { key: 'flag', type: 'boolean', label: 'Flag', required: false, defaultValue: true },
    { key: 'shade', type: 'color', label: 'Shade', required: false },
    {
      key: 'pick',
      type: 'choice',
      label: 'Pick',
      required: false,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    { key: 'where', type: 'location', label: 'Where', required: false },
    { key: 'hero', type: 'image', label: 'Hero', required: false },
    { key: 'gallery', type: 'imageList', label: 'Gallery', required: false, minItems: 2, maxItems: 3 },
    {
      key: 'moments',
      type: 'groupList',
      label: 'Moments',
      required: false,
      minItems: 1,
      maxItems: 2,
      fields: [
        { key: 'title', type: 'text', label: 'Title', required: true, maxLength: 8 },
        { key: 'shot', type: 'image', label: 'Shot', required: false },
      ],
    },
  ],
  sampleData: {},
};

const img = (id: string) => ({ imageId: id });

function accept(data: Record<string, unknown>): Record<string, unknown> {
  const result = validateCreationData(template, data);
  if (!result.ok) {
    throw new Error(`expected valid, got: ${result.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  }
  return result.value;
}

function reject(data: Record<string, unknown>, expectedPath: string): void {
  const result = validateCreationData(template, data);
  if (result.ok) throw new Error(`expected a rejection for "${expectedPath}"`);
  expectTrue(
    result.issues.some((i) => i.path === expectedPath),
    `expected an issue on "${expectedPath}", got: ${result.issues.map((i) => i.path).join(', ')}`,
  );
}

async function main(): Promise<void> {
  await check('a minimal valid payload is accepted', () => {
    const value = accept({ name: 'Aarav' });
    expectEqual(value.name, 'Aarav', 'name');
  });

  await check('a missing required field is rejected', () => reject({}, 'name'));

  await check('strings are trimmed', () => {
    expectEqual(accept({ name: '  Aarav  ' }).name, 'Aarav', 'trimmed name');
  });

  await check('an empty required string is rejected', () => reject({ name: '   ' }, 'name'));

  await check('over-long text is rejected', () =>
    reject({ name: 'x'.repeat(11) }, 'name'));

  await check('a non-string for a text field is rejected', () => reject({ name: 42 }, 'name'));

  await check('unknown keys are rejected, not silently dropped', () =>
    reject({ name: 'Aarav', surprise: 'x' }, 'surprise'));

  await check('numbers honour min and max', () => {
    accept({ name: 'A', age: 5 });
    reject({ name: 'A', age: 0 }, 'age');
    reject({ name: 'A', age: 13 }, 'age');
    reject({ name: 'A', age: 'five' }, 'age');
  });

  await check('dates must be real calendar dates', () => {
    accept({ name: 'A', day: '2026-02-28' });
    reject({ name: 'A', day: '2026-02-30' }, 'day');
    reject({ name: 'A', day: '14-09-2026' }, 'day');
  });

  await check('dateTime must parse', () => {
    accept({ name: 'A', at: '2026-12-06T18:30:00+05:30' });
    reject({ name: 'A', at: 'next tuesday' }, 'at');
  });

  await check('colour must be a six-digit hex', () => {
    expectEqual(accept({ name: 'A', shade: '#FF88AA' }).shade, '#ff88aa', 'normalized colour');
    reject({ name: 'A', shade: 'pink' }, 'shade');
    reject({ name: 'A', shade: '#f8a' }, 'shade');
  });

  await check('choice values must come from the options', () => {
    accept({ name: 'A', pick: 'a' });
    reject({ name: 'A', pick: 'z' }, 'pick');
  });

  await check('location requires an address and numeric coordinates', () => {
    accept({ name: 'A', where: { address: 'Bengaluru' } });
    accept({ name: 'A', where: { address: 'Bengaluru', latitude: 12.9, longitude: 77.6 } });
    reject({ name: 'A', where: { latitude: 12.9 } }, 'where.address');
    reject({ name: 'A', where: { address: 'X', latitude: 'north' } }, 'where.latitude');
  });

  await check('defaults fill in for absent optional fields', () => {
    expectEqual(accept({ name: 'A' }).flag, true, 'default applied');
    expectEqual(accept({ name: 'A', flag: false }).flag, false, 'explicit value wins');
  });

  await check('image input mode demands an imageId', () => {
    accept({ name: 'A', hero: img('abc') });
    reject({ name: 'A', hero: { full: '/x.webp', thumb: '/x-t.webp', width: 1, height: 1 } }, 'hero');
    reject({ name: 'A', hero: 'https://example.com/x.jpg' }, 'hero');
  });

  await check('sample mode demands resolved URLs instead', () => {
    const resolved = validateCreationData(
      template,
      { name: 'A', hero: { full: '/x.webp', thumb: '/x-t.webp', width: 10, height: 10 } },
      'sample',
    );
    expectTrue(resolved.ok, 'resolved image accepted in sample mode');

    const withId = validateCreationData(template, { name: 'A', hero: img('abc') }, 'sample');
    expectTrue(!withId.ok, 'an imageId is not a resolved image');
  });

  await check('imageList honours its item bounds', () => {
    accept({ name: 'A', gallery: [img('a'), img('b')] });
    accept({ name: 'A', gallery: [img('a'), img('b'), img('c')] });
    reject({ name: 'A', gallery: [img('a')] }, 'gallery');
    reject({ name: 'A', gallery: [img('a'), img('b'), img('c'), img('d')] }, 'gallery');
    reject({ name: 'A', gallery: img('a') }, 'gallery');
  });

  await check('imageList items are validated individually', () =>
    reject({ name: 'A', gallery: [img('a'), { nope: 1 }] }, 'gallery[1]'));

  await check('groupList honours its item bounds', () => {
    accept({ name: 'A', moments: [{ title: 'One' }] });
    reject({ name: 'A', moments: [] }, 'moments');
    reject(
      { name: 'A', moments: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }] },
      'moments',
    );
  });

  await check('group children are validated one level deep', () => {
    reject({ name: 'A', moments: [{ shot: img('a') }] }, 'moments[0].title');
    reject({ name: 'A', moments: [{ title: 'way too long' }] }, 'moments[0].title');
    reject({ name: 'A', moments: [{ title: 'One', extra: 1 }] }, 'moments[0].extra');
  });

  await check('every problem is reported, not just the first', () => {
    const result = validateCreationData(template, { age: 99, pick: 'z' });
    expectTrue(!result.ok, 'invalid');
    if (result.ok) return;
    expectTrue(result.issues.length >= 3, `expected several issues, got ${result.issues.length}`);
  });

  await check('image ids are collected from every shape', () => {
    const value = accept({
      name: 'A',
      hero: img('hero-1'),
      gallery: [img('g-1'), img('g-2')],
      moments: [{ title: 'One', shot: img('m-1') }],
    });
    expectEqual(collectImageIds(template, value).sort(), ['g-1', 'g-2', 'hero-1', 'm-1'], 'ids');
  });

  await check('duplicate image ids are collected once', () => {
    const value = accept({ name: 'A', hero: img('same'), gallery: [img('same'), img('other')] });
    expectEqual(collectImageIds(template, value).sort(), ['other', 'same'], 'deduped ids');
  });

  await check('a non-object payload is rejected', () => {
    const result = validateCreationData(template, ['nope'] as unknown);
    expectTrue(!result.ok, 'arrays are not valid data');
  });

  report('check-validate');
}

void main();
