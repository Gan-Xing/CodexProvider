import crypto from 'node:crypto';
import type {
  ChatToResponsesOptions,
  JsonRecord,
} from '../types.js';
import {
  cloneJson,
  normalizeArray,
  omitUndefined,
} from '../shared/json.js';
import {
  normalizeNumber,
} from '../shared/numbers.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  estimateUsageIfEnabled,
  withUsagePricingMetadata,
} from './usage.js';

export function responsesRequestToCompactionResponse(
  request: JsonRecord,
  options: ChatToResponsesOptions = {},
): JsonRecord {
  const responseId = normalizeString(options.responseId) || `resp_${crypto.randomUUID()}`;
  const createdAt = normalizeNumber(options.createdAt) ?? Math.floor(Date.now() / 1000);
  const output = normalizeCompactionOutput(request?.input);
  return omitUndefined({
    id: responseId,
    object: 'response.compaction',
    created_at: createdAt,
    output,
    usage: withUsagePricingMetadata(
      estimateUsageIfEnabled(request, output, options),
      options.modelMetadata,
    ),
  });
}

function normalizeCompactionOutput(input: unknown): JsonRecord[] {
  if (typeof input === 'string') {
    return [{
      id: `msg_${crypto.randomUUID()}`,
      type: 'message',
      status: 'completed',
      role: 'user',
      content: [{
        type: 'input_text',
        text: input,
      }],
    }];
  }
  return normalizeArray(input)
    .map((item) => item && typeof item === 'object' ? cloneJson(item) : null)
    .filter(Boolean);
}
