import type {
  JsonRecord,
} from '../types.js';

export function normalizeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function copyIfPresent(source: JsonRecord, target: JsonRecord, key: string) {
  if (source?.[key] !== undefined) {
    target[key] = source[key];
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonRecord;
    }
  }
  return null;
}

export function omitUndefined<T extends JsonRecord>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return record;
}
