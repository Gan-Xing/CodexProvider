import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  OpenAICompatibleResponsesAdapterServer,
  createCodexProviderBraveApiEngine,
  createCodexProviderBraveHtmlEngine,
  createCodexProviderDuckDuckGoHtmlEngine,
  createCodexProviderEcosiaHtmlEngine,
  createCodexProviderLocalIndexSearchEngine,
  createCodexProviderMemoryWebSearchLocalIndex,
  createCodexProviderMetaSearchService,
  createCodexProviderMojeekHtmlEngine,
  createCodexProviderOpenSerpEndpointEngine,
  createCodexProviderSerperApiEngine,
  createCodexProviderSearxngEndpointEngine,
  createCodexProviderTavilyApiEngine,
  createCodexProviderWebRetrievalFetcher,
  createCodexProviderWebSearchExecutor,
  type CodexProviderHostedToolExecutionRequest,
  type CodexProviderSearchEngine,
} from '@codex-provider/core';

type SmokeEnv = {
  upstreamKeyName: string;
  upstreamApiKey: string;
  upstreamBaseUrl: string;
  model: string;
  searchCredentialName: string | null;
  searchCredentialKind: 'api-key' | 'endpoint' | 'none';
  searchProvider: 'brave' | 'serper' | 'tavily' | 'searxng' | 'openserp' | 'builtin-metasearch';
  searchApiKey: string | null;
  searchEndpoint: string | null;
};

type SmokeEnvResolution = {
  env: SmokeEnv | null;
  skipReason: string | null;
};

type TimedResult<T> = {
  durationMs: number;
  value: T;
};

const localIndex = createCodexProviderMemoryWebSearchLocalIndex({
  documents: [{
    url: 'https://docs.example.com/codex-provider-live-smoke',
    title: 'CodexProvider live smoke local index',
    text: [
      'CodexProvider adapter-emulated web_search can use a local index when external_web_access is false.',
      'The local cache path should not call live web search engines.',
    ].join(' '),
    fetchedAt: new Date(0).toISOString(),
    source: 'live-smoke-local-index',
  }],
});

const localEngine = createCodexProviderLocalIndexSearchEngine({
  index: localIndex,
  name: 'live-smoke-local-cache',
});

const retrieval = createCodexProviderWebRetrievalFetcher();

const { env, skipReason } = resolveSmokeEnv();
const liveEngines = env ? createLiveSearchEngines(env) : [];
const search = createCodexProviderMetaSearchService({
  engines: [...liveEngines, localEngine],
  mode: 'balanced',
  maxResults: 6,
});
const webSearch = createCodexProviderWebSearchExecutor({
  search,
  retrieval,
  fetchPages: true,
  maxResults: 6,
  maxRetrievedPages: 3,
});

await runOfflineLocalIndexSmoke();

if (!env) {
  console.log([
    `live web_search smoke skipped: ${skipReason ?? 'missing upstream environment variables.'}`,
    'Required: CODEX_PROVIDER_API_KEY or a provider preset API key; CODEX_PROVIDER_BASE_URL and CODEX_PROVIDER_MODEL unless inferred.',
    'Search credentials are optional unless CODEX_PROVIDER_WEB_SEARCH_PROVIDER selects brave, serper, or tavily.',
    'CODEX_PROVIDER_WEB_SEARCH_PROVIDER may be brave, serper, tavily, or builtin-metasearch.',
    'Offline local-index web_search smoke passed.',
  ].join('\n'));
  process.exit(0);
}

const server = new OpenAICompatibleResponsesAdapterServer({
  apiKey: env.upstreamApiKey,
  upstreamBaseUrl: env.upstreamBaseUrl,
  defaultModel: env.model,
  providerKind: 'openai-compatible',
  providerName: 'Live Smoke Provider',
  providerCapabilities: {
    supportsBuiltinWebSearchTool: false,
  },
  hostedTools: [{
    name: 'web_search',
    mode: 'adapter-emulated',
    emulatedToolName: 'adapter_web_search',
  }],
  hostedToolExecutors: {
    web_search: webSearch,
  },
  emitHostedToolSseEvents: true,
  exposeHostedToolResultsInResponsesOutput: true,
});

await server.start();
try {
  const nonStreaming = await time(() => postResponses(server.baseUrl, buildResponsesRequest(false, env.model)));
  assertResponsesWebSearchOutput(nonStreaming.value, 'non-streaming');
  assertLiveSearchOutput(nonStreaming.value, 'non-streaming');

  const streaming = await time(() => postResponsesStream(server.baseUrl, buildResponsesRequest(true, env.model)));
  assertStreamingWebSearchOutput(streaming.value);
  const completed = streaming.value.find((event) => event?.type === 'response.completed');
  assertLiveSearchOutput(completed?.response ?? {}, 'streaming completed');

  await appendSmokeEvidence({
    env,
    nonStreaming,
    streaming,
  });

  console.log('live web_search smoke passed');
} finally {
  await server.stop();
}

async function runOfflineLocalIndexSmoke(): Promise<void> {
  const result = await webSearch(buildToolRequest({
    query: 'CodexProvider external_web_access false local index',
    external_web_access: false,
    max_results: 3,
  }));
  const content = result.content as any;
  assert.equal(content.external_web_access, false);
  assert.equal(content.results?.[0]?.url, 'https://docs.example.com/codex-provider-live-smoke');
}

function buildResponsesRequest(stream: boolean, model: string): Record<string, any> {
  return {
    model,
    input: [
      'Use web_search to find one current source about TypeScript package architecture.',
      'After the search, answer in one sentence and cite the first source with [[source:1]].',
    ].join(' '),
    tools: [{
      type: 'web_search',
    }],
    tool_choice: 'web_search',
    include: ['web_search_call.action.sources', 'web_search_call.results'],
    stream,
  };
}

function buildToolRequest(argumentsObject: Record<string, any>): CodexProviderHostedToolExecutionRequest {
  return {
    toolName: 'web_search',
    emulatedToolName: 'adapter_web_search',
    callId: 'call_live_smoke_offline',
    arguments: argumentsObject,
    rawArguments: JSON.stringify(argumentsObject),
    model: 'live-smoke-model',
    providerKind: 'openai-compatible',
    providerName: 'Live Smoke Provider',
  };
}

async function postResponses(baseUrl: string, body: Record<string, any>): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`non-streaming smoke failed with HTTP ${response.status}: ${truncate(text, 1_000)}`);
  }
  return JSON.parse(text);
}

async function postResponsesStream(baseUrl: string, body: Record<string, any>): Promise<Record<string, any>[]> {
  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`streaming smoke failed with HTTP ${response.status}: ${truncate(text, 1_000)}`);
  }
  return parseSseJsonEvents(text);
}

function assertResponsesWebSearchOutput(response: Record<string, any>, label: string): void {
  const output = Array.isArray(response.output) ? response.output : [];
  const webSearchCall = output.find((item) => item?.type === 'web_search_call');
  const message = output.find((item) => item?.type === 'message');
  const textPart = Array.isArray(message?.content)
    ? message.content.find((part: any) => part?.type === 'output_text')
    : null;

  assert.ok(webSearchCall, `${label} response should include web_search_call`);
  assert.ok(message, `${label} response should include a final message`);
  assert.ok(String(textPart?.text ?? '').trim(), `${label} response should include final text`);
  assert.ok(
    Array.isArray(webSearchCall?.action?.sources) && webSearchCall.action.sources.length > 0,
    `${label} response should expose web_search_call.action.sources`,
  );
  assert.ok(
    Array.isArray(webSearchCall?.results) && webSearchCall.results.length > 0,
    `${label} response should expose web_search_call.results`,
  );
  assert.ok(
    Array.isArray(textPart?.annotations) && textPart.annotations.some((entry: any) => entry?.type === 'url_citation'),
    `${label} final text should include a url_citation annotation from [[source:N]]`,
  );
}

function assertLiveSearchOutput(response: Record<string, any>, label: string): void {
  const liveUrls = collectWebSearchUrls(response).filter((url) => !isLocalCacheSmokeUrl(url));
  assert.ok(
    liveUrls.length > 0,
    `${label} response should include at least one live web_search source/result outside the local cache`,
  );
}

function collectWebSearchUrls(response: Record<string, any>): string[] {
  const output = Array.isArray(response.output) ? response.output : [];
  const webSearchCall = output.find((item) => item?.type === 'web_search_call');
  const urls: string[] = [];
  for (const collection of [webSearchCall?.action?.sources, webSearchCall?.results]) {
    if (!Array.isArray(collection)) {
      continue;
    }
    for (const entry of collection) {
      const url = normalizeString(entry?.url);
      if (url) {
        urls.push(url);
      }
    }
  }
  return urls;
}

function isLocalCacheSmokeUrl(value: string): boolean {
  try {
    return new URL(value).host === 'docs.example.com';
  } catch {
    return false;
  }
}

function assertStreamingWebSearchOutput(events: Record<string, any>[]): void {
  const completed = events.find((event) => event?.type === 'response.completed');
  assert.ok(completed, 'streaming response should emit response.completed');
  assertResponsesWebSearchOutput(completed.response ?? {}, 'streaming completed');
}

function parseSseJsonEvents(text: string): Record<string, any>[] {
  const events: Record<string, any>[] = [];
  for (const frame of text.split(/\n\n/u)) {
    const data = frame
      .split(/\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n');
    if (!data || data === '[DONE]') {
      continue;
    }
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object') {
      events.push(parsed);
    }
  }
  return events;
}

async function appendSmokeEvidence({
  env,
  nonStreaming,
  streaming,
}: {
  env: SmokeEnv;
  nonStreaming: TimedResult<Record<string, any>>;
  streaming: TimedResult<Record<string, any>[]>;
}): Promise<void> {
  const completed = streaming.value.find((event) => event?.type === 'response.completed');
  const nonStreamingStats = summarizeResponse(nonStreaming.value);
  const streamingStats = summarizeResponse(completed?.response ?? {});
  const section = [
    '',
    `## ${new Date().toISOString()} Adapter-emulated web_search live smoke`,
    '',
    `- Provider base URL host: \`${safeUrlHost(env.upstreamBaseUrl)}\``,
    `- Model: \`${env.model}\``,
    `- Search provider: \`${env.searchProvider}\``,
    `- Upstream key env: \`${env.upstreamKeyName}=<redacted>\``,
    `- Search credential: \`${formatSearchCredential(env)}\``,
    '- Secrets: redacted; sourced from environment variables.',
    '',
    '| Smoke | Status | Notes |',
    '| --- | --- | --- |',
    `| Offline local-index path | Passed | Direct executor request used \`external_web_access=false\` and returned the seeded local-cache result. |`,
    `| Non-streaming adapter web_search | Passed | web_search_call sources: ${nonStreamingStats.sourceCount}; results: ${nonStreamingStats.resultCount}; annotations: ${nonStreamingStats.annotationCount}; latency: ${nonStreaming.durationMs} ms. |`,
    `| Streaming adapter web_search | Passed | SSE events: ${streaming.value.length}; web_search_call sources: ${streamingStats.sourceCount}; results: ${streamingStats.resultCount}; annotations: ${streamingStats.annotationCount}; latency: ${streaming.durationMs} ms. |`,
    '',
  ].join('\n');

  await fs.appendFile('docs/LIVE_SMOKE_RESULTS.md', section);
}

function summarizeResponse(response: Record<string, any>): { sourceCount: number; resultCount: number; annotationCount: number } {
  const output = Array.isArray(response.output) ? response.output : [];
  const webSearchCall = output.find((item) => item?.type === 'web_search_call');
  const message = output.find((item) => item?.type === 'message');
  const textPart = Array.isArray(message?.content)
    ? message.content.find((part: any) => part?.type === 'output_text')
    : null;
  return {
    sourceCount: Array.isArray(webSearchCall?.action?.sources) ? webSearchCall.action.sources.length : 0,
    resultCount: Array.isArray(webSearchCall?.results) ? webSearchCall.results.length : 0,
    annotationCount: Array.isArray(textPart?.annotations) ? textPart.annotations.length : 0,
  };
}

function formatSearchCredential(env: SmokeEnv): string {
  if (!env.searchCredentialName) {
    return 'not set; built-in no-key metasearch';
  }
  if (env.searchCredentialKind === 'endpoint') {
    return `${env.searchCredentialName}=${safeUrlHost(env.searchEndpoint ?? '')}`;
  }
  return `${env.searchCredentialName}=<redacted>`;
}

async function time<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
  const started = Date.now();
  const value = await fn();
  return {
    durationMs: Date.now() - started,
    value,
  };
}

function createLiveSearchEngines(env: SmokeEnv): CodexProviderSearchEngine[] {
  switch (env.searchProvider) {
    case 'brave':
      assert.ok(env.searchApiKey, 'BRAVE_SEARCH_API_KEY must be present for Brave API smoke');
      return [createCodexProviderBraveApiEngine({ apiKey: env.searchApiKey })];
    case 'serper':
      assert.ok(env.searchApiKey, 'SERPER_API_KEY must be present for Serper API smoke');
      return [createCodexProviderSerperApiEngine({ apiKey: env.searchApiKey })];
    case 'tavily':
      assert.ok(env.searchApiKey, 'TAVILY_API_KEY must be present for Tavily API smoke');
      return [createCodexProviderTavilyApiEngine({ apiKey: env.searchApiKey })];
    case 'searxng':
      assert.ok(env.searchEndpoint, 'SEARXNG_ENDPOINT must be present for SearXNG endpoint smoke');
      return [createCodexProviderSearxngEndpointEngine({ endpoint: env.searchEndpoint })];
    case 'openserp':
      assert.ok(env.searchEndpoint, 'OPENSERP_ENDPOINT must be present for OpenSERP endpoint smoke');
      return [createCodexProviderOpenSerpEndpointEngine({ endpoint: env.searchEndpoint })];
    case 'builtin-metasearch':
      return [
        createCodexProviderDuckDuckGoHtmlEngine({ maxResults: 6 }),
        createCodexProviderBraveHtmlEngine({ maxResults: 6 }),
        createCodexProviderEcosiaHtmlEngine({ maxResults: 6 }),
        createCodexProviderMojeekHtmlEngine({ maxResults: 6 }),
      ];
  }
}

function resolveSmokeEnv(): SmokeEnvResolution {
  const upstream = firstPresent([
    ['CODEX_PROVIDER_API_KEY', process.env.CODEX_PROVIDER_API_KEY],
    ['OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY],
    ['OPENAI_COMPATIBLE_API_KEY', process.env.OPENAI_COMPATIBLE_API_KEY],
    ['DASHSCOPE_API_KEY', process.env.DASHSCOPE_API_KEY],
    ['QWEN_API_KEY', process.env.QWEN_API_KEY],
    ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY],
    ['MINIMAX_API_KEY', process.env.MINIMAX_API_KEY],
    ['KIMI_API_KEY', process.env.KIMI_API_KEY],
  ]);
  if (!upstream) {
    return {
      env: null,
      skipReason: 'missing upstream environment variables.',
    };
  }
  const upstreamBaseUrl = configuredBaseUrlForKey(upstream.name)
    || inferredBaseUrlForKey(upstream.name);
  const model = configuredModelForKey(upstream.name)
    || inferredModelForKey(upstream.name);
  if (!upstreamBaseUrl || !model) {
    return {
      env: null,
      skipReason: 'missing upstream base URL or model.',
    };
  }
  const selectedProvider = normalizeSearchProvider(process.env.CODEX_PROVIDER_WEB_SEARCH_PROVIDER);
  const endpointSearch = firstPresent([
    ['SEARXNG_ENDPOINT', process.env.SEARXNG_ENDPOINT],
    ['CODEX_PROVIDER_SEARXNG_ENDPOINT', process.env.CODEX_PROVIDER_SEARXNG_ENDPOINT],
    ['OPENSERP_ENDPOINT', process.env.OPENSERP_ENDPOINT],
    ['CODEX_PROVIDER_OPENSERP_ENDPOINT', process.env.CODEX_PROVIDER_OPENSERP_ENDPOINT],
  ]);
  const apiSearch = firstPresent([
    ['BRAVE_SEARCH_API_KEY', process.env.BRAVE_SEARCH_API_KEY],
    ['SERPER_API_KEY', process.env.SERPER_API_KEY],
    ['TAVILY_API_KEY', process.env.TAVILY_API_KEY],
  ]);
  const search = selectedProvider
    ? selectedSearchProviderConfig(selectedProvider)
    : endpointSearch
    ? {
        credentialKind: 'endpoint' as const,
        credentialName: endpointSearch.name,
        provider: searchProviderForEndpoint(endpointSearch.name),
        apiKey: null,
        endpoint: endpointSearch.value,
      }
    : apiSearch
      ? {
          credentialKind: 'api-key' as const,
          credentialName: apiSearch.name,
          provider: searchProviderForApiKey(apiSearch.name),
          apiKey: apiSearch.value,
          endpoint: null,
        }
      : {
          credentialKind: 'none' as const,
          credentialName: null,
          provider: 'builtin-metasearch' as const,
          apiKey: null,
          endpoint: null,
        };
  if (!search) {
    return {
      env: null,
      skipReason: `CODEX_PROVIDER_WEB_SEARCH_PROVIDER=${normalizeString(process.env.CODEX_PROVIDER_WEB_SEARCH_PROVIDER)} is not supported.`,
    };
  }
  if (search.credentialKind === 'api-key' && !search.apiKey) {
    return {
      env: null,
      skipReason: `CODEX_PROVIDER_WEB_SEARCH_PROVIDER=${search.provider} requires ${search.credentialName}.`,
    };
  }
  return {
    env: {
      upstreamKeyName: upstream.name,
      upstreamApiKey: upstream.value,
      upstreamBaseUrl,
      model,
      searchCredentialName: search.credentialName,
      searchCredentialKind: search.credentialKind,
      searchProvider: search.provider,
      searchApiKey: search.apiKey,
      searchEndpoint: search.endpoint,
    },
    skipReason: null,
  };
}

function firstPresent(entries: Array<[string, string | undefined]>): { name: string; value: string } | null {
  for (const [name, value] of entries) {
    const normalized = normalizeString(value);
    if (normalized) {
      return { name, value: normalized };
    }
  }
  return null;
}

function searchProviderForApiKey(name: string): SmokeEnv['searchProvider'] {
  if (name === 'BRAVE_SEARCH_API_KEY') {
    return 'brave';
  }
  if (name === 'SERPER_API_KEY') {
    return 'serper';
  }
  return 'tavily';
}

function searchProviderForEndpoint(name: string): SmokeEnv['searchProvider'] {
  return name.includes('SEARXNG') ? 'searxng' : 'openserp';
}

function normalizeSearchProvider(value: unknown): SmokeEnv['searchProvider'] | null | 'unsupported' {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'brave' || normalized === 'serper' || normalized === 'tavily' || normalized === 'builtin-metasearch') {
    return normalized;
  }
  return 'unsupported';
}

function selectedSearchProviderConfig(provider: SmokeEnv['searchProvider'] | 'unsupported'): {
  credentialKind: SmokeEnv['searchCredentialKind'];
  credentialName: string | null;
  provider: SmokeEnv['searchProvider'];
  apiKey: string | null;
  endpoint: string | null;
} | null {
  switch (provider) {
    case 'brave':
      return {
        credentialKind: 'api-key',
        credentialName: 'BRAVE_SEARCH_API_KEY',
        provider,
        apiKey: normalizeString(process.env.BRAVE_SEARCH_API_KEY) || null,
        endpoint: null,
      };
    case 'serper':
      return {
        credentialKind: 'api-key',
        credentialName: 'SERPER_API_KEY',
        provider,
        apiKey: normalizeString(process.env.SERPER_API_KEY) || null,
        endpoint: null,
      };
    case 'tavily':
      return {
        credentialKind: 'api-key',
        credentialName: 'TAVILY_API_KEY',
        provider,
        apiKey: normalizeString(process.env.TAVILY_API_KEY) || null,
        endpoint: null,
      };
    case 'builtin-metasearch':
      return {
        credentialKind: 'none',
        credentialName: null,
        provider,
        apiKey: null,
        endpoint: null,
      };
    default:
      return null;
  }
}

function configuredBaseUrlForKey(name: string): string {
  switch (name) {
    case 'CODEX_PROVIDER_API_KEY':
      return normalizeString(process.env.CODEX_PROVIDER_BASE_URL);
    case 'OPENAI_COMPATIBLE_API_KEY':
      return normalizeString(process.env.OPENAI_COMPATIBLE_BASE_URL)
        || normalizeString(process.env.CODEX_PROVIDER_BASE_URL);
    case 'OPENROUTER_API_KEY':
      return normalizeString(process.env.OPENROUTER_BASE_URL);
    case 'DASHSCOPE_API_KEY':
      return normalizeString(process.env.DASHSCOPE_BASE_URL)
        || normalizeString(process.env.QWEN_BASE_URL);
    case 'QWEN_API_KEY':
      return normalizeString(process.env.QWEN_BASE_URL)
        || normalizeString(process.env.DASHSCOPE_BASE_URL);
    case 'DEEPSEEK_API_KEY':
      return normalizeString(process.env.DEEPSEEK_BASE_URL);
    case 'MINIMAX_API_KEY':
      return normalizeString(process.env.MINIMAX_BASE_URL);
    case 'KIMI_API_KEY':
      return normalizeString(process.env.KIMI_BASE_URL);
    default:
      return '';
  }
}

function configuredModelForKey(name: string): string {
  switch (name) {
    case 'CODEX_PROVIDER_API_KEY':
      return normalizeString(process.env.CODEX_PROVIDER_MODEL);
    case 'OPENAI_COMPATIBLE_API_KEY':
      return normalizeString(process.env.OPENAI_COMPATIBLE_MODEL)
        || normalizeString(process.env.CODEX_PROVIDER_MODEL);
    case 'OPENROUTER_API_KEY':
      return normalizeString(process.env.OPENROUTER_MODEL);
    case 'DASHSCOPE_API_KEY':
      return normalizeString(process.env.DASHSCOPE_MODEL)
        || normalizeString(process.env.QWEN_MODEL);
    case 'QWEN_API_KEY':
      return normalizeString(process.env.QWEN_MODEL)
        || normalizeString(process.env.DASHSCOPE_MODEL);
    case 'DEEPSEEK_API_KEY':
      return normalizeString(process.env.DEEPSEEK_MODEL);
    case 'MINIMAX_API_KEY':
      return normalizeString(process.env.MINIMAX_MODEL);
    case 'KIMI_API_KEY':
      return normalizeString(process.env.KIMI_MODEL);
    default:
      return '';
  }
}

function inferredBaseUrlForKey(name: string): string {
  switch (name) {
    case 'OPENROUTER_API_KEY':
      return 'https://openrouter.ai/api/v1';
    case 'DEEPSEEK_API_KEY':
      return 'https://api.deepseek.com';
    case 'DASHSCOPE_API_KEY':
    case 'QWEN_API_KEY':
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    case 'MINIMAX_API_KEY':
      return 'https://api.minimaxi.com/v1';
    case 'KIMI_API_KEY':
      return 'https://api.kimi.com/coding';
    default:
      return '';
  }
}

function inferredModelForKey(name: string): string {
  switch (name) {
    case 'OPENROUTER_API_KEY':
      return 'deepseek/deepseek-chat';
    case 'DEEPSEEK_API_KEY':
      return 'deepseek-chat';
    case 'DASHSCOPE_API_KEY':
    case 'QWEN_API_KEY':
      return 'qwen-plus';
    case 'MINIMAX_API_KEY':
      return 'MiniMax-M2.7';
    case 'KIMI_API_KEY':
      return 'kimi-k2';
    default:
      return '';
  }
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '<invalid-url>';
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
