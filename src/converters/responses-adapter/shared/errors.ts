import type {
  JsonRecord,
} from '../types.js';
import {
  omitUndefined,
} from './json.js';
import {
  normalizeString,
} from './strings.js';

export function normalizeErrorObject(error: JsonRecord): JsonRecord {
  return omitUndefined({
    message: normalizeString(error?.message)
      || normalizeString(error?.error?.message)
      || JSON.stringify(error),
    type: normalizeString(error?.type) || normalizeString(error?.error?.type) || 'upstream_error',
    code: error?.code ?? error?.error?.code,
    param: error?.param ?? error?.error?.param,
  });
}

export function normalizeUnknownErrorObject(error: unknown): JsonRecord {
  if (error && typeof error === 'object') {
    return normalizeErrorObject(error as JsonRecord);
  }
  return {
    message: normalizeString(error) || 'OpenAI-compatible upstream stream failed.',
    type: 'upstream_stream_error',
  };
}

export function normalizeTopLevelStreamErrorObject(error: JsonRecord): JsonRecord {
  return omitUndefined({
    message: normalizeString(error?.message) || JSON.stringify(error),
    type: normalizeString(error?.error?.type) || 'upstream_error',
    code: error?.code ?? error?.error?.code,
    param: error?.param ?? error?.error?.param,
  });
}
