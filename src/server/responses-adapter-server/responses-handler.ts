import { type ServerResponse } from 'node:http';
import {
  chatCompletionsResponseToResponses,
  responsesRequestToChatCompletions,
} from '../../converters/responses-adapter/index.js';
import {
  resolveOpenAICompatibleProviderCapabilitiesForModel,
  type OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import type {
  NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import type {
  CodexProviderHostedToolExecutorRegistry,
} from '../../hosted_tool_executors.js';
import {
  writeJson,
} from './body.js';
import {
  buildMalformedUpstreamPayloadError,
  normalizeUpstreamError,
} from './errors.js';
import {
  requestUsesExecutableAdapterHostedTool,
} from './adapter-hosted-tools.js';
import {
  completeAdapterHostedToolLoop,
} from './adapter-hosted-tool-loop.js';
import {
  extractAdapterHostedToolRequestConfigs,
} from './adapter-hosted-tool-config.js';
import {
  writeAdapterHostedToolStreamingResponse,
} from './adapter-hosted-tool-streaming-loop.js';
import {
  handleCompactResponses,
} from './compact-responses.js';
import {
  handleDirectResponsesProxy,
} from './direct-responses-proxy.js';
import {
  resolveModelMetadata,
} from './models.js';
import {
  appendHostedToolResultsToResponsesOutput,
} from './hosted-tool-output.js';
import type {
  CodexProviderWebSearchCitationSummary,
} from '../../web-search/openai/annotations.js';
import {
  buildChatCompletionsUrl,
} from './urls.js';
import {
  shouldRetryWithoutForcedToolChoice,
} from './retry.js';
import {
  summarizeRequestAdjustments,
} from './request-adjustments.js';
import {
  validateWebSearchRequestParameters,
} from './web-search-parameters.js';
import {
  normalizeString,
} from './utils.js';
import type {
  AdapterHostedToolExecutionRecord,
  AdapterRoute,
  CodexProviderTraceEvent,
  JsonRecord,
} from './types.js';

type AdapterModelEntry = {
  id: string;
  slug: string;
  object: string;
  created: number;
  owned_by: string;
};

type UpstreamFetchResult = {
  response: Response;
  errorText: string | null;
};

export type ResponsesAdapterRequestHandlerContext = {
  requestBody: JsonRecord;
  response: ServerResponse;
  compact: boolean;
  apiKey: string;
  upstreamBaseUrl: string;
  defaultModel: string;
  models: AdapterModelEntry[];
  providerKind: string;
  providerName: string;
  providerCapabilities: OpenAICompatibleProviderCapabilities | null;
  upstreamResponsesPath: string | null;
  upstreamChatCompletionsPath: string;
  executableHostedTools: NormalizedCodexProviderHostedToolDeclaration[];
  hostedToolExecutorRegistry: CodexProviderHostedToolExecutorRegistry;
  maxHostedToolIterations: number;
  emitHostedToolSseEvents: boolean;
  exposeHostedToolResultsInResponsesOutput: boolean;
  exposeWebSearchDetailedActions: boolean;
  webSearchInvalidParameterStrategy: 'error' | 'drop';
  fetchUpstreamWithRetry: (
    url: string,
    init: RequestInit,
    route: AdapterRoute,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
  ) => Promise<UpstreamFetchResult>;
  writeStreamingResponse: (
    requestBody: JsonRecord,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
    upstream: Response,
    response: ServerResponse,
  ) => Promise<void>;
  writeStreamingDataLinesResponse: (
    requestBody: JsonRecord,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
    dataLines: AsyncIterable<string>,
    response: ServerResponse,
  ) => Promise<void>;
  writeStreamingDataLinesResponseWithHostedToolResults: (
    requestBody: JsonRecord,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
    dataLines: AsyncIterable<string>,
    executions: AdapterHostedToolExecutionRecord[],
    response: ServerResponse,
  ) => Promise<void>;
  writeSyntheticStreamingResponse: (
    adaptedResponse: JsonRecord,
    response: ServerResponse,
  ) => Promise<void>;
  emitTrace: (event: CodexProviderTraceEvent) => void;
};

export async function handleResponsesAdapterRequest({
  requestBody,
  response,
  compact,
  apiKey,
  upstreamBaseUrl,
  defaultModel,
  models,
  providerKind,
  providerName,
  providerCapabilities,
  upstreamResponsesPath,
  upstreamChatCompletionsPath,
  executableHostedTools,
  hostedToolExecutorRegistry,
  maxHostedToolIterations,
  emitHostedToolSseEvents,
  exposeHostedToolResultsInResponsesOutput,
  exposeWebSearchDetailedActions,
  webSearchInvalidParameterStrategy,
  fetchUpstreamWithRetry,
  writeStreamingResponse,
  writeStreamingDataLinesResponse,
  writeStreamingDataLinesResponseWithHostedToolResults,
  writeSyntheticStreamingResponse,
  emitTrace,
}: ResponsesAdapterRequestHandlerContext): Promise<void> {
  const route: AdapterRoute = compact ? 'responses.compact' : 'responses';
  const requestedModel = normalizeString(requestBody?.model) || defaultModel;
  const effectiveCapabilities = resolveOpenAICompatibleProviderCapabilitiesForModel(
    providerCapabilities,
    requestedModel,
  );
  const stream = Boolean(requestBody?.stream);
  emitTrace({
    type: 'request.received',
    route,
    model: requestedModel,
    stream,
    request: requestBody,
  });
  const validatedRequest = validateWebSearchRequestParameters(
    requestBody,
    webSearchInvalidParameterStrategy,
  );
  if (validatedRequest.error) {
    writeJson(response, 400, { error: validatedRequest.error });
    return;
  }
  const effectiveRequestBody = validatedRequest.requestBody;
  if (compact) {
    await handleCompactResponses({
      requestBody: effectiveRequestBody,
      response,
      providerCapabilities: effectiveCapabilities,
      upstreamBaseUrl,
      apiKey,
      providerName,
      models,
      defaultModel,
      fetchUpstreamWithRetry,
      emitTrace,
    });
    return;
  }
  if (upstreamResponsesPath) {
    await handleDirectResponsesProxy({
      requestBody: effectiveRequestBody,
      response,
      requestedModel,
      stream,
      route,
      providerCapabilities: effectiveCapabilities,
      upstreamBaseUrl,
      upstreamResponsesPath,
      apiKey,
      providerName,
      fetchUpstreamWithRetry,
      emitTrace,
    });
    return;
  }
  const adapterHostedToolExecutionRequired = requestUsesExecutableAdapterHostedTool(
    effectiveRequestBody,
    executableHostedTools,
  );
  const adapterHostedToolRequestConfigs = extractAdapterHostedToolRequestConfigs(
    effectiveRequestBody,
    executableHostedTools,
  );
  const upstreamStream = stream;
  const chatBody = responsesRequestToChatCompletions(effectiveRequestBody, {
    model: requestedModel,
    stream: upstreamStream,
    providerKind,
    providerCapabilities: effectiveCapabilities,
    hostedTools: executableHostedTools,
  });
  emitTrace({
    type: 'request.translated',
    route: 'responses',
    model: requestedModel,
    stream,
    request: effectiveRequestBody,
    upstreamRequest: chatBody,
  });
  const adjustments = [
    ...validatedRequest.adjustments,
    ...summarizeRequestAdjustments({
      request: effectiveRequestBody,
      upstreamRequest: chatBody,
      providerCapabilities: effectiveCapabilities,
      hostedTools: executableHostedTools,
    }),
  ];
  if (adjustments.length > 0) {
    emitTrace({
      type: 'request.adjusted',
      route: 'responses',
      model: requestedModel,
      stream,
      adjustments,
    });
  }
  if (upstreamStream) {
    chatBody.stream_options = {
      ...(chatBody.stream_options && typeof chatBody.stream_options === 'object' ? chatBody.stream_options : {}),
      include_usage: true,
    };
  }
  const upstreamUrl = buildChatCompletionsUrl(upstreamBaseUrl, upstreamChatCompletionsPath);
  const buildUpstreamInit = (body: JsonRecord): RequestInit => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: body?.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (stream && adapterHostedToolExecutionRequired) {
    await writeAdapterHostedToolStreamingResponse({
      requestBody: effectiveRequestBody,
      chatBody,
      upstreamUrl,
      buildUpstreamInit,
      providerCapabilities: effectiveCapabilities,
      requestedModel,
      response,
      executableHostedTools,
      hostedToolExecutorRegistry,
      maxHostedToolIterations,
      emitHostedToolSseEvents,
      providerKind,
      providerName,
      requestConfigs: adapterHostedToolRequestConfigs,
      fetchUpstreamWithRetry,
      writeStreamingDataLinesResponse,
      writeStreamingDataLinesResponseWithHostedToolResults,
      emitTrace,
    });
    return;
  }
  let upstream = await fetchUpstreamWithRetry(
    upstreamUrl,
    buildUpstreamInit(chatBody),
    'responses',
    effectiveCapabilities,
  );
  if (shouldRetryWithoutForcedToolChoice(chatBody, upstream)) {
    const downgradedChatBody = {
      ...chatBody,
    };
    const before = downgradedChatBody.tool_choice;
    delete downgradedChatBody.tool_choice;
    emitTrace({
      type: 'request.adjusted',
      route: 'responses',
      model: requestedModel,
      stream,
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
      buildUpstreamInit(downgradedChatBody),
      'responses',
      effectiveCapabilities,
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
  if (upstreamStream) {
    await writeStreamingResponse(effectiveRequestBody, effectiveCapabilities, upstream.response, response);
    return;
  }
  let json = await upstream.response.json() as JsonRecord;
  if (!json || typeof json !== 'object') {
    const error = buildMalformedUpstreamPayloadError(
      providerName,
      'non_object_json_response',
    );
    emitTrace({
      type: 'upstream.error',
      route: 'responses',
      status: 502,
      error,
    });
    writeJson(response, 502, { error });
    return;
  }
  const hostedToolLoop = await completeAdapterHostedToolLoop({
    chatBody,
    initialJson: json,
    upstreamUrl,
    buildUpstreamInit,
    providerCapabilities: effectiveCapabilities,
    requestedModel,
    executableHostedTools,
    hostedToolExecutorRegistry,
    maxHostedToolIterations,
    providerKind,
    providerName,
    requestConfigs: adapterHostedToolRequestConfigs,
    fetchUpstreamWithRetry,
    emitTrace,
  });
  if (hostedToolLoop.error) {
    emitTrace({
      type: 'upstream.error',
      route: 'responses',
      status: hostedToolLoop.status,
      error: hostedToolLoop.error,
    });
    writeJson(response, hostedToolLoop.status, { error: hostedToolLoop.error });
    return;
  }
  json = hostedToolLoop.json;
  try {
    const modelMetadata = resolveModelMetadata(
      models,
      normalizeString(effectiveRequestBody?.model) || normalizeString(json?.model) || defaultModel,
    );
    const adaptedResponse = chatCompletionsResponseToResponses(json, {
      request: effectiveRequestBody,
      providerCapabilities: effectiveCapabilities,
      modelMetadata,
    });
    const hostedToolOutput = appendHostedToolResultsToResponsesOutput({
      response: adaptedResponse,
      request: effectiveRequestBody,
      executions: hostedToolLoop.executions,
      exposeByDefault: exposeHostedToolResultsInResponsesOutput,
      exposeWebSearchDetailedActions,
    });
    emitWebSearchCitationSummaryTrace(hostedToolOutput.webSearchCitationSummary, false, emitTrace);
    emitTrace({
      type: 'response.translated',
      route: 'responses',
      model: requestedModel,
      stream: false,
      response: adaptedResponse,
    });
    if (stream && adapterHostedToolExecutionRequired) {
      await writeSyntheticStreamingResponse(adaptedResponse, response);
      return;
    }
    writeJson(response, 200, adaptedResponse);
  } catch (error) {
    const malformedError = buildMalformedUpstreamPayloadError(
      providerName,
      error instanceof Error ? error.message : String(error),
    );
    emitTrace({
      type: 'upstream.error',
      route: 'responses',
      status: 502,
      error: malformedError,
    });
    writeJson(response, 502, { error: malformedError });
  }
}

function emitWebSearchCitationSummaryTrace(
  summary: CodexProviderWebSearchCitationSummary | null,
  stream: boolean,
  emitTrace: (event: CodexProviderTraceEvent) => void,
): void {
  if (!summary) {
    return;
  }
  emitTrace({
    type: 'web_search.citations',
    route: 'responses',
    stream,
    ...summary,
  });
}
