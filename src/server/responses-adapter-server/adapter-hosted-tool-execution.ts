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
}: {
  entry: AdapterHostedToolCall;
  iteration: number;
  requestedModel: string;
  hostedToolExecutorRegistry: CodexProviderHostedToolExecutorRegistry;
  providerKind: string;
  providerName: string;
  emitTrace: EmitTrace;
  emitSseEvent?: ((event: JsonRecord) => void) | null;
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
