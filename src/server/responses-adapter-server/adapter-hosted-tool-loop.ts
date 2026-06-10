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
  collectAdapterHostedToolCalls,
  groupAdapterHostedToolCallsByMessage,
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
  buildHostedToolLoopExceededError,
  buildMalformedUpstreamPayloadError,
  normalizeUpstreamError,
} from './errors.js';
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
  requestConfigs,
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
  requestConfigs?: AdapterHostedToolRequestConfigMap;
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
      requestConfigs,
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
    error: buildHostedToolLoopExceededError({
      maxHostedToolIterations,
    }),
    executions,
  };
}
