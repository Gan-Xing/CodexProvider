import type {
  ServerResponse,
} from 'node:http';
import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import {
  formatCodexProviderHostedToolExecutionResult,
  type CodexProviderHostedToolExecutorRegistry,
} from '../../hosted_tool_executors.js';
import {
  appendDeferredToolsFromToolSearch,
  buildAssistantToolCallMessage,
  buildHostedToolSseEvent,
  collectAdapterHostedToolCalls,
  groupAdapterHostedToolCallsByMessage,
  hostedToolOutputPreview,
  inspectAdapterHostedStreamingTurn,
  parseToolCallArguments,
  type AdapterHostedToolCall,
} from './adapter-hosted-tools.js';
import {
  writeJson,
} from './body.js';
import {
  buildMalformedUpstreamPayloadError,
  normalizeUpstreamError,
} from './errors.js';
import {
  shouldRetryWithoutForcedToolChoice,
} from './retry.js';
import {
  ensureSseResponseHeaders,
  formatResponsesSseEvent,
} from './synthetic-sse.js';
import {
  chainSseDataLines,
  readSseDataLines,
} from './streaming.js';
import type {
  AdapterHostedToolExecutionRecord,
  AdapterRoute,
  CodexProviderTraceEvent,
  JsonRecord,
} from './types.js';
import {
  cloneJson,
  normalizeString,
} from './utils.js';

type UpstreamFetchResult = {
  response: Response;
  errorText: string | null;
};

type FetchUpstreamWithRetry = (
  url: string,
  init: RequestInit,
  route: AdapterRoute,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null,
) => Promise<UpstreamFetchResult>;

type EmitTrace = (event: CodexProviderTraceEvent) => void;

type WriteStreamingDataLinesResponse = (
  requestBody: JsonRecord,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null,
  dataLines: AsyncIterable<string>,
  response: ServerResponse,
) => Promise<void>;

type WriteStreamingDataLinesResponseWithHostedToolResults = (
  requestBody: JsonRecord,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null,
  dataLines: AsyncIterable<string>,
  executions: AdapterHostedToolExecutionRecord[],
  response: ServerResponse,
) => Promise<void>;

export async function completeAdapterHostedToolLoop({
  chatBody,
  initialJson,
  upstreamUrl,
  buildUpstreamInit,
  providerCapabilities,
  requestedModel,
  executableHostedTools,
  hostedToolExecutorRegistry,
  maxHostedToolIterations,
  providerKind,
  providerName,
  fetchUpstreamWithRetry,
  emitTrace,
}: {
  chatBody: JsonRecord;
  initialJson: JsonRecord;
  upstreamUrl: string;
  buildUpstreamInit: (body: JsonRecord) => RequestInit;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  requestedModel: string;
  executableHostedTools: NormalizedCodexProviderHostedToolDeclaration[];
  hostedToolExecutorRegistry: CodexProviderHostedToolExecutorRegistry;
  maxHostedToolIterations: number;
  providerKind: string;
  providerName: string;
  fetchUpstreamWithRetry: FetchUpstreamWithRetry;
  emitTrace: EmitTrace;
}): Promise<{
  json: JsonRecord;
  status: number;
  error: JsonRecord | null;
  executions: AdapterHostedToolExecutionRecord[];
}> {
  if (executableHostedTools.length === 0) {
    return {
      json: initialJson,
      status: 200,
      error: null,
      executions: [],
    };
  }

  let currentJson = initialJson;
  const executions: AdapterHostedToolExecutionRecord[] = [];
  const loopChatBody = cloneJson(chatBody);
  for (let iteration = 1; iteration <= maxHostedToolIterations; iteration += 1) {
    const executableCalls = collectAdapterHostedToolCalls(
      currentJson,
      executableHostedTools,
      hostedToolExecutorRegistry,
    );
    if (executableCalls.length === 0) {
      return {
        json: currentJson,
        status: 200,
        error: null,
        executions,
      };
    }

    for (const { message, toolCalls } of groupAdapterHostedToolCallsByMessage(executableCalls)) {
      loopChatBody.messages.push(buildAssistantToolCallMessage(message, toolCalls.map((entry) => entry.toolCall)));
      for (const entry of toolCalls) {
        const executionResult = await executeAdapterHostedToolCall({
          entry,
          iteration,
          requestedModel,
          hostedToolExecutorRegistry,
          providerKind,
          providerName,
          emitTrace,
        });
        executions.push(executionResult);
        loopChatBody.messages.push({
          role: 'tool',
          tool_call_id: executionResult.callId,
          content: executionResult.content,
        });
        appendDeferredToolsFromToolSearch(loopChatBody, executionResult);
      }
    }

    const upstream = await fetchUpstreamWithRetry(
      upstreamUrl,
      buildUpstreamInit(loopChatBody),
      'responses',
      providerCapabilities,
    );
    if (!upstream.response.ok) {
      return {
        json: currentJson,
        status: upstream.response.status || 502,
        error: normalizeUpstreamError(
          upstream.errorText ?? '',
          providerName,
          upstream.response.status,
          upstream.response.headers,
        ),
        executions,
      };
    }
    currentJson = await upstream.response.json() as JsonRecord;
    if (!currentJson || typeof currentJson !== 'object') {
      return {
        json: currentJson,
        status: 502,
        error: buildMalformedUpstreamPayloadError(
          providerName,
          'non_object_json_response_after_hosted_tool_execution',
        ),
        executions,
      };
    }
  }

  return {
    json: currentJson,
    status: 502,
    error: {
      message: `Adapter-emulated hosted tool loop exceeded ${maxHostedToolIterations} iterations.`,
      type: 'unsupported_feature',
      code: 'hosted_tool_loop_exceeded',
    },
    executions,
  };
}

export async function writeAdapterHostedToolStreamingResponse({
  requestBody,
  chatBody,
  upstreamUrl,
  buildUpstreamInit,
  providerCapabilities,
  requestedModel,
  response,
  executableHostedTools,
  hostedToolExecutorRegistry,
  maxHostedToolIterations,
  emitHostedToolSseEvents,
  providerKind,
  providerName,
  fetchUpstreamWithRetry,
  writeStreamingDataLinesResponse,
  writeStreamingDataLinesResponseWithHostedToolResults,
  emitTrace,
}: {
  requestBody: JsonRecord;
  chatBody: JsonRecord;
  upstreamUrl: string;
  buildUpstreamInit: (body: JsonRecord) => RequestInit;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  requestedModel: string;
  response: ServerResponse;
  executableHostedTools: NormalizedCodexProviderHostedToolDeclaration[];
  hostedToolExecutorRegistry: CodexProviderHostedToolExecutorRegistry;
  maxHostedToolIterations: number;
  emitHostedToolSseEvents: boolean;
  providerKind: string;
  providerName: string;
  fetchUpstreamWithRetry: FetchUpstreamWithRetry;
  writeStreamingDataLinesResponse: WriteStreamingDataLinesResponse;
  writeStreamingDataLinesResponseWithHostedToolResults: WriteStreamingDataLinesResponseWithHostedToolResults;
  emitTrace: EmitTrace;
}): Promise<void> {
  const loopChatBody = cloneJson(chatBody);
  loopChatBody.stream = true;
  loopChatBody.stream_options = {
    ...(loopChatBody.stream_options && typeof loopChatBody.stream_options === 'object' ? loopChatBody.stream_options : {}),
    include_usage: true,
  };
  const executions: AdapterHostedToolExecutionRecord[] = [];

  for (let iteration = 1; iteration <= maxHostedToolIterations; iteration += 1) {
    let upstream = await fetchUpstreamWithRetry(
      upstreamUrl,
      buildUpstreamInit(loopChatBody),
      'responses',
      providerCapabilities,
    );
    if (shouldRetryWithoutForcedToolChoice(loopChatBody, upstream)) {
      const before = loopChatBody.tool_choice;
      delete loopChatBody.tool_choice;
      emitTrace({
        type: 'request.adjusted',
        route: 'responses',
        model: requestedModel,
        stream: true,
        adjustments: [{
          kind: 'tool_choice_dropped',
          path: 'tool_choice',
          reason: 'upstream_rejected_forced_tool_choice',
          before,
        }],
      });
      emitTrace({
        type: 'upstream.retry',
        route: 'responses',
        attempt: 1,
        nextAttempt: 2,
        status: upstream.response.status || null,
        reason: 'status',
        delayMs: 0,
      });
      upstream = await fetchUpstreamWithRetry(
        upstreamUrl,
        buildUpstreamInit(loopChatBody),
        'responses',
        providerCapabilities,
      );
    }
    if (!upstream.response.ok) {
      const error = normalizeUpstreamError(
        upstream.errorText ?? '',
        providerName,
        upstream.response.status,
        upstream.response.headers,
      );
      emitTrace({
        type: 'upstream.error',
        route: 'responses',
        status: upstream.response.status || 502,
        error,
      });
      writeJson(response, upstream.response.status || 502, { error });
      return;
    }
    if (!upstream.response.body) {
      writeJson(response, 502, {
        error: {
          message: `${providerName} upstream returned no stream body.`,
          type: 'upstream_error',
        },
      });
      return;
    }

    const decision = await inspectAdapterHostedStreamingTurn(
      readSseDataLines(upstream.response.body),
      executableHostedTools,
      hostedToolExecutorRegistry,
    );
    if (decision.kind === 'final_stream') {
      const dataLines = chainSseDataLines(decision.bufferedChunks, decision.remaining);
      if (executions.length > 0) {
        await writeStreamingDataLinesResponseWithHostedToolResults(
          requestBody,
          providerCapabilities,
          dataLines,
          executions,
          response,
        );
      } else {
        await writeStreamingDataLinesResponse(
          requestBody,
          providerCapabilities,
          dataLines,
          response,
        );
      }
      return;
    }
    if (decision.kind === 'error') {
      writeJson(response, 502, {
        error: {
          message: decision.message,
          type: 'unsupported_feature',
          code: 'adapter_hosted_streaming_tool_mix_unsupported',
        },
      });
      return;
    }

    loopChatBody.messages.push(buildAssistantToolCallMessage({
      content: '',
    }, decision.calls.map((entry) => entry.toolCall)));
    for (const entry of decision.calls) {
      const executionResult = await executeAdapterHostedToolCall({
        entry,
        iteration,
        requestedModel,
        hostedToolExecutorRegistry,
        providerKind,
        providerName,
        emitTrace,
        emitSseEvent: emitHostedToolSseEvents
          ? (event) => {
            ensureSseResponseHeaders(response);
            response.write(formatResponsesSseEvent(event));
            emitTrace({
              type: 'stream.event',
              route: 'responses',
              event,
            });
          }
          : null,
      });
      executions.push(executionResult);
      loopChatBody.messages.push({
        role: 'tool',
        tool_call_id: executionResult.callId,
        content: executionResult.content,
      });
      appendDeferredToolsFromToolSearch(loopChatBody, executionResult);
    }
  }

  writeJson(response, 502, {
    error: {
      message: `Adapter-emulated hosted tool streaming loop exceeded ${maxHostedToolIterations} iterations.`,
      type: 'unsupported_feature',
      code: 'hosted_tool_streaming_loop_exceeded',
    },
  });
}

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
  let content: string;
  let resultContent: unknown = null;
  let resultMetadata: JsonRecord | null = null;
  const startedAt = Date.now();
  emitSseEvent?.(buildHostedToolSseEvent({
    type: 'hosted_tool.started',
    entry,
    emulatedToolName,
    callId,
    iteration,
    startedAt,
    argumentsObject: parseToolCallArguments(rawArguments),
  }));
  const argumentsObject = parseToolCallArguments(rawArguments);
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
