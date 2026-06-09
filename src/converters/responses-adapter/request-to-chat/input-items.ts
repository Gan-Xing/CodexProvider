import crypto from 'node:crypto';
import type {
  OpenAICompatibleProviderCapabilities,
} from '../../../capabilities/thinking_policy.js';
import {
  buildCustomToolCallHistory,
} from '../../apply_patch_proxy.js';
import {
  flattenNamespaceToolName,
} from '../../codex_tool_context.js';
import type {
  InputConversionState,
  JsonRecord,
  ToolNameMap,
} from '../types.js';
import {
  normalizeArray,
  omitUndefined,
} from '../shared/json.js';
import {
  normalizeRole,
  normalizeString,
} from '../shared/strings.js';
import {
  joinTextBlocks,
} from '../shared/text.js';
import {
  shortenToolName,
} from '../shared/tool-names.js';
import {
  convertResponsesContentToChatContent,
} from './content-parts.js';
import {
  flushPendingReasoning,
  flushPendingToolCalls,
  takePendingReasoningText,
  createInputConversionState,
} from './messages.js';
import {
  supportsToolCalling,
} from './tools.js';
import {
  formatUnsupportedCustomToolCallAsText,
  formatUnsupportedToolCallAsText,
  formatUnsupportedToolOutputAsText,
} from './unsupported.js';

export function appendInputItem(
  messages: JsonRecord[],
  item: JsonRecord,
  toolNameMap: ToolNameMap,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined = null,
  state: InputConversionState = createInputConversionState(),
) {
  if (!item || typeof item !== 'object') {
    return;
  }
  const type = normalizeString(item.type);
  if (type === 'message') {
    const role = normalizeRole(item.role);
    const content = convertResponsesContentToChatContent(item.content, providerCapabilities);
    const reasoningContent = role === 'assistant'
      ? normalizeString(item.reasoning_content)
      : null;
    if (role !== 'assistant') {
      flushPendingToolCalls(messages, state);
      flushPendingReasoning(messages, state);
    } else if (state.pendingToolCalls.length > 0) {
      flushPendingToolCalls(messages, state);
    }
    if (content !== null || reasoningContent || role === 'assistant') {
      const pendingReasoning = role === 'assistant'
        ? takePendingReasoningText(state)
        : '';
      messages.push(omitUndefined({
        role,
        content: content ?? '',
        reasoning_content: joinTextBlocks([reasoningContent, pendingReasoning]) || undefined,
      }));
    }
    return;
  }
  if (type === 'reasoning') {
    const reasoning = responsesReasoningText(item);
    if (reasoning) {
      state.pendingReasoning.push(reasoning);
    }
    return;
  }
  if (type === 'custom_tool_call') {
    if (!supportsToolCalling(providerCapabilities)) {
      messages.push({
        role: 'assistant',
        content: formatUnsupportedCustomToolCallAsText(item),
      });
      return;
    }
    const callId = responseToolCallId(item);
    if (!callId) {
      return;
    }
    state.seenToolCallIds.add(callId);
    const toolCall = customToolCallToChatToolCall(item, toolNameMap);
    state.pendingToolCalls.push(toolCall);
    return;
  }
  if (type === 'custom_tool_call_output') {
    const callId = normalizeString(item.call_id);
    if (!callId) {
      return;
    }
    if (!supportsToolCalling(providerCapabilities)) {
      messages.push({
        role: 'user',
        content: formatUnsupportedToolOutputAsText(item),
      });
      return;
    }
    if (!state.seenToolCallIds.has(callId)) {
      flushPendingToolCalls(messages, state);
      flushPendingReasoning(messages, state);
      messages.push(orphanToolOutputMessage(callId, item.output));
      return;
    }
    flushPendingToolCalls(messages, state);
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      content: normalizeString(item.output) || '',
    });
    return;
  }
  if (type === 'function_call') {
    if (!supportsToolCalling(providerCapabilities)) {
      messages.push({
        role: 'assistant',
        content: formatUnsupportedToolCallAsText(item),
      });
      return;
    }
    const callId = responseToolCallId(item);
    if (!callId) {
      return;
    }
    state.seenToolCallIds.add(callId);
    const toolCall = {
      id: callId,
      type: 'function',
      function: {
        name: shortenToolName(
          flattenNamespaceToolName(normalizeString(item.namespace), normalizeString(item.name) || 'tool'),
          toolNameMap,
        ),
        arguments: normalizeString(item.arguments) || '',
      },
    };
    state.pendingToolCalls.push(toolCall);
    return;
  }
  if (type === 'function_call_output') {
    const callId = normalizeString(item.call_id);
    if (!callId) {
      return;
    }
    if (!supportsToolCalling(providerCapabilities)) {
      messages.push({
        role: 'user',
        content: formatUnsupportedToolOutputAsText(item),
      });
      return;
    }
    if (!state.seenToolCallIds.has(callId)) {
      flushPendingToolCalls(messages, state);
      flushPendingReasoning(messages, state);
      messages.push(orphanToolOutputMessage(callId, item.output));
      return;
    }
    flushPendingToolCalls(messages, state);
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      content: normalizeString(item.output) || '',
    });
  }
}

function responsesReasoningText(item: JsonRecord): string {
  const direct = firstNonEmptyString([
    item.reasoning_content,
    item.content,
    item.text,
  ]);
  if (direct) {
    return direct;
  }
  return normalizeArray(item.summary)
    .map((entry) => firstNonEmptyString([entry?.text, entry?.summary, entry?.content]))
    .filter(Boolean)
    .join('\n');
}

function orphanToolOutputMessage(callId: string, output: unknown): JsonRecord {
  return {
    role: 'user',
    content: `Function call output (${callId}): ${normalizeString(output) || ''}`,
  };
}

function responseToolCallId(item: JsonRecord): string {
  return normalizeString(item.call_id) || normalizeString(item.id);
}

function customToolCallToChatToolCall(item: JsonRecord, toolNameMap: ToolNameMap): JsonRecord {
  const name = normalizeString(item.name) || 'custom_tool';
  const history = buildCustomToolCallHistory(name, item.input ?? '');
  return {
    id: responseToolCallId(item) || `call_${crypto.randomUUID()}`,
    type: 'function',
    function: {
      name: shortenToolName(history.name, toolNameMap),
      arguments: history.arguments,
    },
  };
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}
