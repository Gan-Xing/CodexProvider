import crypto from 'node:crypto';
import {
  buildCodexToolContext,
} from '../../codex_tool_context.js';
import type {
  ChatToResponsesOptions,
  JsonRecord,
} from '../types.js';
import {
  normalizeArray,
} from '../shared/json.js';
import {
  normalizeNumber,
} from '../shared/numbers.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  buildReverseToolNameMap,
} from '../shared/tool-names.js';
import {
  buildCompletedMessageOutputItem,
  buildCompletedReasoningOutputItem,
} from './output-items.js';
import {
  extractReasoningText,
  splitLeadingThinkBlock,
} from './reasoning.js';
import {
  buildResponsesObject,
} from './response-object.js';
import {
  chatToolCallToResponseOutputItem,
} from './tool-calls.js';
import {
  estimateUsageIfEnabled,
  mapProviderUsage,
  withUsagePricingMetadata,
} from './usage.js';

export function chatCompletionsResponseToResponses(
  chatResponse: JsonRecord,
  options: ChatToResponsesOptions = {},
): JsonRecord {
  const request = options.request ?? {};
  const reverseToolNameMap = buildReverseToolNameMap(request);
  const toolContext = buildCodexToolContext(request?.tools);
  const responseId = normalizeString(options.responseId)
    || normalizeString(chatResponse?.id)
    || `resp_${crypto.randomUUID()}`;
  const createdAt = normalizeNumber(options.createdAt)
    ?? normalizeNumber(chatResponse?.created)
    ?? Math.floor(Date.now() / 1000);
  const output: JsonRecord[] = [];

  for (const choice of normalizeArray(chatResponse?.choices)) {
    const message = choice?.message ?? {};
    const rawText = typeof message?.content === 'string' ? message.content : normalizeString(message?.content);
    const inlineThink = splitLeadingThinkBlock(rawText);
    const text = inlineThink ? normalizeString(inlineThink.answer) : normalizeString(rawText);
    const explicitReasoningContent = extractReasoningText(message);
    const reasoningContent = explicitReasoningContent || inlineThink?.reasoning || '';
    const toolCalls = normalizeArray(message?.tool_calls);
    if (reasoningContent || request?.reasoning) {
      output.push(buildCompletedReasoningOutputItem(reasoningContent));
    }
    if (text) {
      output.push(buildCompletedMessageOutputItem(text));
    }
    for (const toolCall of toolCalls) {
      output.push(chatToolCallToResponseOutputItem(toolCall, reverseToolNameMap, toolContext));
    }
  }

  return buildResponsesObject({
    responseId,
    createdAt,
    request,
    responseModel: normalizeString(chatResponse?.model) || null,
    status: 'completed',
    output,
    usage: withUsagePricingMetadata(
      mapProviderUsage(chatResponse)
        ?? estimateUsageIfEnabled(request, output, options),
      options.modelMetadata,
    ),
  });
}
