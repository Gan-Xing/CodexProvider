import type {
  JsonRecord,
  StreamState,
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
  normalizeErrorObject,
  normalizeTopLevelStreamErrorObject,
} from '../shared/errors.js';
import {
  mapProviderUsage,
} from '../chat-to-responses/usage.js';
import {
  appendMessageDelta,
  appendReasoningDelta,
  appendToolCallDelta,
  ensureStreamStarted,
  flushInlineThinkAtBoundary,
} from './events.js';
import {
  failStreamState,
  finishOpenItems,
} from './finish.js';

export function translateChatCompletionStreamData(data: string, state: StreamState): JsonRecord[] {
  const trimmed = String(data ?? '').trim();
  if (!trimmed || trimmed === '[DONE]') {
    return [];
  }
  let chunk: JsonRecord;
  try {
    chunk = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (chunk?.error && typeof chunk.error === 'object') {
    return failStreamState(state, normalizeErrorObject(chunk.error));
  }
  if (normalizeString(chunk?.type) === 'error') {
    return failStreamState(state, normalizeTopLevelStreamErrorObject(chunk));
  }
  if (!state.createdEmitted) {
    const upstreamResponseId = normalizeString(chunk?.id);
    const upstreamCreatedAt = normalizeNumber(chunk?.created);
    if (upstreamResponseId) {
      state.responseId = upstreamResponseId;
    }
    if (upstreamCreatedAt !== null) {
      state.createdAt = upstreamCreatedAt;
    }
  }
  const upstreamModel = normalizeString(chunk?.model);
  if (upstreamModel) {
    state.responseModel = upstreamModel;
  }
  const events = ensureStreamStarted(state);
  state.usage = mapProviderUsage(chunk) ?? state.usage;

  for (const choice of normalizeArray(chunk?.choices)) {
    const choiceIndex = Number.isFinite(Number(choice?.index)) ? Number(choice.index) : 0;
    const delta = choice?.delta ?? {};
    const reasoningDelta = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '';
    const contentDelta = typeof delta?.content === 'string' ? delta.content : '';
    if (reasoningDelta) {
      events.push(...appendReasoningDelta(state, choiceIndex, reasoningDelta));
    }
    if (contentDelta) {
      events.push(...appendMessageDelta(state, choiceIndex, contentDelta));
    }
    for (const toolCallDelta of normalizeArray(delta?.tool_calls)) {
      events.push(...flushInlineThinkAtBoundary(state, choiceIndex));
      events.push(...appendToolCallDelta(state, choiceIndex, toolCallDelta));
    }
    const finishReason = normalizeString(choice?.finish_reason);
    if (finishReason) {
      events.push(...finishOpenItems(state));
    }
  }

  return events;
}
