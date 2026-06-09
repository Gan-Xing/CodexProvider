import type {
  JsonRecord,
} from './thinking_policy.js';

export function normalizeReasoningEffort(value: unknown): string | null {
  const normalized = normalizeString(value).toLowerCase();
  return normalized || null;
}

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function omitUndefined<T extends JsonRecord>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return record;
}
