import {
  isCodexProviderAdapterEmulatedBuiltinToolType,
  normalizeCodexProviderBuiltinToolName,
} from '../../builtin-tools/index.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import type {
  CodexProviderHostedToolExecutorRegistry,
} from '../../hosted_tool_executors.js';
import {
  asyncIteratorToIterable,
  chatStreamChunkFinishedToolCalls,
  chatStreamChunkHasAssistantText,
  collectStreamingToolCallDeltas,
  drainAsyncIterator,
  emptyAsyncIterable,
  parseChatStreamData,
  type StreamingToolCallAccumulator,
} from './streaming.js';
import type {
  AdapterHostedToolExecutionRecord,
  JsonRecord,
} from './types.js';
import {
  cloneJson,
  normalizeArray,
  normalizeString,
  omitUndefined,
} from './utils.js';

export interface AdapterHostedToolCall {
  declaration: NormalizedCodexProviderHostedToolDeclaration;
  toolCall: JsonRecord;
  message: JsonRecord;
}

export type AdapterHostedStreamingDecision =
  | {
    kind: 'final_stream';
    bufferedChunks: string[];
    remaining: AsyncIterable<string>;
  }
  | {
    kind: 'tool_calls';
    calls: AdapterHostedToolCall[];
  }
  | {
    kind: 'error';
    message: string;
  };

export async function inspectAdapterHostedStreamingTurn(
  dataLines: AsyncIterable<string>,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
  registry: CodexProviderHostedToolExecutorRegistry,
): Promise<AdapterHostedStreamingDecision> {
  const iterator = dataLines[Symbol.asyncIterator]();
  const bufferedChunks: string[] = [];
  const accumulator: StreamingToolCallAccumulator = {
    toolCallsByKey: new Map(),
    sawToolCallDelta: false,
  };

  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        return streamingDecisionFromBufferedChunks(bufferedChunks, accumulator, hostedTools, registry);
      }
      const data = next.value;
      bufferedChunks.push(data);
      const chunk = parseChatStreamData(data);
      if (!chunk) {
        continue;
      }
      collectStreamingToolCallDeltas(chunk, accumulator);
      if (!accumulator.sawToolCallDelta && chatStreamChunkHasAssistantText(chunk)) {
        return {
          kind: 'final_stream',
          bufferedChunks,
          remaining: asyncIteratorToIterable(iterator),
        };
      }
      if (accumulator.sawToolCallDelta && chatStreamChunkFinishedToolCalls(chunk)) {
        await drainAsyncIterator(iterator);
        return streamingDecisionFromBufferedChunks(bufferedChunks, accumulator, hostedTools, registry);
      }
    }
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function streamingDecisionFromBufferedChunks(
  bufferedChunks: string[],
  accumulator: StreamingToolCallAccumulator,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
  registry: CodexProviderHostedToolExecutorRegistry,
): AdapterHostedStreamingDecision {
  const toolCalls = [...accumulator.toolCallsByKey.values()];
  if (toolCalls.length === 0) {
    return {
      kind: 'final_stream',
      bufferedChunks,
      remaining: emptyAsyncIterable(),
    };
  }

  const fakeMessage = {
    content: '',
    tool_calls: toolCalls,
  };
  const executableCalls = collectAdapterHostedToolCalls(
    {
      choices: [{
        message: fakeMessage,
      }],
    },
    hostedTools,
    registry,
  );
  if (executableCalls.length === 0) {
    return {
      kind: 'final_stream',
      bufferedChunks,
      remaining: emptyAsyncIterable(),
    };
  }
  if (executableCalls.length !== toolCalls.length) {
    return {
      kind: 'error',
      message: 'A streamed assistant turn mixed adapter-emulated hosted tool calls with non-adapter tool calls. This is not supported yet.',
    };
  }
  return {
    kind: 'tool_calls',
    calls: executableCalls,
  };
}

export function collectAdapterHostedToolCalls(
  chatResponse: JsonRecord,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
  registry: CodexProviderHostedToolExecutorRegistry,
): AdapterHostedToolCall[] {
  const calls: AdapterHostedToolCall[] = [];
  for (const choice of normalizeArray(chatResponse?.choices)) {
    const message = choice?.message;
    if (!message || typeof message !== 'object') {
      continue;
    }
    for (const toolCall of normalizeArray(message.tool_calls)) {
      const emulatedToolName = normalizeString(toolCall?.function?.name);
      if (!emulatedToolName) {
        continue;
      }
      const declaration = hostedTools.find((tool) => (
        tool.mode === 'adapter-emulated'
        && normalizeString(tool.emulatedToolName || tool.name) === emulatedToolName
      ));
      if (!declaration || !registry.has(declaration.name)) {
        continue;
      }
      calls.push({
        declaration,
        toolCall,
        message,
      });
    }
  }
  return calls;
}

export function groupAdapterHostedToolCallsByMessage(
  calls: AdapterHostedToolCall[],
): Array<{ message: JsonRecord; toolCalls: AdapterHostedToolCall[] }> {
  const grouped = new Map<JsonRecord, AdapterHostedToolCall[]>();
  for (const call of calls) {
    const existing = grouped.get(call.message);
    if (existing) {
      existing.push(call);
    } else {
      grouped.set(call.message, [call]);
    }
  }
  return [...grouped.entries()].map(([message, toolCalls]) => ({ message, toolCalls }));
}

export function buildAssistantToolCallMessage(
  message: JsonRecord,
  toolCalls: JsonRecord[],
): JsonRecord {
  return omitUndefined({
    role: 'assistant',
    content: typeof message?.content === 'string' ? message.content : '',
    tool_calls: toolCalls.map((toolCall) => cloneJson(toolCall)),
  });
}

export function appendDeferredToolsFromToolSearch(
  chatBody: JsonRecord,
  execution: AdapterHostedToolExecutionRecord,
): void {
  if (normalizeCodexProviderBuiltinToolName(execution.toolName) !== 'tool_search') {
    return;
  }
  const deferredTools = normalizeDeferredToolSearchChatTools(execution.resultContent);
  if (deferredTools.length === 0) {
    return;
  }
  const existingTools = Array.isArray(chatBody.tools) ? chatBody.tools : [];
  const existingNames = new Set(
    existingTools
      .map((tool) => normalizeString((tool as JsonRecord | null | undefined)?.function?.name))
      .filter(Boolean),
  );
  const nextTools = [...existingTools];
  for (const tool of deferredTools) {
    const name = normalizeString(tool.function?.name);
    if (!name || existingNames.has(name)) {
      continue;
    }
    existingNames.add(name);
    nextTools.push(tool);
  }
  chatBody.tools = nextTools;
  delete chatBody.tool_choice;
}

function normalizeDeferredToolSearchChatTools(value: unknown): JsonRecord[] {
  const payload = unwrapDeferredToolSearchPayload(value);
  if (!payload) {
    return [];
  }
  const tools = normalizeArray(payload.tools)
    .map((tool) => normalizeDeferredChatFunctionTool(tool))
    .filter(Boolean) as JsonRecord[];
  const namespaceTools = normalizeArray(payload.namespaces)
    .flatMap((namespace) => normalizeDeferredNamespaceChatFunctionTools(namespace));
  return dedupeDeferredChatFunctionTools([...tools, ...namespaceTools]);
}

function unwrapDeferredToolSearchPayload(value: unknown): JsonRecord | null {
  if (typeof value === 'string') {
    try {
      return unwrapDeferredToolSearchPayload(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  if (Array.isArray(record.tools) || Array.isArray(record.namespaces)) {
    return record;
  }
  if (record.content && typeof record.content === 'object') {
    return unwrapDeferredToolSearchPayload(record.content);
  }
  return null;
}

function normalizeDeferredNamespaceChatFunctionTools(value: unknown): JsonRecord[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const namespace = value as JsonRecord;
  const namespaceName = normalizeString(namespace.name);
  return normalizeArray(namespace.tools)
    .map((tool) => normalizeDeferredChatFunctionTool(tool, namespaceName))
    .filter(Boolean) as JsonRecord[];
}

function normalizeDeferredChatFunctionTool(value: unknown, namespace = ''): JsonRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as JsonRecord;
  const functionRecord = record.function && typeof record.function === 'object'
    ? record.function as JsonRecord
    : record;
  const rawName = normalizeString(functionRecord.name ?? record.name);
  const name = namespace ? `${namespace}${rawName}` : rawName;
  if (!isValidDeferredChatFunctionName(name)) {
    return null;
  }
  return {
    type: 'function',
    function: omitUndefined({
      name,
      description: normalizeString(functionRecord.description ?? record.description) || undefined,
      parameters: normalizeDeferredToolParameters(functionRecord.parameters ?? record.parameters),
      strict: functionRecord.strict ?? record.strict,
    }),
  };
}

function normalizeDeferredToolParameters(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {
    type: 'object',
    properties: {},
    additionalProperties: true,
  };
}

function dedupeDeferredChatFunctionTools(tools: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const deduped: JsonRecord[] = [];
  for (const tool of tools) {
    const name = normalizeString(tool.function?.name);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    deduped.push(tool);
  }
  return deduped;
}

function isValidDeferredChatFunctionName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(value);
}

export function requestUsesExecutableAdapterHostedTool(
  request: JsonRecord,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
): boolean {
  if (!hostedTools.some((tool) => isAdapterHostedToolType(tool.name) && tool.mode === 'adapter-emulated')) {
    return false;
  }
  if (normalizeArray(request?.tools).some((tool) => isExecutableAdapterHostedRequestTool(tool, hostedTools))) {
    return true;
  }
  const toolChoice = request?.tool_choice;
  if (typeof toolChoice === 'string') {
    return hostedTools.some((tool) => normalizeAdapterHostedToolType(toolChoice) === tool.name);
  }
  if (toolChoice && typeof toolChoice === 'object') {
    const record = toolChoice as JsonRecord;
    if (hostedTools.some((tool) => normalizeAdapterHostedToolType(record.type) === tool.name)) {
      return true;
    }
    if (normalizeString(record.type) === 'allowed_tools') {
      return normalizeArray(record.tools).some((tool) => isExecutableAdapterHostedRequestTool(tool, hostedTools));
    }
  }
  return false;
}

function isExecutableAdapterHostedRequestTool(
  tool: unknown,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
): boolean {
  const normalizedType = normalizeAdapterHostedToolType((tool as JsonRecord | null | undefined)?.type);
  return Boolean(normalizedType && hostedTools.some((hostedTool) => hostedTool.name === normalizedType));
}

export function parseToolCallArguments(rawArguments: string): JsonRecord {
  const normalized = normalizeString(rawArguments);
  if (!normalized) {
    return {};
  }
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { value: parsed };
  } catch {
    return { input: normalized };
  }
}

export function buildHostedToolSseEvent({
  type,
  entry,
  emulatedToolName,
  callId,
  iteration,
  startedAt,
  argumentsObject,
  delta,
  durationMs,
  metadata,
  outputPreview,
  error,
}: {
  type: 'hosted_tool.started' | 'hosted_tool.delta' | 'hosted_tool.completed' | 'hosted_tool.failed';
  entry: AdapterHostedToolCall;
  emulatedToolName: string;
  callId: string;
  iteration: number;
  startedAt: number;
  argumentsObject?: JsonRecord | null;
  delta?: unknown;
  durationMs?: number | null;
  metadata?: JsonRecord | null;
  outputPreview?: string | null;
  error?: JsonRecord | null;
}): JsonRecord {
  return omitUndefined({
    type,
    hosted_tool: omitUndefined({
      name: entry.declaration.name,
      emulated_tool_name: emulatedToolName,
      call_id: callId,
      iteration,
      started_at: new Date(startedAt).toISOString(),
      duration_ms: durationMs ?? undefined,
      arguments: argumentsObject ?? undefined,
      delta: delta ?? undefined,
      metadata: metadata ?? undefined,
      output_preview: outputPreview ?? undefined,
      error: error ?? undefined,
    }),
  });
}

export function hostedToolOutputPreview(content: string): string {
  const normalized = normalizeString(content);
  if (normalized.length <= 500) {
    return normalized;
  }
  return `${normalized.slice(0, 500)}...`;
}

function isAdapterHostedToolType(type: unknown): boolean {
  return isCodexProviderAdapterEmulatedBuiltinToolType(type);
}

function normalizeAdapterHostedToolType(type: unknown): string {
  return normalizeCodexProviderBuiltinToolName(type) ?? normalizeString(type);
}

export function isAdapterHostedBuiltinChatTool(
  tool: unknown,
  hostedTools: NormalizedCodexProviderHostedToolDeclaration[],
): boolean {
  if (!tool || typeof tool !== 'object') {
    return false;
  }
  const record = tool as JsonRecord;
  if (normalizeString(record.type) !== 'function') {
    return false;
  }
  const functionName = normalizeString(record.function?.name);
  return Boolean(functionName && hostedTools.some((hostedTool) => (
    isAdapterHostedToolType(hostedTool.name)
    && hostedTool.mode === 'adapter-emulated'
    && normalizeString(hostedTool.emulatedToolName || hostedTool.name) === functionName
  )));
}
