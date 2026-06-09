import type {
  JsonRecord,
} from '../types.js';
import {
  normalizeArray,
} from '../shared/json.js';

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

export function extractReasoningText(message: JsonRecord): string {
  const direct = firstNonEmptyString([
    message?.reasoning_content,
    message?.reasoning,
    message?.reasoning_text,
    message?.thinking,
    message?.thoughts,
  ]);
  if (direct) {
    return direct;
  }
  return reasoningDetailsText(message?.reasoning_details);
}

function reasoningDetailsText(value: unknown): string {
  const parts: string[] = [];
  for (const detail of normalizeArray(value)) {
    if (!detail || typeof detail !== 'object') {
      continue;
    }
    const record = detail as JsonRecord;
    const direct = firstNonEmptyString([record.summary, record.text, record.content]);
    if (direct) {
      parts.push(direct);
    }
    for (const part of normalizeArray(record.parts)) {
      const text = firstNonEmptyString([part?.text, part?.summary, part?.content]);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join('\n\n');
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function splitLeadingThinkBlock(text: string): { reasoning: string; answer: string } | null {
  const leadingWhitespaceLength = text.length - text.trimStart().length;
  const afterWhitespace = text.slice(leadingWhitespaceLength);
  if (!afterWhitespace.startsWith(THINK_OPEN_TAG)) {
    return null;
  }
  const bodyStart = leadingWhitespaceLength + THINK_OPEN_TAG.length;
  const closeRelative = text.slice(bodyStart).indexOf(THINK_CLOSE_TAG);
  if (closeRelative < 0) {
    return null;
  }
  const closeStart = bodyStart + closeRelative;
  const answerStart = closeStart + THINK_CLOSE_TAG.length;
  return {
    reasoning: text.slice(bodyStart, closeStart).trim(),
    answer: text.slice(answerStart).trimStart(),
  };
}
