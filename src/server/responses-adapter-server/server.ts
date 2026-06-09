import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  OpenAICompatibleProviderCapabilities,
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
  buildModelsResponseMetadata,
  normalizeModels,
} from './models.js';
import {
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
  fetchUpstreamWithRetry as fetchUpstreamWithRetryRequest,
} from './upstream.js';
import {
  writeStreamingDataLinesResponse as writeStreamingDataLinesSseResponse,
  writeStreamingDataLinesResponseWithHostedToolResults as writeStreamingDataLinesSseResponseWithHostedToolResults,
  writeSyntheticStreamingResponse as writeSyntheticSseResponse,
} from './streaming-response.js';
import {
  readSseDataLines,
} from './streaming.js';
import {
  handleResponsesAdapterRequest,
} from './responses-handler.js';
import {
  normalizeWebSearchInvalidParameterStrategy,
} from '../../web-search/validation.js';
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

  private readonly webSearchInvalidParameterStrategy: 'error' | 'drop';

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
    webSearchInvalidParameterStrategy = 'error',
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
    this.webSearchInvalidParameterStrategy = normalizeWebSearchInvalidParameterStrategy(
      webSearchInvalidParameterStrategy,
    );
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
    await handleResponsesAdapterRequest({
      requestBody,
      response,
      compact,
      apiKey: this.apiKey,
      upstreamBaseUrl: this.upstreamBaseUrl,
      defaultModel: this.defaultModel,
      models: this.models,
      providerKind: this.providerKind,
      providerName: this.providerName,
      providerCapabilities: this.providerCapabilities,
      upstreamResponsesPath: this.upstreamResponsesPath,
      upstreamChatCompletionsPath: this.upstreamChatCompletionsPath,
      executableHostedTools: this.executableHostedTools,
      hostedToolExecutorRegistry: this.hostedToolExecutorRegistry,
      maxHostedToolIterations: this.maxHostedToolIterations,
      emitHostedToolSseEvents: this.emitHostedToolSseEvents,
      exposeHostedToolResultsInResponsesOutput: this.exposeHostedToolResultsInResponsesOutput,
      webSearchInvalidParameterStrategy: this.webSearchInvalidParameterStrategy,
      fetchUpstreamWithRetry: (...args) => this.fetchUpstreamWithRetry(...args),
      writeStreamingResponse: (...args) => this.writeStreamingResponse(...args),
      writeStreamingDataLinesResponse: (...args) => this.writeStreamingDataLinesResponse(...args),
      writeStreamingDataLinesResponseWithHostedToolResults: (...args) => (
        this.writeStreamingDataLinesResponseWithHostedToolResults(...args)
      ),
      writeSyntheticStreamingResponse: (...args) => this.writeSyntheticStreamingResponse(...args),
      emitTrace: (event) => this.emitTrace(event),
    });
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
