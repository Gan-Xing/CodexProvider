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
  InlineThinkMode,
  InlineThinkState,
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
  splitLeadingThinkBlock,
} from '../chat-to-responses/reasoning.js';
import {
  buildResponsesObject,
} from '../chat-to-responses/response-object.js';
import {
  allocateOutputIndex,
  withSequence,
} from './state.js';

const THINK_OPEN_TAG = '<think>';

export function ensureStreamStarted(state: StreamState): JsonRecord[] {
  if (state.createdEmitted) {
    return [];
  }
  state.createdEmitted = true;
  const response = buildResponsesObject({
    responseId: state.responseId,
    createdAt: state.createdAt,
    request: state.request,
    responseModel: state.responseModel,
    status: 'in_progress',
    output: [],
    usage: null,
  });
  return [
    withSequence(state, {
      type: 'response.created',
      response,
    }),
    withSequence(state, {
      type: 'response.in_progress',
      response,
    }),
  ];
}

export function appendMessageDelta(state: StreamState, choiceIndex: number, delta: string): JsonRecord[] {
  const inlineState = state.inlineThinkStates.get(choiceIndex);
  if (inlineState?.mode === 'text') {
    return appendOutputTextDelta(state, choiceIndex, delta);
  }

  const detector = inlineState ?? { mode: 'detecting' as InlineThinkMode, buffer: '' };
  state.inlineThinkStates.set(choiceIndex, detector);

  if (detector.mode === 'detecting') {
    detector.buffer += delta;
    const decision = leadingThinkPrefixDecision(detector.buffer);
    if (decision === 'need_more') {
      return [];
    }
    if (decision === 'reasoning') {
      detector.mode = 'reasoning';
      return drainCompleteInlineThink(state, choiceIndex, detector);
    }
    detector.mode = 'text';
    const text = detector.buffer;
    detector.buffer = '';
    return appendOutputTextDelta(state, choiceIndex, text);
  }

  detector.buffer += delta;
  return drainCompleteInlineThink(state, choiceIndex, detector);
}

export function appendOutputTextDelta(state: StreamState, choiceIndex: number, delta: string): JsonRecord[] {
  const events: JsonRecord[] = [];
  const reasoningState = state.reasoningStates.get(choiceIndex);
  if (reasoningState && !reasoningState.done) {
    events.push(...finishReasoningState(state, choiceIndex));
  }
  const messageState = ensureMessageState(state, choiceIndex, events);
  messageState.text += delta;
  events.push(withSequence(state, {
    type: 'response.output_text.delta',
    item_id: messageState.id,
    output_index: messageState.outputIndex,
    content_index: 0,
    delta,
  }));
  return events;
}

function ensureMessageState(state: StreamState, choiceIndex: number, events: JsonRecord[]) {
  let messageState = state.messageStates.get(choiceIndex);
  if (!messageState) {
    messageState = {
      id: `msg_${crypto.randomUUID()}`,
      outputIndex: allocateOutputIndex(state),
      text: '',
      added: false,
      contentAdded: false,
      done: false,
    };
    state.messageStates.set(choiceIndex, messageState);
    state.output.push({
      id: messageState.id,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    });
  }
  if (!messageState.added) {
    messageState.added = true;
    events.push(withSequence(state, {
      type: 'response.output_item.added',
      output_index: messageState.outputIndex,
      item: cloneJson(state.output[messageState.outputIndex]),
    }));
  }
  if (!messageState.contentAdded) {
    messageState.contentAdded = true;
    events.push(withSequence(state, {
      type: 'response.content_part.added',
      item_id: messageState.id,
      output_index: messageState.outputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: '',
        annotations: [],
      },
    }));
  }
  return messageState;
}

export function appendReasoningDelta(state: StreamState, choiceIndex: number, delta: string): JsonRecord[] {
  const events: JsonRecord[] = [];
  let reasoningState = state.reasoningStates.get(choiceIndex);
  if (!reasoningState || reasoningState.done) {
    reasoningState = {
      id: `rs_${crypto.randomUUID()}`,
      outputIndex: allocateOutputIndex(state),
      text: '',
      added: false,
      partAdded: false,
      done: false,
    };
    state.reasoningStates.set(choiceIndex, reasoningState);
    state.output.push({
      id: reasoningState.id,
      type: 'reasoning',
      status: 'in_progress',
      reasoning_content: '',
      summary: [],
    });
  }
  if (!reasoningState.added) {
    reasoningState.added = true;
    events.push(withSequence(state, {
      type: 'response.output_item.added',
      output_index: reasoningState.outputIndex,
      item: cloneJson(state.output[reasoningState.outputIndex]),
    }));
  }
  if (!reasoningState.partAdded) {
    reasoningState.partAdded = true;
    events.push(withSequence(state, {
      type: 'response.reasoning_summary_part.added',
      item_id: reasoningState.id,
      output_index: reasoningState.outputIndex,
      summary_index: 0,
      part: {
        type: 'summary_text',
        text: '',
      },
    }));
  }
  reasoningState.text += delta;
  events.push(withSequence(state, {
    type: 'response.reasoning_summary_text.delta',
    item_id: reasoningState.id,
    output_index: reasoningState.outputIndex,
    summary_index: 0,
    delta,
  }));
  return events;
}

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

export function flushInlineThinkAtBoundary(state: StreamState, choiceIndex: number): JsonRecord[] {
  const inlineState = state.inlineThinkStates.get(choiceIndex);
  if (!inlineState || inlineState.mode === 'text') {
    return [];
  }
  const events = drainCompleteInlineThink(state, choiceIndex, inlineState);
  if (events.length > 0) {
    return events;
  }
  const buffered = inlineState.buffer;
  const previousMode = inlineState.mode;
  inlineState.buffer = '';
  inlineState.mode = 'text';
  if (!buffered) {
    return [];
  }
  if (previousMode === 'reasoning' || buffered.trimStart().startsWith(THINK_OPEN_TAG)) {
    const reasoning = stripLeadingThinkOpenTag(buffered).trim();
    return reasoning
      ? [
        ...appendReasoningDelta(state, choiceIndex, reasoning),
        ...finishReasoningState(state, choiceIndex),
      ]
      : [];
  }
  return appendOutputTextDelta(state, choiceIndex, buffered);
}

function leadingThinkPrefixDecision(buffer: string): 'need_more' | 'reasoning' | 'text' {
  const afterWhitespace = buffer.trimStart();
  if (!afterWhitespace) {
    return 'need_more';
  }
  if (afterWhitespace.startsWith(THINK_OPEN_TAG)) {
    return 'reasoning';
  }
  if (THINK_OPEN_TAG.startsWith(afterWhitespace)) {
    return 'need_more';
  }
  return 'text';
}

function drainCompleteInlineThink(
  state: StreamState,
  choiceIndex: number,
  inlineState: InlineThinkState,
): JsonRecord[] {
  const split = splitLeadingThinkBlock(inlineState.buffer);
  if (!split) {
    return [];
  }
  inlineState.mode = 'text';
  inlineState.buffer = '';
  const events: JsonRecord[] = [];
  if (split.reasoning) {
    events.push(...appendReasoningDelta(state, choiceIndex, split.reasoning));
    events.push(...finishReasoningState(state, choiceIndex));
  }
  if (split.answer) {
    events.push(...appendOutputTextDelta(state, choiceIndex, split.answer));
  }
  return events;
}

function stripLeadingThinkOpenTag(text: string): string {
  const leadingWhitespaceLength = text.length - text.trimStart().length;
  const afterWhitespace = text.slice(leadingWhitespaceLength);
  return afterWhitespace.startsWith(THINK_OPEN_TAG)
    ? afterWhitespace.slice(THINK_OPEN_TAG.length)
    : text;
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

export function finishReasoningState(state: StreamState, choiceIndex: number): JsonRecord[] {
  const reasoningState = state.reasoningStates.get(choiceIndex);
  if (!reasoningState || reasoningState.done) {
    return [];
  }
  reasoningState.done = true;
  const summary = reasoningState.text
    ? [{
      type: 'summary_text',
      text: reasoningState.text,
    }]
    : [];
  const item = state.output[reasoningState.outputIndex];
  item.status = 'completed';
  item.reasoning_content = reasoningState.text;
  item.summary = summary;
  return [
    withSequence(state, {
      type: 'response.reasoning_summary_text.done',
      item_id: reasoningState.id,
      output_index: reasoningState.outputIndex,
      summary_index: 0,
      text: reasoningState.text,
    }),
    withSequence(state, {
      type: 'response.reasoning_summary_part.done',
      item_id: reasoningState.id,
      output_index: reasoningState.outputIndex,
      summary_index: 0,
      part: {
        type: 'summary_text',
        text: reasoningState.text,
      },
    }),
    withSequence(state, {
      type: 'response.output_item.done',
      output_index: reasoningState.outputIndex,
      item: cloneJson(item),
    }),
  ];
}

export function finishMessageState(state: StreamState, choiceIndex: number): JsonRecord[] {
  const messageState = state.messageStates.get(choiceIndex);
  if (!messageState || messageState.done) {
    return [];
  }
  messageState.done = true;
  const part = {
    type: 'output_text',
    text: messageState.text,
    annotations: [],
  };
  const item = state.output[messageState.outputIndex];
  item.status = 'completed';
  item.content = [part];
  return [
    withSequence(state, {
      type: 'response.output_text.done',
      item_id: messageState.id,
      output_index: messageState.outputIndex,
      content_index: 0,
      text: messageState.text,
    }),
    withSequence(state, {
      type: 'response.content_part.done',
      item_id: messageState.id,
      output_index: messageState.outputIndex,
      content_index: 0,
      part,
    }),
    withSequence(state, {
      type: 'response.output_item.done',
      output_index: messageState.outputIndex,
      item: cloneJson(item),
    }),
  ];
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
