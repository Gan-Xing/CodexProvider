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
  type CodexProviderHostedToolDeclaration,
  type NormalizedCodexProviderHostedToolDeclaration,
} from '../../hosted_tools.js';
import {
  createCodexProviderHostedToolExecutorRegistry,
  formatCodexProviderHostedToolExecutionResult,
  type CodexProviderHostedToolExecutorRegistry,
  type CodexProviderHostedToolExecutorRegistryInput,
} from '../../hosted_tool_executors.js';
import {
  isCodexProviderAdapterEmulatedBuiltinToolType,
  normalizeCodexProviderBuiltinToolName,
} from '../../builtin-tools/index.js';
import {
  readJsonBody,
  writeJson,
} from './body.js';
import {
  buildMalformedUpstreamPayloadError,
  extractUpstreamError,
  normalizeUpstreamError,
} from './errors.js';
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
  cloneJson,
  normalizeArray,
  normalizePath,
  normalizePositiveInteger,
  normalizeString,
  omitUndefined,
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

interface AdapterHostedToolCall {
  declaration: NormalizedCodexProviderHostedToolDeclaration;
  toolCall: JsonRecord;
  message: JsonRecord;
}

type AdapterHostedStreamingDecision =
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

interface StreamingToolCallAccumulator {
  toolCallsByKey: Map<string, JsonRecord>;
  sawToolCallDelta: boolean;
}

async function inspectAdapterHostedStreamingTurn(
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

function collectAdapterHostedToolCalls(
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

function groupAdapterHostedToolCallsByMessage(
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

function buildAssistantToolCallMessage(
  message: JsonRecord,
  toolCalls: JsonRecord[],
): JsonRecord {
  return omitUndefined({
    role: 'assistant',
    content: typeof message?.content === 'string' ? message.content : '',
    tool_calls: toolCalls.map((toolCall) => cloneJson(toolCall)),
  });
}

function appendDeferredToolsFromToolSearch(
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

function parseChatStreamData(data: string): JsonRecord | null {
  const trimmed = normalizeString(data);
  if (!trimmed || trimmed === '[DONE]') {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as JsonRecord;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function collectStreamingToolCallDeltas(
  chunk: JsonRecord,
  accumulator: StreamingToolCallAccumulator,
): void {
  for (const choice of normalizeArray(chunk?.choices)) {
    const choiceIndex = normalizeStreamIndex(choice?.index, 0);
    for (const toolCallDelta of normalizeArray(choice?.delta?.tool_calls)) {
      accumulator.sawToolCallDelta = true;
      const toolIndex = normalizeStreamIndex(toolCallDelta?.index, 0);
      const key = `${choiceIndex}:${toolIndex}`;
      const existing = accumulator.toolCallsByKey.get(key) ?? {
        id: '',
        type: 'function',
        function: {
          name: '',
          arguments: '',
        },
      };
      const id = normalizeString(toolCallDelta?.id);
      if (id) {
        existing.id = id;
      }
      const type = normalizeString(toolCallDelta?.type);
      if (type) {
        existing.type = type;
      }
      const functionName = normalizeString(toolCallDelta?.function?.name);
      if (functionName) {
        existing.function.name += functionName;
      }
      const functionArguments = typeof toolCallDelta?.function?.arguments === 'string'
        ? toolCallDelta.function.arguments
        : '';
      if (functionArguments) {
        existing.function.arguments += functionArguments;
      }
      accumulator.toolCallsByKey.set(key, existing);
    }
  }
  for (const [key, toolCall] of accumulator.toolCallsByKey.entries()) {
    if (!normalizeString(toolCall.id)) {
      toolCall.id = `call_${key.replace(/[^A-Za-z0-9_-]/gu, '_')}`;
    }
  }
}

function chatStreamChunkHasAssistantText(chunk: JsonRecord): boolean {
  for (const choice of normalizeArray(chunk?.choices)) {
    const delta = choice?.delta;
    if (typeof delta?.content === 'string' && delta.content.length > 0) {
      return true;
    }
    if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      return true;
    }
    if (typeof delta?.reasoning === 'string' && delta.reasoning.length > 0) {
      return true;
    }
  }
  return false;
}

function chatStreamChunkFinishedToolCalls(chunk: JsonRecord): boolean {
  return normalizeArray(chunk?.choices).some((choice) => normalizeString(choice?.finish_reason) === 'tool_calls');
}

function normalizeStreamIndex(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

async function* chainSseDataLines(
  bufferedChunks: string[],
  remaining: AsyncIterable<string>,
): AsyncGenerator<string> {
  for (const chunk of bufferedChunks) {
    yield chunk;
  }
  for await (const chunk of remaining) {
    yield chunk;
  }
}

function asyncIteratorToIterable<T>(iterator: AsyncIterator<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

async function drainAsyncIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return;
    }
  }
}

async function* emptyAsyncIterable<T>(): AsyncGenerator<T> {}

function requestUsesExecutableAdapterHostedTool(
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

function parseToolCallArguments(rawArguments: string): JsonRecord {
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

function buildHostedToolSseEvent({
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

function hostedToolOutputPreview(content: string): string {
  const normalized = normalizeString(content);
  if (normalized.length <= 500) {
    return normalized;
  }
  return `${normalized.slice(0, 500)}...`;
}

async function* readSseDataLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let splitIndex = findSseFrameBoundary(buffer);
      while (splitIndex >= 0) {
        const frame = buffer.slice(0, splitIndex);
        buffer = buffer.slice(buffer[splitIndex] === '\r' ? splitIndex + 4 : splitIndex + 2);
        const data = extractSseData(frame);
        if (data !== null) {
          yield data;
        }
        splitIndex = findSseFrameBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    const data = extractSseData(buffer);
    if (data !== null) {
      yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function findSseFrameBoundary(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf < 0) {
    return crlf;
  }
  if (crlf < 0) {
    return lf;
  }
  return Math.min(lf, crlf);
}

function extractSseData(frame: string): string | null {
  const lines = frame.split(/\r?\n/u);
  const eventName = lines
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim();
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  const data = dataLines.join('\n');
  if (eventName === 'error' && data.trim() !== '[DONE]') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify({
          type: 'error',
          ...parsed,
        });
      }
    } catch {
      // Fall through to a normalized top-level error payload below.
    }
    return JSON.stringify({
      type: 'error',
      message: data,
    });
  }
  return data;
}

function isAdapterHostedToolType(type: unknown): boolean {
  return isCodexProviderAdapterEmulatedBuiltinToolType(type);
}

function normalizeAdapterHostedToolType(type: unknown): string {
  return normalizeCodexProviderBuiltinToolName(type) ?? normalizeString(type);
}

function isAdapterHostedBuiltinChatTool(
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
