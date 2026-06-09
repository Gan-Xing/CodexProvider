import crypto from 'node:crypto';
import {
  type CodexToolContext,
  customToolSpec,
  isCustomToolProxy,
  openaiNameForFunctionTool,
  originalCustomToolName,
} from '../../codex_tool_context.js';
import {
  reconstructApplyPatchInput,
  reconstructCustomToolCallInput,
} from '../../apply_patch_proxy.js';
import type {
  JsonRecord,
  StreamState,
  StreamToolCallState,
} from '../types.js';
import {
  cloneJson,
  omitUndefined,
} from '../shared/json.js';
import {
  buildFunctionCallItemId,
} from '../shared/ids.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  restoreToolName,
} from '../shared/tool-names.js';
import {
  allocateOutputIndex,
  withSequence,
} from './state.js';
import {
  finishMessageState,
  finishReasoningState,
} from './content.js';

export function appendToolCallDelta(state: StreamState, choiceIndex: number, delta: JsonRecord): JsonRecord[] {
  const events: JsonRecord[] = [];
  const reasoningState = state.reasoningStates.get(choiceIndex);
  if (reasoningState && !reasoningState.done) {
    events.push(...finishReasoningState(state, choiceIndex));
  }
  const messageState = state.messageStates.get(choiceIndex);
  if (messageState && !messageState.done) {
    events.push(...finishMessageState(state, choiceIndex));
  }
  const toolIndex = Number.isFinite(Number(delta?.index)) ? Number(delta.index) : state.toolCalls.size;
  const key = `${choiceIndex}:${toolIndex}`;
  let toolCall = state.toolCalls.get(key) ?? null;
  if (!toolCall) {
    toolCall = {
      key,
      id: null,
      callId: null,
      name: restoreToolName(normalizeString(delta?.function?.name) || 'tool', state.reverseToolNameMap),
      arguments: '',
      outputIndex: null,
      added: false,
      done: false,
    };
    state.toolCalls.set(key, toolCall);
  }
  if (delta?.function?.name) {
    toolCall.name = restoreToolName(normalizeString(delta.function.name) || toolCall.name, state.reverseToolNameMap);
  }
  const argsDelta = typeof delta?.function?.arguments === 'string' ? delta.function.arguments : '';
  if (delta?.id && !toolCall.callId) {
    const callId = normalizeString(delta.id);
    if (callId) {
      toolCall.callId = callId;
      toolCall.id = buildStreamToolCallItemId(toolCall.name, callId, state.toolContext);
      toolCall.outputIndex = allocateOutputIndex(state);
      state.output.push(buildStreamToolCallOutputItem(toolCall, state.toolContext));
    }
  }
  const item = toolCall.outputIndex !== null ? state.output[toolCall.outputIndex] : null;
  if (item) {
    item.call_id = toolCall.callId;
    updateStreamToolCallOutputItem(item, toolCall, state.toolContext);
  }
  if (!toolCall.added && toolCall.outputIndex !== null && item) {
    toolCall.added = true;
    events.push(withSequence(state, {
      type: 'response.output_item.added',
      output_index: toolCall.outputIndex,
      item: cloneJson(item),
    }));
  }
  if (argsDelta) {
    toolCall.arguments += argsDelta;
    if (item && !isCustomToolProxy(state.toolContext, toolCall.name)) {
      item.arguments = toolCall.arguments;
    }
  }
  if (
    argsDelta
    && toolCall.id
    && toolCall.outputIndex !== null
    && !isCustomToolProxy(state.toolContext, toolCall.name)
  ) {
    events.push(withSequence(state, {
      type: 'response.function_call_arguments.delta',
      item_id: toolCall.id,
      output_index: toolCall.outputIndex,
      delta: argsDelta,
    }));
  }
  return events;
}

export function repairStreamToolCallIdentity(state: StreamState, toolCall: StreamToolCallState): void {
  if (toolCall.outputIndex !== null) {
    return;
  }
  const callId = normalizeString(toolCall.callId) || `call_${crypto.randomUUID()}`;
  toolCall.callId = callId;
  toolCall.id = buildStreamToolCallItemId(toolCall.name, callId, state.toolContext);
  toolCall.outputIndex = allocateOutputIndex(state);
  state.output.push(buildStreamToolCallOutputItem(toolCall, state.toolContext));
}

export function finishToolCallState(state: StreamState, key: string): JsonRecord[] {
  const toolCall = state.toolCalls.get(key);
  if (!toolCall || toolCall.done || !toolCall.id || toolCall.outputIndex === null) {
    return [];
  }
  toolCall.done = true;
  const item = state.output[toolCall.outputIndex];
  item.status = 'completed';
  if (isCustomToolProxy(state.toolContext, toolCall.name)) {
    const input = reconstructStreamCustomToolCallInput(toolCall, state.toolContext);
    item.input = input;
    return [
      withSequence(state, {
        type: 'response.custom_tool_call_input.delta',
        item_id: toolCall.id,
        call_id: toolCall.callId,
        output_index: toolCall.outputIndex,
        delta: input,
      }),
      withSequence(state, {
        type: 'response.output_item.done',
        output_index: toolCall.outputIndex,
        item: cloneJson(item),
      }),
    ];
  }
  item.arguments = toolCall.arguments || '{}';
  return [
    withSequence(state, {
      type: 'response.function_call_arguments.done',
      item_id: toolCall.id,
      output_index: toolCall.outputIndex,
      arguments: toolCall.arguments || '{}',
    }),
    withSequence(state, {
      type: 'response.output_item.done',
      output_index: toolCall.outputIndex,
      item: cloneJson(item),
    }),
  ];
}

function buildStreamToolCallItemId(
  upstreamName: string,
  callId: string,
  toolContext: CodexToolContext,
): string {
  return isCustomToolProxy(toolContext, upstreamName)
    ? `ctc_${callId}`
    : buildFunctionCallItemId(callId);
}

function buildStreamToolCallOutputItem(
  toolCall: StreamToolCallState,
  toolContext: CodexToolContext,
): JsonRecord {
  if (isCustomToolProxy(toolContext, toolCall.name)) {
    return {
      id: toolCall.id,
      type: 'custom_tool_call',
      status: 'in_progress',
      call_id: toolCall.callId,
      name: originalCustomToolName(toolContext, toolCall.name),
      input: '',
    };
  }
  const restored = openaiNameForFunctionTool(toolContext, toolCall.name);
  return omitUndefined({
    id: toolCall.id,
    type: 'function_call',
    status: 'in_progress',
    call_id: toolCall.callId,
    name: restored.name || toolCall.name || 'tool',
    namespace: restored.namespace || undefined,
    arguments: '',
  });
}

function updateStreamToolCallOutputItem(
  item: JsonRecord,
  toolCall: StreamToolCallState,
  toolContext: CodexToolContext,
): void {
  if (isCustomToolProxy(toolContext, toolCall.name)) {
    item.name = originalCustomToolName(toolContext, toolCall.name);
    return;
  }
  const restored = openaiNameForFunctionTool(toolContext, toolCall.name);
  item.name = restored.name || toolCall.name || 'tool';
  if (restored.namespace) {
    item.namespace = restored.namespace;
  } else {
    delete item.namespace;
  }
}

function reconstructStreamCustomToolCallInput(
  toolCall: StreamToolCallState,
  toolContext: CodexToolContext,
): string {
  const spec = customToolSpec(toolContext, toolCall.name);
  return spec?.kind === 'apply_patch'
    ? reconstructApplyPatchInput(spec.proxyAction, toolCall.arguments)
    : reconstructCustomToolCallInput(toolCall.arguments);
}
