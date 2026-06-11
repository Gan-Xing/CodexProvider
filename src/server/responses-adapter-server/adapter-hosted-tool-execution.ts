import {
  formatCodexProviderHostedToolExecutionResult,
  type CodexProviderHostedToolExecutorRegistry,
} from '../../hosted_tool_executors.js';
import {
  buildHostedToolSseEvent,
  hostedToolOutputPreview,
  parseToolCallArguments,
  type AdapterHostedToolCall,
} from './adapter-hosted-tools.js';
import {
  mergeAdapterHostedToolArguments,
  summarizeAdapterHostedToolConfigBinding,
} from './adapter-hosted-tool-config.js';
import type {
  AdapterHostedToolExecutionRecord,
  CodexProviderTraceEvent,
  JsonRecord,
} from './types.js';
import {
  normalizeString,
} from './utils.js';

type EmitTrace = (event: CodexProviderTraceEvent) => void;

export async function executeAdapterHostedToolCall({
  entry,
  iteration,
  requestedModel,
  hostedToolExecutorRegistry,
  providerKind,
  providerName,
  emitTrace,
  emitSseEvent = null,
  stream = false,
}: {
  entry: AdapterHostedToolCall;
  iteration: number;
  requestedModel: string;
  hostedToolExecutorRegistry: CodexProviderHostedToolExecutorRegistry;
  providerKind: string;
  providerName: string;
  emitTrace: EmitTrace;
  emitSseEvent?: ((event: JsonRecord) => void) | null;
  stream?: boolean;
}): Promise<AdapterHostedToolExecutionRecord> {
  const callId = normalizeString(entry.toolCall?.id) || `call_${iteration}`;
  const emulatedToolName = normalizeString(entry.toolCall?.function?.name)
    || normalizeString(entry.declaration.emulatedToolName)
    || entry.declaration.name;
  const rawArguments = normalizeString(entry.toolCall?.function?.arguments) || '{}';
  const modelArgumentsObject = parseToolCallArguments(rawArguments);
  const argumentsObject = mergeAdapterHostedToolArguments(
    entry.declaration.name,
    modelArgumentsObject,
    entry.requestConfig?.config ?? null,
  );
  let content: string;
  let resultContent: unknown = null;
  let resultMetadata: JsonRecord | null = null;
  let executionStatus: 'completed' | 'failed' = 'completed';
  const startedAt = Date.now();
  emitTrace({
    type: 'hosted_tool.config_bound',
    route: 'responses',
    toolName: entry.declaration.name,
    emulatedToolName,
    callId,
    iteration,
    summary: summarizeAdapterHostedToolConfigBinding({
      toolName: entry.declaration.name,
      modelArguments: modelArgumentsObject,
      effectiveArguments: argumentsObject,
      requestConfig: entry.requestConfig ?? null,
    }),
  });
  emitSseEvent?.(buildHostedToolSseEvent({
    type: 'hosted_tool.started',
    entry,
    emulatedToolName,
    callId,
    iteration,
    startedAt,
    argumentsObject,
  }));
  try {
    const result = await hostedToolExecutorRegistry.execute({
      toolName: entry.declaration.name,
      emulatedToolName,
      callId,
      arguments: argumentsObject,
      rawArguments,
      model: requestedModel || null,
      providerKind,
      providerName,
      emitDelta: emitSseEvent
        ? async (delta, metadata = null) => {
          emitSseEvent(buildHostedToolSseEvent({
            type: 'hosted_tool.delta',
            entry,
            emulatedToolName,
            callId,
            iteration,
            startedAt,
            delta,
            metadata,
          }));
        }
        : null,
    });
    resultContent = result.content ?? null;
    resultMetadata = result.metadata ?? null;
    content = formatCodexProviderHostedToolExecutionResult(result);
    emitSseEvent?.(buildHostedToolSseEvent({
      type: 'hosted_tool.completed',
      entry,
      emulatedToolName,
      callId,
      iteration,
      startedAt,
      durationMs: Date.now() - startedAt,
      metadata: result.metadata ?? null,
      outputPreview: hostedToolOutputPreview(content),
    }));
  } catch (error) {
    executionStatus = 'failed';
    resultContent = {
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'hosted_tool_execution_error',
      },
    };
    content = JSON.stringify(resultContent);
    emitSseEvent?.(buildHostedToolSseEvent({
      type: 'hosted_tool.failed',
      entry,
      emulatedToolName,
      callId,
      iteration,
      startedAt,
      durationMs: Date.now() - startedAt,
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'hosted_tool_execution_error',
      },
    }));
  }

  const durationMs = Math.max(0, Date.now() - startedAt);
  emitWebSearchExecutionTrace({
    toolName: entry.declaration.name,
    emulatedToolName,
    callId,
    iteration,
    stream,
    executionStatus,
    durationMs,
    resultContent,
    resultMetadata,
    emitTrace,
  });
  emitTrace({
    type: 'hosted_tool.executed',
    route: 'responses',
    toolName: entry.declaration.name,
    emulatedToolName,
    callId,
    iteration,
  });
  return {
    callId,
    content,
    toolName: entry.declaration.name,
    emulatedToolName,
    iteration,
    arguments: argumentsObject,
    resultContent,
    resultMetadata,
  };
}

function emitWebSearchExecutionTrace({
  toolName,
  emulatedToolName,
  callId,
  iteration,
  stream,
  executionStatus,
  durationMs,
  resultContent,
  resultMetadata,
  emitTrace,
}: {
  toolName: string;
  emulatedToolName: string;
  callId: string;
  iteration: number;
  stream: boolean;
  executionStatus: 'completed' | 'failed';
  durationMs: number;
  resultContent: unknown;
  resultMetadata: JsonRecord | null;
  emitTrace: EmitTrace;
}): void {
  if (toolName !== 'web_search') {
    return;
  }
  const content = jsonRecordFromUnknown(resultContent);
  const metadata = jsonRecordFromUnknown(resultMetadata);
  const timings = jsonRecordFromUnknown(content?.timings);
  const documents = jsonRecordsFromArray(content?.documents);

  emitTrace({
    type: 'web_search.executed',
    route: 'responses',
    stream,
    toolName: 'web_search',
    emulatedToolName,
    callId,
    iteration,
    executionStatus,
    durationMs,
    mode: normalizeString(metadata?.mode) || null,
    resultCount: countFromMetadata(metadata, 'resultCount', content?.results),
    sourceCount: countFromMetadata(metadata, 'sourceCount', content?.sources),
    documentCount: countFromMetadata(metadata, 'documentCount', content?.documents),
    chunkCount: countFromMetadata(metadata, 'chunkCount', content?.chunks),
    retrievalErrorCount: countFromMetadata(metadata, 'retrievalErrorCount', metadata?.retrievalErrors),
    retrievalCacheHitCount: countFromMetadata(
      metadata,
      'retrievalCacheHitCount',
      documents.filter((document) => document.from_cache === true),
    ),
    retrievalCacheMissCount: countFromMetadata(
      metadata,
      'retrievalCacheMissCount',
      documents.filter((document) => document.from_cache === false),
    ),
    unresponsiveEngineCount: arrayCount(content?.unresponsive_engines),
    engineTimingCount: timings ? Object.keys(timings).filter((key) => Number.isFinite(timings[key])).length : 0,
    warningCount: arrayCount(metadata?.warnings),
    externalWebAccess: booleanFromUnknown(metadata?.externalWebAccess) ?? booleanFromUnknown(content?.external_web_access),
    searchContextSize: normalizeString(metadata?.searchContextSize) || normalizeString(content?.search_context_size) || null,
  });
}

function countFromMetadata(
  metadata: JsonRecord | null,
  key: string,
  fallbackArray: unknown,
): number {
  const value = metadata?.[key];
  if (Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  return arrayCount(fallbackArray);
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function booleanFromUnknown(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function jsonRecordFromUnknown(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function jsonRecordsFromArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const records: JsonRecord[] = [];
  for (const entry of value) {
    const record = jsonRecordFromUnknown(entry);
    if (record) {
      records.push(record);
    }
  }
  return records;
}
