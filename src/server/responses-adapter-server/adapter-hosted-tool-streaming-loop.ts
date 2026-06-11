import type {
  ServerResponse,
} from 'node:http';
import type {
  OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import type {
  CodexProviderHostedToolExecutorRegistry,
} from '../../hosted_tool_executors.js';
import {
  buildAssistantToolCallMessage,
  inspectAdapterHostedStreamingTurn,
} from './adapter-hosted-tools.js';
import {
  appendDeferredToolsFromToolSearch,
} from './adapter-deferred-tools.js';
import type {
  AdapterHostedToolRequestConfigMap,
} from './adapter-hosted-tool-config.js';
import {
  executeAdapterHostedToolCall,
} from './adapter-hosted-tool-execution.js';
import {
  writeJson,
} from './body.js';
import {
  buildHostedToolLoopExceededError,
  normalizeUpstreamError,
} from './errors.js';
import {
  buildForcedToolChoiceRetryPlan,
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
  requestConfigs,
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
  requestConfigs?: AdapterHostedToolRequestConfigMap;
  fetchUpstreamWithRetry: FetchUpstreamWithRetry;
  writeStreamingDataLinesResponse: WriteStreamingDataLinesResponse;
  writeStreamingDataLinesResponseWithHostedToolResults: WriteStreamingDataLinesResponseWithHostedToolResults;
  emitTrace: EmitTrace;
}): Promise<void> {
  let loopChatBody = cloneJson(chatBody);
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
    const forcedToolChoiceRetry = buildForcedToolChoiceRetryPlan(loopChatBody, upstream, {
      providerKind,
      providerCapabilities,
    });
    if (forcedToolChoiceRetry) {
      loopChatBody = forcedToolChoiceRetry.body;
      emitTrace({
        type: 'request.adjusted',
        route: 'responses',
        model: requestedModel,
        stream: true,
        adjustments: [forcedToolChoiceRetry.adjustment],
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
      requestConfigs,
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
        stream: true,
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
    delete loopChatBody.tool_choice;
  }

  writeJson(response, 502, {
    error: buildHostedToolLoopExceededError({
      maxHostedToolIterations,
      streaming: true,
    }),
  });
}
