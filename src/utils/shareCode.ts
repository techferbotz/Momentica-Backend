import { randomBytes } from 'node:crypto';
import { SHARE_CODE } from '../config/constants';

const { alphabet, length } = SHARE_CODE;

/**
 * 8 random base62 characters — about 2.2e14 possibilities.
 *
 * This is the only thing standing between a stranger and someone's proposal or
 * their baby photos, so the codes must be unguessable rather than sequential.
 * Rejection sampling keeps the distribution uniform: a plain `byte % 62` would
 * make the first 8 letters of the alphabet slightly likelier than the rest.
 */
export function generateShareCode(): string {
  const max = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function isShareCodeShaped(value: string): boolean {
  if (value.length !== length) return false;
  for (const char of value) {
    if (!alphabet.includes(char)) return false;
  }
  return true;
}
