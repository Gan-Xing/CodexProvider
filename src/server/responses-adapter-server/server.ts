import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  chatCompletionsResponseToResponses,
  responsesRequestToChatCompletions,
} from '../../converters/responses-adapter/index.js';
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
  requestUsesExecutableAdapterHostedTool,
} from './adapter-hosted-tools.js';
import {
  completeAdapterHostedToolLoop,
} from './adapter-hosted-tool-loop.js';
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
  shouldRetryWithoutForcedToolChoice,
} from './retry.js';
import {
  fetchUpstreamWithRetry as fetchUpstreamWithRetryRequest,
} from './upstream.js';
import {
  summarizeRequestAdjustments,
} from './request-adjustments.js';
import {
  writeStreamingDataLinesResponse as writeStreamingDataLinesSseResponse,
  writeStreamingDataLinesResponseWithHostedToolResults as writeStreamingDataLinesSseResponseWithHostedToolResults,
  writeSyntheticStreamingResponse as writeSyntheticSseResponse,
} from './streaming-response.js';
import {
  readSseDataLines,
} from './streaming.js';
import {
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
      await handleCompactResponses({
        requestBody,
        response,
        providerCapabilities: effectiveCapabilities,
        upstreamBaseUrl: this.upstreamBaseUrl,
        apiKey: this.apiKey,
        providerName: this.providerName,
        models: this.models,
        defaultModel: this.defaultModel,
        fetchUpstreamWithRetry: (...args) => this.fetchUpstreamWithRetry(...args),
        emitTrace: (event) => this.emitTrace(event),
      });
      return;
    }
    if (this.upstreamResponsesPath) {
      await handleDirectResponsesProxy({
        requestBody,
        response,
        requestedModel,
        stream,
        route,
        providerCapabilities: effectiveCapabilities,
        upstreamBaseUrl: this.upstreamBaseUrl,
        upstreamResponsesPath: this.upstreamResponsesPath,
        apiKey: this.apiKey,
        providerName: this.providerName,
        fetchUpstreamWithRetry: (...args) => this.fetchUpstreamWithRetry(...args),
        emitTrace: (event) => this.emitTrace(event),
      });
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
      await writeAdapterHostedToolStreamingResponse({
        requestBody,
        chatBody,
        upstreamUrl,
        buildUpstreamInit,
        providerCapabilities: effectiveCapabilities,
        requestedModel,
        response,
        executableHostedTools: this.executableHostedTools,
        hostedToolExecutorRegistry: this.hostedToolExecutorRegistry,
        maxHostedToolIterations: this.maxHostedToolIterations,
        emitHostedToolSseEvents: this.emitHostedToolSseEvents,
        providerKind: this.providerKind,
        providerName: this.providerName,
        fetchUpstreamWithRetry: (...args) => this.fetchUpstreamWithRetry(...args),
        writeStreamingDataLinesResponse: (...args) => this.writeStreamingDataLinesResponse(...args),
        writeStreamingDataLinesResponseWithHostedToolResults: (...args) => (
          this.writeStreamingDataLinesResponseWithHostedToolResults(...args)
        ),
        emitTrace: (event) => this.emitTrace(event),
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
    const hostedToolLoop = await completeAdapterHostedToolLoop({
      chatBody,
      initialJson: json,
      upstreamUrl,
      buildUpstreamInit,
      providerCapabilities: effectiveCapabilities,
      requestedModel,
      executableHostedTools: this.executableHostedTools,
      hostedToolExecutorRegistry: this.hostedToolExecutorRegistry,
      maxHostedToolIterations: this.maxHostedToolIterations,
      providerKind: this.providerKind,
      providerName: this.providerName,
      fetchUpstreamWithRetry: (...args) => this.fetchUpstreamWithRetry(...args),
      emitTrace: (event) => this.emitTrace(event),
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

  private async fetchUpstreamWithRetry(
    url: string,
    init: RequestInit,
    route: AdapterRoute,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
  ): Promise<{
    response: Response;
    errorText: string | null;
  }> {
    return fetchUpstreamWithRetryRequest({
      url,
      init,
      route,
      providerCapabilities,
      fetchImpl: this.fetchImpl,
      emitTrace: (event) => this.emitTrace(event),
    });
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
    await writeStreamingDataLinesSseResponse({
      requestBody,
      providerCapabilities,
      dataLines,
      response,
      models: this.models,
      defaultModel: this.defaultModel,
      emitTrace: (event) => this.emitTrace(event),
    });
  }

  private async writeStreamingDataLinesResponseWithHostedToolResults(
    requestBody: JsonRecord,
    providerCapabilities: OpenAICompatibleProviderCapabilities | null,
    dataLines: AsyncIterable<string>,
    executions: AdapterHostedToolExecutionRecord[],
    response: ServerResponse,
  ): Promise<void> {
    await writeStreamingDataLinesSseResponseWithHostedToolResults({
      requestBody,
      providerCapabilities,
      dataLines,
      executions,
      response,
      models: this.models,
      defaultModel: this.defaultModel,
      exposeHostedToolResultsInResponsesOutput: this.exposeHostedToolResultsInResponsesOutput,
      emitTrace: (event) => this.emitTrace(event),
    });
  }

  private async writeSyntheticStreamingResponse(
    adaptedResponse: JsonRecord,
    response: ServerResponse,
  ): Promise<void> {
    await writeSyntheticSseResponse({
      adaptedResponse,
      response,
      emitTrace: (event) => this.emitTrace(event),
    });
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
