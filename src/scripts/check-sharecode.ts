/**
 * Share codes are the only thing protecting a published experience, so this
 * checks the properties that matter: right shape, drawn from the whole alphabet,
 * and uniformly distributed (a naive `byte % 62` would quietly bias the first
 * few letters and shrink the effective keyspace).
 */
import { SHARE_CODE } from '../config/constants';
import { generateShareCode, isShareCodeShaped } from '../utils/shareCode';
import { check, expectEqual, expectTrue, report } from './checkUtil';

const SAMPLE_SIZE = 60_000;

async function main(): Promise<void> {
  const codes: string[] = [];
  for (let i = 0; i < SAMPLE_SIZE; i += 1) codes.push(generateShareCode());

  await check('codes have the configured length', () => {
    for (const code of codes) {
      if (code.length !== SHARE_CODE.length) {
        throw new Error(`got length ${code.length} for "${code}"`);
      }
    }
  });

  await check('codes only use the configured alphabet', () => {
    for (const code of codes) {
      expectTrue(isShareCodeShaped(code), `"${code}" is not share-code shaped`);
    }
  });

  await check('no collisions across a large sample', () => {
    expectEqual(new Set(codes).size, codes.length, 'unique codes');
  });

  await check('every alphabet character appears', () => {
    const seen = new Set(codes.join(''));
    const missing = [...SHARE_CODE.alphabet].filter((c) => !seen.has(c));
    expectTrue(missing.length === 0, `never generated: ${missing.join('')}`);
  });

  await check('character distribution is uniform within tolerance', () => {
    const counts = new Map<string, number>();
    for (const char of codes.join('')) counts.set(char, (counts.get(char) ?? 0) + 1);

    const total = SAMPLE_SIZE * SHARE_CODE.length;
    const expected = total / SHARE_CODE.alphabet.length;
    // Modulo bias would push the first 8 characters roughly 25% above expected;
    // 10% is comfortably inside sampling noise but well below that.
    const tolerance = expected * 0.1;

    for (const [char, count] of counts) {
      expectTrue(
        Math.abs(count - expected) <= tolerance,
        `"${char}" appeared ${count} times, expected about ${Math.round(expected)}`,
      );
    }
  });

  await check('shape check rejects near-misses', () => {
    expectTrue(!isShareCodeShaped(''), 'empty string');
    expectTrue(!isShareCodeShaped('abc'), 'too short');
    expectTrue(!isShareCodeShaped('a'.repeat(SHARE_CODE.length + 1)), 'too long');
    expectTrue(!isShareCodeShaped('abcdefg-'), 'illegal character');
    expectTrue(!isShareCodeShaped('pv_birth'), 'preview-prefixed code');
  });

  report('check-sharecode');
}

void main();
