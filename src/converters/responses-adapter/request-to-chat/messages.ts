import type {
  InputConversionState,
  JsonRecord,
} from '../types.js';
import {
  omitUndefined,
} from '../shared/json.js';
import {
  joinTextBlocks,
} from '../shared/text.js';

export function createInputConversionState(): InputConversionState {
  return {
    pendingToolCalls: [],
    pendingReasoning: [],
    seenToolCallIds: new Set(),
  };
}

export function flushPendingToolCalls(messages: JsonRecord[], state: InputConversionState): void {
  if (state.pendingToolCalls.length === 0) {
    return;
  }
  const toolCalls = state.pendingToolCalls.splice(0);
  const previous = messages.at(-1);
  if (previous?.role === 'assistant') {
    mergeToolCallsIntoAssistantMessage(previous, toolCalls);
    return;
  }
  const reasoningContent = takePendingReasoningText(state);
  messages.push(omitUndefined({
    role: 'assistant',
    content: '',
    reasoning_content: reasoningContent || undefined,
    tool_calls: toolCalls,
  }));
}

export function flushPendingReasoning(messages: JsonRecord[], state: InputConversionState): void {
  const reasoningContent = takePendingReasoningText(state);
  if (!reasoningContent) {
    return;
  }
  const previous = messages.at(-1);
  if (previous?.role === 'assistant') {
    appendReasoningToAssistantMessage(previous, reasoningContent);
    return;
  }
  messages.push({
    role: 'assistant',
    content: '',
    reasoning_content: reasoningContent,
  });
}

function mergeToolCallsIntoAssistantMessage(message: JsonRecord, toolCalls: JsonRecord[]): void {
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.push(...toolCalls);
  } else {
    message.tool_calls = toolCalls;
  }
  if (message.content === undefined || message.content === null) {
    message.content = '';
  }
}

function appendReasoningToAssistantMessage(message: JsonRecord, reasoningContent: string): void {
  if (!reasoningContent) {
    return;
  }
  message.reasoning_content = joinTextBlocks([message.reasoning_content, reasoningContent]);
  if (message.content === undefined || message.content === null) {
    message.content = '';
  }
}

export function takePendingReasoningText(state: InputConversionState): string {
  const text = joinTextBlocks(state.pendingReasoning);
  state.pendingReasoning.length = 0;
  return text;
}

export function normalizeChatMessages(messages: JsonRecord[]): void {
  for (const message of messages) {
    if (message?.role !== 'assistant') {
      continue;
    }
    const hasContent = message.content !== undefined
      && message.content !== null
      && !(Array.isArray(message.content) && message.content.length === 0);
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (!hasContent && !hasToolCalls) {
      message.content = '';
    }
  }
}

export function collapseSystemMessagesToHead(messages: JsonRecord[]): JsonRecord[] {
  const systemChunks: string[] = [];
  const rest: JsonRecord[] = [];
  for (const message of messages) {
    if (message?.role === 'system' && typeof message.content === 'string') {
      const content = message.content.trim();
      if (content) {
        systemChunks.push(content);
      }
      continue;
    }
    rest.push(message);
  }
  if (systemChunks.length === 0) {
    return rest;
  }
  return [{
    role: 'system',
    content: systemChunks.join('\n\n'),
  }, ...rest];
}
