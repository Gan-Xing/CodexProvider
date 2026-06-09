import {
  normalizeString,
} from './strings.js';

export function isOpenAIOFamilyModel(model: string): boolean {
  const normalized = normalizeString(model);
  return normalized.length > 1
    && normalized.startsWith('o')
    && Boolean(normalized.at(1)?.match(/[0-9]/u));
}
