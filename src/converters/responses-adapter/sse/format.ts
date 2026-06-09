import type {
  JsonRecord,
} from '../types.js';
import {
  normalizeString,
} from '../shared/strings.js';

export function formatSseEvent(payload: JsonRecord): string {
  const eventName = normalizeString(payload?.type) || 'message';
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}
