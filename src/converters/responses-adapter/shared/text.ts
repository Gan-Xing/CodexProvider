import {
  normalizeString,
} from './strings.js';

export function joinTextBlocks(values: unknown[]): string {
  return values
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join('\n');
}
