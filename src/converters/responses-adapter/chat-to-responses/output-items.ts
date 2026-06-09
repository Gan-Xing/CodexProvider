import crypto from 'node:crypto';
import type {
  JsonRecord,
} from '../types.js';
import {
  omitUndefined,
} from '../shared/json.js';

export function buildCompletedReasoningOutputItem(text: string): JsonRecord {
  return omitUndefined({
    id: `rs_${crypto.randomUUID()}`,
    type: 'reasoning',
    reasoning_content: text || undefined,
    summary: text
      ? [{
        type: 'summary_text',
        text,
      }]
      : [],
  });
}

export function buildCompletedMessageOutputItem(text: string): JsonRecord {
  return {
    id: `msg_${crypto.randomUUID()}`,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: text
      ? [{
        type: 'output_text',
        text,
        annotations: [],
      }]
      : [],
  };
}
