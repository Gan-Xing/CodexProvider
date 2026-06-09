import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import {
  chatCompletionsResponseToResponses,
  responsesRequestToCompactionResponse,
  responsesRequestToChatCompletions,
  translateChatCompletionsSseStreamToResponsesSse,
} from '../../converters/responses_adapter.js';
import {
  resolveOpenAICompatibleProviderCapabilitiesForModel,
  type OpenAICompatibleProviderCapabilities,
} from '../../capabilities/thinking_policy.js';
import {
  normalizeCodexProviderHostedTools,
  type NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import {
  createCodexProviderHostedToolExecutorRegistry,
  formatCodexProviderHostedToolExecutionResult,
  type CodexProviderHostedToolExecutorRegistry,
} from '../../hosted_tool_executors.js';
import {
  readJsonBody,
  writeJson,
} from './body.js';
import {
  buildMalformedUpstreamPayloadError,
  normalizeUpstreamError,
} from './errors.js';
import {
  appendDeferredToolsFromToolSearch,
  buildAssistantToolCallMessage,
  buildHostedToolSseEvent,
  collectAdapterHostedToolCalls,
  groupAdapterHostedToolCallsByMessage,
  hostedToolOutputPreview,
  inspectAdapterHostedStreamingTurn,
  parseToolCallArguments,
  requestUsesExecutableAdapterHostedTool,
  type AdapterHostedToolCall,
} from './adapter-hosted-tools.js';
import {
  buildModelsResponseMetadata,
  normalizeModels,
  resolveModelMetadata,
} from './models.js';
import {
  appendHostedToolResultsToResponsesOutput,
} from './hosted-tool-output.js';
import {
  buildChatCompletionsUrl,
  buildOpenAICompatibleChatCompletionsUrl,
  buildOpenAICompatibleModelsUrl,
  isModelsPath,
  isOpenAICompatibleChatCompletionsProxyPath,
  isOpenAICompatibleModelsProxyPath,
  isOpenAICompatibleResponsesProxyPath,
  isResponsesCompactPath,
  isResponsesPath,
} from './urls.js';
import {
  reserveLocalPort,
} from './ports.js';
import {
  normalizeRetryCapabilities,
  resolveRetryDelayMs,
  shouldRetryWithoutForcedToolChoice,
  sleep,
} from './retry.js';
import {
  summarizeRequestAdjustments,
} from './request-adjustments.js';
import {
  buildAppendedOutputItemSseEvents,
  ensureSseResponseHeaders,
  formatResponsesSseEvent,
  parseResponsesSseEventFrame,
  resequenceInsertedStreamEvents,
  responsesObjectToSyntheticSseEvents,
} from './synthetic-sse.js';
import {
  chainSseDataLines,
  readSseDataLines,
} from './streaming.js';
import {
  cloneJson,
  normalizePath,
  normalizePositiveInteger,
  normalizeString,
} from './utils.js';
import type {
  AdapterHostedToolExecutionRecord,
  AdapterRoute,
  CodexProviderTraceEvent,
  CodexProviderTraceSink,
  JsonRecord,
  OpenAICompatibleResponsesAdapterServerOptions,
} from './types.js';
export {
  buildOpenAICompatibleChatCompletionsUrl,
  buildOpenAICompatibleModelsUrl,
  isOpenAICompatibleChatCompletionsProxyPath,
  isOpenAICompatibleModelsProxyPath,
  isOpenAICompatibleResponsesProxyPath,
  reserveLocalPort,
};
export type {
  CodexProviderTraceEvent,
  CodexProviderTraceSink,
  OpenAICompatibleResponsesAdapterServerOptions,
} from './types.js';

const DEFAULT_UPSTREAM_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-5.4';

export class OpenAICompatibleResponsesAdapterServer {
  private readonly apiKey: string;

  private readonly upstreamBaseUrl: string;

  private readonly defaultModel: string;

  private readonly models: Array<{ id: string; slug: string; object: string; created: number; owned_by: string }>;

  private readonly fetchImpl: typeof fetch;

  private readonly host: string;

  private readonly requestedPort: number;

  private readonly providerKind: string;

  private readonly providerName: string;

  private readonly providerCapabilities: OpenAICompatibleProviderCapabilities | null;

  private readonly upstreamResponsesPath: string | null;

  private readonly upstreamChatCompletionsPath: string;

  private readonly ownedBy: string;

  private readonly traceSink: CodexProviderTraceSink | null;

  private readonly hostedTools: NormalizedCodexProviderHostedToolDeclaration[];

  private readonly executableHostedTools: NormalizedCodexProviderHostedToolDeclaration[];

  private readonly hostedToolExecutorRegistry: CodexProviderHostedToolExecutorRegistry;

  private readonly maxHostedToolIterations: number;

  private readonly emitHostedToolSseEvents: boolean;

  private readonly exposeHostedToolResultsInResponsesOutput: boolean;

  private server: http.Server | null;

  private startedUrl: string | null;

  constructor({
    apiKey,
    upstreamBaseUrl = DEFAULT_UPSTREAM_BASE_URL,
    defaultModel = DEFAULT_MODEL,
    models = [],
    fetchImpl = fetch,
    host = '127.0.0.1',
    port = 0,
    providerKind = 'openai-compatible',
    providerName = 'OpenAI Compatible',
    providerCapabilities = null,
    upstreamResponsesPath = null,
    upstreamChatCompletionsPath = '/chat/completions',
    ownedBy = 'openai-compatible',
    traceSink = null,
    hostedTools = null,
    hostedToolExecutors = null,
    maxHostedToolIterations = null,
    emitHostedToolSseEvents = false,
    exposeHostedToolResultsInResponsesOutput = false,
  }: OpenAICompatibleResponsesAdapterServerOptions) {
    const normalizedKey = normalizeString(apiKey);
    if (!normalizedKey) {
      throw new Error(`${normalizeString(providerName) || 'OpenAI-compatible'} adapter requires an API key.`);
    }
    this.apiKey = normalizedKey;
    this.upstreamBaseUrl = normalizeString(upstreamBaseUrl) || DEFAULT_UPSTREAM_BASE_URL;
    this.defaultModel = normalizeString(defaultModel) || DEFAULT_MODEL;
    this.providerKind = normalizeString(providerKind) || 'openai-compatible';
    this.providerName = normalizeString(providerName) || 'OpenAI Compatible';
    this.providerCapabilities = providerCapabilities && typeof providerCapabilities === 'object'
      ? JSON.parse(JSON.stringify(providerCapabilities))
      : null;
    this.upstreamResponsesPath = normalizePath(upstreamResponsesPath)
      || normalizePath(this.providerCapabilities?.upstreamResponsesPath)
      || null;
    this.upstreamChatCompletionsPath = normalizePath(upstreamChatCompletionsPath) || '/chat/completions';
    this.ownedBy = normalizeString(ownedBy) || this.providerKind;
    this.traceSink = typeof traceSink === 'function' ? traceSink : null;
    this.hostedTools = normalizeCodexProviderHostedTools(hostedTools);
    this.hostedToolExecutorRegistry = createCodexProviderHostedToolExecutorRegistry(hostedToolExecutors);
    this.executableHostedTools = this.hostedTools.filter((tool) => (
      tool.mode !== 'adapter-emulated'
      || this.hostedToolExecutorRegistry.has(tool.name)
    ));
    this.maxHostedToolIterations = normalizePositiveInteger(maxHostedToolIterations) ?? 4;
    this.emitHostedToolSseEvents = Boolean(emitHostedToolSseEvents);
    this.exposeHostedToolResultsInResponsesOutput = Boolean(exposeHostedToolResultsInResponsesOutput);
    this.models = normalizeModels(
      models,
      this.defaultModel,
      this.ownedBy,
      this.providerKind,
      this.providerCapabilities,
    );
    this.fetchImpl = fetchImpl;
    this.host = host;
    this.requestedPort = port;
    this.server = null;
    this.startedUrl = null;
  }

  get baseUrl(): string {
    if (!this.startedUrl) {
      throw new Error(`${this.providerName} adapter server has not been started.`);
    }
    return this.startedUrl;
  }

  async start(): Promise<void> {
    if (this.server && this.startedUrl) {
      return;
    }
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        writeJson(response, 500, {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: 'adapter_error',
          },
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        const address = this.server?.address();
        const port = typeof address === 'object' && address ? address.port : this.requestedPort;
        this.startedUrl = `http://${this.host}:${port}`;
        resolve();
      };
      this.server?.once('error', onError);
      this.server?.once('listening', onListening);
      this.server?.listen(this.requestedPort, this.host);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.startedUrl = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }).catch(() => {});
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && isModelsPath(url.pathname)) {
      writeJson(response, 200, {
        object: 'list',
        data: this.models,
        models: this.models,
        meta: buildModelsResponseMetadata({
          defaultModel: this.defaultModel,
          ownedBy: this.ownedBy,
          providerKind: this.providerKind,
          providerName: this.providerName,
          providerCapabilities: this.providerCapabilities,
          upstreamChatCompletionsPath: this.upstreamChatCompletionsPath,
        }),
      });
      return;
    }
    if (request.method === 'POST' && isResponsesPath(url.pathname)) {
      const body = await readJsonBody(request);
      await this.handleResponses(body, response, {
        compact: isResponsesCompactPath(url.pathname),
      });
      return;
    }
    writeJson(response, 404, {
      error: {
        message: `Unsupported ${this.providerName} adapter route: ${request.method} ${url.pathname}`,
        type: 'not_found',
      },
    });
  }

  private async handleResponses(
    requestBody: JsonRecord,
    response: ServerResponse,
    { compact = false }: { compact?: boolean } = {},
  ): Promise<void> {
    const route: AdapterRoute = compact ? 'responses.compact' : 'responses';
    const requestedModel = normalizeString(requestBody?.model) || this.defaultModel;
    const effectiveCapabilities = resolveOpenAICompatibleProviderCapabilitiesForModel(
      this.providerCapabilities,
      requestedModel,
    );
    const stream = Boolean(requestBody?.stream);
    this.emitTrace({
      type: 'request.received',
      route,
      model: requestedModel,
      stream,
      request: requestBody,
    });
    if (compact) {
      await this.handleCompactResponses(requestBody, response, effectiveCapabilities);
      return;
    }
    if (this.upstreamResponsesPath) {
      await this.handleDirectResponsesProxy(
        requestBody,
        response,
        requestedModel,
        stream,
        route,
        effectiveCapabilities,
      );
      return;
    }
    const adapterHostedToolExecutionRequired = requestUsesExecutableAdapterHostedTool(
      requestBody,
      this.executableHostedTools,
    );
    const upstreamStream = stream;
    const chatBody = responsesRequestToChatCompletions(requestBody, {
      model: requestedModel,
      stream: upstreamStream,
      providerKind: this.providerKind,
      providerCapabilities: effectiveCapabilities,
      hostedTools: this.executableHostedTools,
    });
    this.emitTrace({
      type: 'request.translated',
      route: 'responses',
      model: requestedModel,
      stream,
      request: requestBody,
      upstreamRequest: chatBody,
    });
    const adjustments = summarizeRequestAdjustments({
      request: requestBody,
      upstreamRequest: chatBody,
      providerCapabilities: effectiveCapabilities,
      hostedTools: this.executableHostedTools,
    });
    if (adjustments.length > 0) {
      this.emitTrace({
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
    const upstreamUrl = buildChatCompletionsUrl(this.upstreamBaseUrl, this.upstreamChatCompletionsPath);
    const buildUpstreamInit = (body: JsonRecord): RequestInit => ({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: body?.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (stream && adapterHostedToolExecutionRequired) {
      await this.writeAdapterHostedToolStreamingResponse({
        requestBody,
        chatBody,
        upstreamUrl,
        buildUpstreamInit,
        providerCapabilities: effectiveCapabilities,
        requestedModel,
        response,
      });
      return;
    }
    let upstream = await this.fetchUpstreamWithRetry(
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
      this.emitTrace({
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
      this.emitTrace({
        type: 'upstream.retry',
        route: 'responses',
        attempt: 1,
        nextAttempt: 2,
        status: upstream.response.status || null,
        reason: 'status',
        delayMs: 0,
      });
      upstream = await this.fetchUpstreamWithRetry(
        upstreamUrl,
        buildUpstreamInit(downgradedChatBody),
        'responses',
        effectiveCapabilities,
      );
    }
    if (!upstream.response.ok) {
      const error = normalizeUpstreamError(
        upstream.errorText ?? '',
        this.providerName,
        upstream.response.status,
        upstream.response.headers,
      );
      this.emitTrace({
        type: 'upstream.error',
        route: 'responses',
        status: upstream.response.status || 502,
        error,
      });
      writeJson(response, upstream.response.status || 502, { error });
      return;
    }
    if (upstreamStream) {
      await this.writeStreamingResponse(requestBody, effectiveCapabilities, upstream.response, response);
      return;
    }
    let json = await upstream.response.json() as JsonRecord;
    if (!json || typeof json !== 'object') {
      const error = buildMalformedUpstreamPayloadError(
        this.providerName,
        'non_object_json_response',
      );
      this.emitTrace({
        type: 'upstream.error',
        route: 'responses',
        status: 502,
        error,
      });
      writeJson(response, 502, { error });
      return;
    }
    const hostedToolLoop = await this.completeAdapterHostedToolLoop({
      requestBody,
      chatBody,
      initialJson: json,
      upstreamUrl,
      buildUpstreamInit,
      providerCapabilities: effectiveCapabilities,
      requestedModel,
    });
    if (hostedToolLoop.error) {
      this.emitTrace({
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
        this.models,
        normalizeString(requestBody?.model) || normalizeString(json?.model) || this.defaultModel,
      );
      const adaptedResponse = chatCompletionsResponseToResponses(json, {
        request: requestBody,
        providerCapabilities: effectiveCapabilities,
        modelMetadata,
      });
      appendHostedToolResultsToResponsesOutput({
        response: adaptedResponse,
        request: requestBody,
        executions: hostedToolLoop.executions,
        exposeByDefault: this.exposeHostedToolResultsInResponsesOutput,
      });
      this.emitTrace({
        type: 'response.translated',
        route: 'responses',
        model: requestedModel,
        stream: false,
        response: adaptedResponse,
      });
      if (stream && adapterHostedToolExecutionRequired) {
        await this.writeSyntheticStreamingResponse(adaptedResponse, response);
        return;
      }
      writeJson(response, 200, adaptedResponse);
    } catch (error) {
      const malformedError = buildMalformedUpstreamPayloadError(
        this.providerName,
        error instanceof Error ? error.message : String(error),
      );
      this.emitTrace({
        type: 'upstream.error',
        route: 'responses',
        status: 502,
        error: malformedError,
      });
      writeJson(response, 502, { error: malformedError });
    }
  }

  private async handleDirectResponsesProxy(
    requestBody: JsonRecord,
    response: ServerResponse,
    requestedModel: string,
    stream: boolean,
    route: AdapterRoute,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
  ): Promise<void> {
    this.emitTrace({
      type: 'request.translated',
      route: 'responses',
      model: requestedModel,
      stream,
      request: requestBody,
      upstreamRequest: requestBody,
    });
    const upstream = await this.fetchUpstreamWithRetry(
      buildChatCompletionsUrl(this.upstreamBaseUrl, this.upstreamResponsesPath),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
      route,
      providerCapabilities,
    );
    if (!upstream.response.ok) {
      const error = normalizeUpstreamError(
        upstream.errorText ?? '',
        this.providerName,
        upstream.response.status,
        upstream.response.headers,
      );
      this.emitTrace({
        type: 'upstream.error',
        route,
        status: upstream.response.status || 502,
        error,
      });
      writeJson(response, upstream.response.status || 502, { error });
      return;
    }
    if (stream) {
      await this.pipeUpstreamStream(upstream.response, response);
      return;
    }
    const text = await upstream.response.text();
    const contentType = upstream.response.headers.get('Content-Type') || 'application/json; charset=utf-8';
    try {
      const json = JSON.parse(text) as JsonRecord;
      this.emitTrace({
        type: 'response.translated',
        route: 'responses',
        model: requestedModel,
        stream: false,
        response: json,
      });
      writeJson(response, 200, json);
      return;
    } catch {
      response.writeHead(200, {
        'Content-Type': contentType,
      });
      response.end(text);
    }
  }

  private async completeAdapterHostedToolLoop({
    requestBody,
    chatBody,
    initialJson,
    upstreamUrl,
    buildUpstreamInit,
    providerCapabilities,
    requestedModel,
  }: {
    requestBody: JsonRecord;
    chatBody: JsonRecord;
    initialJson: JsonRecord;
    upstreamUrl: string;
    buildUpstreamInit: (body: JsonRecord) => RequestInit;
    providerCapabilities: OpenAICompatibleProviderCapabilities | null;
    requestedModel: string;
  }): Promise<{
    json: JsonRecord;
    status: number;
    error: JsonRecord | null;
    executions: AdapterHostedToolExecutionRecord[];
  }> {
    if (this.executableHostedTools.length === 0) {
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
    for (let iteration = 1; iteration <= this.maxHostedToolIterations; iteration += 1) {
      const executableCalls = collectAdapterHostedToolCalls(
        currentJson,
        this.executableHostedTools,
        this.hostedToolExecutorRegistry,
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
          const executionResult = await this.executeAdapterHostedToolCall(
            entry,
            iteration,
            requestedModel,
          );
          executions.push(executionResult);
          loopChatBody.messages.push({
            role: 'tool',
            tool_call_id: executionResult.callId,
            content: executionResult.content,
          });
          appendDeferredToolsFromToolSearch(loopChatBody, executionResult);
        }
      }

      const upstream = await this.fetchUpstreamWithRetry(
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
            this.providerName,
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
            this.providerName,
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
        message: `Adapter-emulated hosted tool loop exceeded ${this.maxHostedToolIterations} iterations.`,
        type: 'unsupported_feature',
        code: 'hosted_tool_loop_exceeded',
      },
      executions,
    };
  }

  private async writeAdapterHostedToolStreamingResponse({
    requestBody,
    chatBody,
    upstreamUrl,
    buildUpstreamInit,
    providerCapabilities,
    requestedModel,
    response,
  }: {
    requestBody: JsonRecord;
    chatBody: JsonRecord;
    upstreamUrl: string;
    buildUpstreamInit: (body: JsonRecord) => RequestInit;
    providerCapabilities: OpenAICompatibleProviderCapabilities | null;
    requestedModel: string;
    response: ServerResponse;
  }): Promise<void> {
    const loopChatBody = cloneJson(chatBody);
    loopChatBody.stream = true;
    loopChatBody.stream_options = {
      ...(loopChatBody.stream_options && typeof loopChatBody.stream_options === 'object' ? loopChatBody.stream_options : {}),
      include_usage: true,
    };
    const executions: AdapterHostedToolExecutionRecord[] = [];

    for (let iteration = 1; iteration <= this.maxHostedToolIterations; iteration += 1) {
      let upstream = await this.fetchUpstreamWithRetry(
        upstreamUrl,
        buildUpstreamInit(loopChatBody),
        'responses',
        providerCapabilities,
      );
      if (shouldRetryWithoutForcedToolChoice(loopChatBody, upstream)) {
        const before = loopChatBody.tool_choice;
        delete loopChatBody.tool_choice;
        this.emitTrace({
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
        this.emitTrace({
          type: 'upstream.retry',
          route: 'responses',
          attempt: 1,
          nextAttempt: 2,
          status: upstream.response.status || null,
          reason: 'status',
          delayMs: 0,
        });
        upstream = await this.fetchUpstreamWithRetry(
          upstreamUrl,
          buildUpstreamInit(loopChatBody),
          'responses',
          providerCapabilities,
        );
      }
      if (!upstream.response.ok) {
        const error = normalizeUpstreamError(
          upstream.errorText ?? '',
          this.providerName,
          upstream.response.status,
          upstream.response.headers,
        );
        this.emitTrace({
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
            message: `${this.providerName} upstream returned no stream body.`,
            type: 'upstream_error',
          },
        });
        return;
      }

      const decision = await inspectAdapterHostedStreamingTurn(
        readSseDataLines(upstream.response.body),
        this.executableHostedTools,
        this.hostedToolExecutorRegistry,
      );
      if (decision.kind === 'final_stream') {
        const dataLines = chainSseDataLines(decision.bufferedChunks, decision.remaining);
        if (executions.length > 0) {
          await this.writeStreamingDataLinesResponseWithHostedToolResults(
            requestBody,
            providerCapabilities,
            dataLines,
            executions,
            response,
          );
        } else {
          await this.writeStreamingDataLinesResponse(
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
        const executionResult = await this.executeAdapterHostedToolCall(
          entry,
          iteration,
          requestedModel,
          {
            emitSseEvent: this.emitHostedToolSseEvents
              ? (event) => {
                ensureSseResponseHeaders(response);
                response.write(formatResponsesSseEvent(event));
                this.emitTrace({
                  type: 'stream.event',
                  route: 'responses',
                  event,
                });
              }
              : null,
          },
        );
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
        message: `Adapter-emulated hosted tool streaming loop exceeded ${this.maxHostedToolIterations} iterations.`,
        type: 'unsupported_feature',
        code: 'hosted_tool_streaming_loop_exceeded',
      },
    });
  }

  private async executeAdapterHostedToolCall(
    entry: AdapterHostedToolCall,
    iteration: number,
    requestedModel: string,
    observation: {
      emitSseEvent?: ((event: JsonRecord) => void) | null;
    } = {},
  ): Promise<{
    callId: string;
    content: string;
    toolName: string;
    emulatedToolName: string;
    iteration: number;
    arguments: JsonRecord;
    resultContent: unknown;
    resultMetadata: JsonRecord | null;
  }> {
    const callId = normalizeString(entry.toolCall?.id) || `call_${iteration}`;
    const emulatedToolName = normalizeString(entry.toolCall?.function?.name)
      || normalizeString(entry.declaration.emulatedToolName)
      || entry.declaration.name;
    const rawArguments = normalizeString(entry.toolCall?.function?.arguments) || '{}';
    let content: string;
    let resultContent: unknown = null;
    let resultMetadata: JsonRecord | null = null;
    const startedAt = Date.now();
    const emitSseEvent = typeof observation.emitSseEvent === 'function'
      ? observation.emitSseEvent
      : null;
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
      const result = await this.hostedToolExecutorRegistry.execute({
        toolName: entry.declaration.name,
        emulatedToolName,
        callId,
        arguments: argumentsObject,
        rawArguments,
        model: requestedModel || null,
        providerKind: this.providerKind,
        providerName: this.providerName,
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

    this.emitTrace({
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

  private async handleCompactResponses(
    requestBody: JsonRecord,
    response: ServerResponse,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
  ): Promise<void> {
    if (Boolean(requestBody?.stream)) {
      writeJson(response, 400, {
        error: {
          message: 'Streaming not supported for compact responses',
          type: 'invalid_request_error',
        },
      });
      return;
    }
    const compactBody = { ...requestBody };
    delete compactBody.stream;

    if (!providerCapabilities?.supportsResponsesCompact) {
      const modelMetadata = resolveModelMetadata(
        this.models,
        normalizeString(compactBody?.model) || this.defaultModel,
      );
      const compactResponse = responsesRequestToCompactionResponse(compactBody, {
        request: compactBody,
        providerCapabilities,
        modelMetadata,
      });
      this.emitTrace({
        type: 'response.compaction_fallback',
        route: 'responses.compact',
        model: normalizeString(compactBody?.model) || this.defaultModel,
        reason: 'compact_not_supported',
        response: compactResponse,
      });
      writeJson(response, 200, compactResponse);
      return;
    }

    const compactPath = normalizePath(providerCapabilities.upstreamResponsesCompactPath) || '/responses/compact';
    const upstream = await this.fetchUpstreamWithRetry(
      buildChatCompletionsUrl(this.upstreamBaseUrl, compactPath),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(compactBody),
      },
      'responses.compact',
      providerCapabilities,
    );
    if (!upstream.response.ok) {
      const error = normalizeUpstreamError(
        upstream.errorText ?? '',
        this.providerName,
        upstream.response.status,
        upstream.response.headers,
      );
      this.emitTrace({
        type: 'upstream.error',
        route: 'responses.compact',
        status: upstream.response.status || 502,
        error,
      });
      writeJson(response, upstream.response.status || 502, { error });
      return;
    }
    const text = await upstream.response.text();
    response.writeHead(200, {
      'Content-Type': upstream.response.headers.get('Content-Type') || 'application/json; charset=utf-8',
    });
    response.end(text);
  }

  private async fetchUpstreamWithRetry(
    url: string,
    init: RequestInit,
    route: AdapterRoute,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
  ): Promise<{
    response: Response;
    errorText: string | null;
  }> {
    const retry = normalizeRetryCapabilities(providerCapabilities?.retry);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      let upstream: Response;
      try {
        upstream = await this.fetchImpl(url, init);
      } catch (error) {
        lastError = error;
        if (attempt < retry.maxAttempts && retry.retryNetworkErrors) {
          const delayMs = resolveRetryDelayMs(null, '', attempt, retry);
          this.emitTrace({
            type: 'upstream.retry',
            route,
            attempt,
            nextAttempt: attempt + 1,
            status: null,
            reason: 'network',
            delayMs,
          });
          await sleep(delayMs);
          continue;
        }
        throw error;
      }
      if (upstream.ok || attempt >= retry.maxAttempts || !retry.retryStatuses.has(upstream.status)) {
        return {
          response: upstream,
          errorText: upstream.ok ? null : await upstream.text().catch(() => ''),
        };
      }
      const text = await upstream.text().catch(() => '');
      const delayMs = resolveRetryDelayMs(upstream.headers, text, attempt, retry);
      this.emitTrace({
        type: 'upstream.retry',
        route,
        attempt,
        nextAttempt: attempt + 1,
        status: upstream.status,
        reason: 'status',
        delayMs,
      });
      await sleep(delayMs);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'OpenAI-compatible upstream retry failed.'));
  }

  private async pipeUpstreamStream(
    upstreamResponse: Response,
    response: ServerResponse,
  ): Promise<void> {
    response.writeHead(200, {
      'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream; charset=utf-8',
      'Cache-Control': upstreamResponse.headers.get('Cache-Control') || 'no-cache',
      Connection: upstreamResponse.headers.get('Connection') || 'keep-alive',
    });
    if (!upstreamResponse.body) {
      response.end();
      return;
    }
    const readable = Readable.fromWeb(upstreamResponse.body as any);
    for await (const chunk of readable) {
      response.write(chunk);
    }
    response.end();
  }

  private async writeStreamingResponse(
    requestBody: JsonRecord,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
    upstream: Response,
    response: ServerResponse,
  ): Promise<void> {
    if (!upstream.body) {
      writeJson(response, 502, {
        error: {
          message: `${this.providerName} upstream returned no stream body.`,
          type: 'upstream_error',
        },
      });
      return;
    }
    await this.writeStreamingDataLinesResponse(
      requestBody,
      providerCapabilities,
      readSseDataLines(upstream.body),
      response,
    );
  }

  private async writeStreamingDataLinesResponse(
    requestBody: JsonRecord,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
    dataLines: AsyncIterable<string>,
    response: ServerResponse,
  ): Promise<void> {
    ensureSseResponseHeaders(response);
    let eventCount = 0;
    for await (const event of translateChatCompletionsSseStreamToResponsesSse(
      dataLines,
      {
        request: requestBody,
        providerCapabilities,
        modelMetadata: resolveModelMetadata(
          this.models,
          normalizeString(requestBody?.model) || this.defaultModel,
        ),
        traceEvent: (traceEvent) => {
          eventCount += 1;
          this.emitTrace({
            type: 'stream.event',
            route: 'responses',
            event: traceEvent,
          });
        },
      },
    )) {
      response.write(event);
    }
    this.emitTrace({
      type: 'stream.completed',
      route: 'responses',
      eventCount,
    });
    response.end();
  }

  private async writeStreamingDataLinesResponseWithHostedToolResults(
    requestBody: JsonRecord,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
    dataLines: AsyncIterable<string>,
    executions: AdapterHostedToolExecutionRecord[],
    response: ServerResponse,
  ): Promise<void> {
    ensureSseResponseHeaders(response);
    let eventCount = 0;
    for await (const frame of translateChatCompletionsSseStreamToResponsesSse(
      dataLines,
      {
        request: requestBody,
        providerCapabilities,
        modelMetadata: resolveModelMetadata(
          this.models,
          normalizeString(requestBody?.model) || this.defaultModel,
        ),
      },
    )) {
      const event = parseResponsesSseEventFrame(frame);
      if (!event) {
        response.write(frame);
        continue;
      }
      let eventsToWrite = [event];
      if (
        (event.type === 'response.completed' || event.type === 'response.failed')
        && event.response
        && typeof event.response === 'object'
      ) {
        const previousOutputLength = Array.isArray(event.response.output)
          ? event.response.output.length
          : 0;
        appendHostedToolResultsToResponsesOutput({
          response: event.response,
          request: requestBody,
          executions,
          exposeByDefault: this.exposeHostedToolResultsInResponsesOutput,
        });
        const appendedOutputEvents = buildAppendedOutputItemSseEvents(event.response, previousOutputLength);
        resequenceInsertedStreamEvents(appendedOutputEvents, event);
        eventsToWrite = [
          ...appendedOutputEvents,
          event,
        ];
      }
      for (const eventToWrite of eventsToWrite) {
        eventCount += 1;
        this.emitTrace({
          type: 'stream.event',
          route: 'responses',
          event: eventToWrite,
        });
        response.write(formatResponsesSseEvent(eventToWrite));
      }
    }
    this.emitTrace({
      type: 'stream.completed',
      route: 'responses',
      eventCount,
    });
    response.end();
  }

  private async writeSyntheticStreamingResponse(
    adaptedResponse: JsonRecord,
    response: ServerResponse,
  ): Promise<void> {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let eventCount = 0;
    for (const event of responsesObjectToSyntheticSseEvents(adaptedResponse)) {
      eventCount += 1;
      this.emitTrace({
        type: 'stream.event',
        route: 'responses',
        event,
      });
      response.write(formatResponsesSseEvent(event));
    }
    response.write('data: [DONE]\n\n');
    this.emitTrace({
      type: 'stream.completed',
      route: 'responses',
      eventCount,
    });
    response.end();
  }

  private emitTrace(event: CodexProviderTraceEvent): void {
    if (!this.traceSink) {
      return;
    }
    try {
      this.traceSink(event);
    } catch {
      // Ignore trace sink failures so protocol serving stays unaffected.
    }
  }
}
