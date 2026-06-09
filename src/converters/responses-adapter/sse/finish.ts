import type {
  JsonRecord,
  StreamState,
} from '../types.js';
import {
  buildResponsesObject,
} from '../chat-to-responses/response-object.js';
import {
  estimateUsageIfEnabled,
} from '../chat-to-responses/usage.js';
import {
  ensureStreamStarted,
  finishMessageState,
  finishReasoningState,
  finishToolCallState,
  flushInlineThinkAtBoundary,
  repairStreamToolCallIdentity,
} from './events.js';
import {
  withSequence,
} from './state.js';

export function finishStreamState(state: StreamState): JsonRecord[] {
  if (state.terminalEmitted) {
    return [];
  }
  if (state.failedError) {
    state.terminalEmitted = true;
    return [
      ...ensureStreamStarted(state),
      ...finishOpenItems(state),
      withSequence(state, {
        type: 'response.failed',
        response: buildResponsesObject({
          responseId: state.responseId,
          createdAt: state.createdAt,
          request: state.request,
          responseModel: state.responseModel,
          status: 'failed',
          output: state.output,
          usage: state.usage,
          error: state.failedError,
        }),
      }),
    ];
  }
  state.terminalEmitted = true;
  return [
    ...ensureStreamStarted(state),
    ...finishOpenItems(state),
    withSequence(state, {
      type: 'response.completed',
      response: buildResponsesObject({
        responseId: state.responseId,
        createdAt: state.createdAt,
        request: state.request,
        responseModel: state.responseModel,
        status: 'completed',
        output: state.output,
        usage: state.usage ?? estimateUsageIfEnabled(state.request, state.output, {
          request: state.request,
          providerCapabilities: state.providerCapabilities,
        }),
      }),
    }),
  ];
}

export function finishOpenItems(state: StreamState): JsonRecord[] {
  const events: JsonRecord[] = [];
  const closers: Array<{ outputIndex: number; run: () => JsonRecord[] }> = [];
  for (const choiceIndex of state.inlineThinkStates.keys()) {
    events.push(...flushInlineThinkAtBoundary(state, choiceIndex));
  }
  for (const [choiceIndex, reasoningState] of state.reasoningStates.entries()) {
    if (!reasoningState.done) {
      closers.push({
        outputIndex: reasoningState.outputIndex,
        run: () => finishReasoningState(state, choiceIndex),
      });
    }
  }
  for (const [choiceIndex, messageState] of state.messageStates.entries()) {
    if (!messageState.done) {
      closers.push({
        outputIndex: messageState.outputIndex,
        run: () => finishMessageState(state, choiceIndex),
      });
    }
  }
  for (const toolCall of state.toolCalls.values()) {
    if (!toolCall.done && toolCall.outputIndex === null && (toolCall.name || toolCall.arguments)) {
      repairStreamToolCallIdentity(state, toolCall);
    }
    if (!toolCall.done && toolCall.outputIndex !== null) {
      closers.push({
        outputIndex: toolCall.outputIndex,
        run: () => finishToolCallState(state, toolCall.key),
      });
    }
  }
  closers.sort((left, right) => left.outputIndex - right.outputIndex);
  for (const closer of closers) {
    events.push(...closer.run());
  }
  return events;
}

export function failStreamState(state: StreamState, error: JsonRecord): JsonRecord[] {
  if (state.terminalEmitted) {
    return [];
  }
  state.failedError = error;
  return finishStreamState(state);
}
