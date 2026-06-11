import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  CodexProviderRuntime,
  createCodexProviderBraveApiEngine,
  createCodexProviderBraveHtmlEngine,
  createCodexProviderDuckDuckGoHtmlEngine,
  createCodexProviderEcosiaHtmlEngine,
  createCodexProviderFileSearchExecutor,
  createCodexProviderLocalIndexSearchEngine,
  createCodexProviderMemoryFileSearchSource,
  createCodexProviderMemoryWebSearchLocalIndex,
  createCodexProviderMetaSearchService,
  createCodexProviderMojeekHtmlEngine,
  createCodexProviderSerperApiEngine,
  createCodexProviderTavilyApiEngine,
  createCodexProviderWebRetrievalFetcher,
  createCodexProviderWebSearchExecutor,
  type CodexProviderRuntimeState,
  type CodexProviderSearchEngine,
} from '@codex-provider/core';

type HostSmokeEnv = {
  upstreamKeyName: string;
  upstreamApiKey: string;
  upstreamBaseUrl: string;
  model: string;
  searchKeyName: string | null;
  searchProvider: 'local-index' | 'builtin-metasearch' | 'brave' | 'serper' | 'tavily';
  searchApiKey: string | null;
};

type TimedResult<T> = {
  durationMs: number;
  value: T;
};

const env = resolveHostSmokeEnv();

if (!env) {
  console.log([
    'live host integration smoke skipped: missing upstream provider credentials.',
    'Required: CODEX_PROVIDER_API_KEY or a provider preset API key; CODEX_PROVIDER_BASE_URL and CODEX_PROVIDER_MODEL unless inferred.',
    'Optional for API-backed search: BRAVE_SEARCH_API_KEY, SERPER_API_KEY, or TAVILY_API_KEY. Without a search key, the smoke uses built-in no-key HTML metasearch plus a local-index fallback.',
  ].join('\n'));
  process.exit(0);
}

const fileSearch = createCodexProviderFileSearchExecutor({
  sources: [
    createCodexProviderMemoryFileSearchSource({
      name: 'host-memory',
      documents: [{
        id: 'host-smoke-file',
        title: 'Host integration smoke file',
        path: 'docs/host-smoke.md',
        content: [
          'CodexProvider live host smoke validates adapter-emulated file_search.',
          'The file_search_call output should expose this memory document.',
        ].join('\n'),
        metadata: { smoke: 'host-integration' },
      }],
      includeContent: true,
    }),
  ],
  includeContent: true,
  maxResults: 4,
});

const webSearch = createCodexProviderWebSearchExecutor({
  search: createCodexProviderMetaSearchService({
    engines: createSearchEngines(env),
    mode: 'balanced',
    maxResults: 6,
  }),
  retrieval: createCodexProviderWebRetrievalFetcher(),
  fetchPages: env.searchProvider !== 'local-index',
  maxResults: 6,
  maxRetrievedPages: env.searchProvider !== 'local-index' ? 3 : 0,
});

const runtime = new CodexProviderRuntime({
  apiKey: env.upstreamApiKey,
  upstreamBaseUrl: env.upstreamBaseUrl,
  defaultModel: env.model,
  providerLabel: providerLabelForKey(env.upstreamKeyName),
  providerName: 'Live Host Smoke Provider',
  profileMode: 'mixed',
  toolStrategy: 'adapter-emulated',
  hostedTools: [{
    name: 'file_search',
    mode: 'adapter-emulated',
    emulatedToolName: 'adapter_file_search',
  }, {
    name: 'web_search',
    mode: 'adapter-emulated',
    emulatedToolName: 'adapter_web_search',
  }],
  hostedToolExecutors: {
    file_search: fileSearch,
    web_search: webSearch,
  },
  emitHostedToolSseEvents: true,
  adapterOptions: {
    providerKind: 'openai-compatible',
    providerName: 'Live Host Smoke Provider',
    providerCapabilities: {
      supportsBuiltinWebSearchTool: false,
    },
    exposeHostedToolResultsInResponsesOutput: true,
  },
});

const state = await runtime.start();
try {
  assert.equal(state.profile.mode, 'mixed');
  assert.equal(state.profile.toolStrategy, 'adapter-emulated');
  assert.ok(state.adapterBaseUrl, 'mixed mode should start a local Responses adapter');
  const responsesBaseUrl = state.adapterBaseUrl;

  const normal = await time(() => postResponses(responsesBaseUrl, {
    model: env.model,
    input: 'Reply in one short sentence: CodexProvider host integration smoke normal path.',
  }));
  assertMessage(normal.value, 'normal response');

  const customToolLoop = await time(() => runCustomToolLoop(responsesBaseUrl, env.model));

  const fileSearchResult = await time(() => postResponses(responsesBaseUrl, {
    model: env.model,
    input: 'Use file_search to find the host integration smoke file, then answer with its filename.',
    tools: [{ type: 'file_search', vector_store_ids: ['host-memory'] }],
    tool_choice: 'file_search',
    include: ['file_search_call.results'],
  }));
  assertFileSearchOutput(fileSearchResult.value);

  const webSearchResult = await time(() => postResponses(
    responsesBaseUrl,
    buildWebSearchRequest(env.model, false, env.searchProvider),
  ));
  assertWebSearchOutput(webSearchResult.value, 'non-streaming web_search', env.searchProvider);

  const streamingWebSearch = await time(() => postResponsesStream(
    responsesBaseUrl,
    buildWebSearchRequest(env.model, true, env.searchProvider),
  ));
  assertStreamingWebSearchOutput(streamingWebSearch.value, env.searchProvider);

  await appendHostSmokeEvidence({
    env,
    state,
    normal,
    customToolLoop,
    fileSearchResult,
    webSearchResult,
    streamingWebSearch,
  });

  console.log('live host integration smoke passed');
} finally {
  await runtime.stop();
}

function createSearchEngines(env: HostSmokeEnv): CodexProviderSearchEngine[] {
  const localIndex = createCodexProviderMemoryWebSearchLocalIndex({
    documents: [{
      url: 'https://docs.example.com/codex-provider-host-smoke',
      title: 'CodexProvider host integration smoke web source',
      text: [
        'CodexProvider host integration smoke validates adapter-emulated web_search.',
        'The local web index path works without exposing file_search sources to web_search.',
      ].join(' '),
      fetchedAt: new Date(0).toISOString(),
      source: 'host-smoke-local-index',
    }],
  });
  const localEngine = createCodexProviderLocalIndexSearchEngine({
    index: localIndex,
    name: 'host-smoke-local-index',
  });
  return [
    ...createLiveSearchEngines(env),
    localEngine,
  ];
}

function createLiveSearchEngines(env: HostSmokeEnv): CodexProviderSearchEngine[] {
  if (env.searchProvider === 'builtin-metasearch') {
    return [
      createCodexProviderDuckDuckGoHtmlEngine({ maxResults: 6 }),
      createCodexProviderBraveHtmlEngine({ maxResults: 6 }),
      createCodexProviderEcosiaHtmlEngine({ maxResults: 6 }),
      createCodexProviderMojeekHtmlEngine({ maxResults: 6 }),
    ];
  }
  const liveEngine = createApiSearchEngine(env);
  return liveEngine ? [liveEngine] : [];
}

function createApiSearchEngine(env: HostSmokeEnv): CodexProviderSearchEngine | null {
  if (!env.searchApiKey) {
    return null;
  }
  switch (env.searchProvider) {
    case 'brave':
      return createCodexProviderBraveApiEngine({ apiKey: env.searchApiKey });
    case 'serper':
      return createCodexProviderSerperApiEngine({ apiKey: env.searchApiKey });
    case 'tavily':
      return createCodexProviderTavilyApiEngine({ apiKey: env.searchApiKey });
    case 'builtin-metasearch':
    case 'local-index':
      return null;
  }
}

function buildWebSearchRequest(
  model: string,
  stream: boolean,
  searchProvider: HostSmokeEnv['searchProvider'],
): Record<string, any> {
  const searchPrompt = searchProvider === 'local-index'
    ? [
        'Use web_search for CodexProvider host integration smoke.',
        'Answer in one sentence and cite the first source with [[source:1]].',
      ]
    : [
        'Use web_search to find one current source about TypeScript package architecture.',
        'After the search, answer in one sentence and cite the first source with [[source:1]].',
      ];
  return {
    model,
    input: searchPrompt.join(' '),
    tools: [{ type: 'web_search' }],
    tool_choice: 'web_search',
    include: ['web_search_call.action.sources', 'web_search_call.results'],
    stream,
  };
}

async function runCustomToolLoop(
  responsesBaseUrl: string,
  model: string,
): Promise<{ first: Record<string, any>; second: Record<string, any> }> {
  const first = await postResponses(responsesBaseUrl, {
    model,
    input: 'Call echo_probe once with {"message":"host smoke"} before answering.',
    tools: [{
      type: 'custom',
      name: 'echo_probe',
      description: 'Echo a host integration smoke probe.',
    }],
    tool_choice: {
      type: 'custom',
      name: 'echo_probe',
    },
  });
  const toolCall = findOutput(first, 'custom_tool_call');
  assert.ok(toolCall, 'custom tool loop should produce a custom_tool_call');
  assert.equal(toolCall.name, 'echo_probe');
  assert.ok(toolCall.call_id, 'custom tool call should include call_id');

  const second = await postResponses(responsesBaseUrl, {
    model,
    input: [
      toolCall,
      {
        type: 'custom_tool_call_output',
        call_id: toolCall.call_id,
        output: 'echo_probe_result=ok',
      },
    ],
    tools: [{
      type: 'custom',
      name: 'echo_probe',
      description: 'Echo a host integration smoke probe.',
    }],
  });
  assertMessage(second, 'custom tool loop final response');
  return { first, second };
}

async function postResponses(baseUrl: string, body: Record<string, any>): Promise<Record<string, any>> {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Responses request failed with HTTP ${response.status}: ${truncate(text, 1_000)}`);
  }
  return JSON.parse(text) as Record<string, any>;
}

async function postResponsesStream(baseUrl: string, body: Record<string, any>): Promise<Record<string, any>[]> {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Streaming Responses request failed with HTTP ${response.status}: ${truncate(text, 1_000)}`);
  }
  return parseSseJsonEvents(text);
}

function assertMessage(response: Record<string, any>, label: string): void {
  const message = findOutput(response, 'message');
  const textPart = Array.isArray(message?.content)
    ? message.content.find((part: any) => part?.type === 'output_text')
    : null;
  assert.ok(String(textPart?.text ?? '').trim(), `${label} should include final text`);
}

function assertFileSearchOutput(response: Record<string, any>): void {
  assertMessage(response, 'file_search response');
  const fileSearchCall = findOutput(response, 'file_search_call');
  assert.ok(fileSearchCall, 'file_search response should include file_search_call');
  assert.equal(fileSearchCall.status, 'completed');
  assert.ok(Array.isArray(fileSearchCall.results), 'file_search_call should expose results');
  assert.equal(fileSearchCall.results[0]?.filename, 'host-smoke.md');
}

function assertWebSearchOutput(
  response: Record<string, any>,
  label: string,
  searchProvider: HostSmokeEnv['searchProvider'],
): void {
  assertMessage(response, label);
  const webSearchCall = findOutput(response, 'web_search_call');
  const message = findOutput(response, 'message');
  const textPart = Array.isArray(message?.content)
    ? message.content.find((part: any) => part?.type === 'output_text')
    : null;
  assert.ok(webSearchCall, `${label} should include web_search_call`);
  assert.ok(
    Array.isArray(webSearchCall?.action?.sources) && webSearchCall.action.sources.length > 0,
    `${label} should expose web_search_call.action.sources`,
  );
  assert.ok(
    Array.isArray(webSearchCall?.results) && webSearchCall.results.length > 0,
    `${label} should expose web_search_call.results`,
  );
  assert.ok(
    Array.isArray(textPart?.annotations) && textPart.annotations.some((entry: any) => entry?.type === 'url_citation'),
    `${label} should include a url_citation annotation`,
  );
  if (searchProvider !== 'local-index') {
    assertLiveWebSearchOutput(response, label);
  }
}

function assertStreamingWebSearchOutput(
  events: Record<string, any>[],
  searchProvider: HostSmokeEnv['searchProvider'],
): void {
  const completed = events.find((event) => event?.type === 'response.completed');
  assert.ok(completed, 'streaming web_search should emit response.completed');
  assertWebSearchOutput(completed.response ?? {}, 'streaming web_search', searchProvider);
}

function assertLiveWebSearchOutput(response: Record<string, any>, label: string): void {
  const liveUrls = collectWebSearchUrls(response).filter((url) => !isLocalCacheSmokeUrl(url));
  assert.ok(
    liveUrls.length > 0,
    `${label} should include at least one live web_search source/result outside the local cache`,
  );
}

function collectWebSearchUrls(response: Record<string, any>): string[] {
  const webSearchCall = findOutput(response, 'web_search_call');
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

function findOutput(response: Record<string, any>, type: string): any {
  return Array.isArray(response.output)
    ? response.output.find((item: any) => item?.type === type)
    : null;
}

async function appendHostSmokeEvidence({
  env,
  state,
  normal,
  customToolLoop,
  fileSearchResult,
  webSearchResult,
  streamingWebSearch,
}: {
  env: HostSmokeEnv;
  state: CodexProviderRuntimeState;
  normal: TimedResult<Record<string, any>>;
  customToolLoop: TimedResult<{ first: Record<string, any>; second: Record<string, any> }>;
  fileSearchResult: TimedResult<Record<string, any>>;
  webSearchResult: TimedResult<Record<string, any>>;
  streamingWebSearch: TimedResult<Record<string, any>[]>;
}): Promise<void> {
  const webStats = summarizeWebSearchResponse(webSearchResult.value);
  const completed = streamingWebSearch.value.find((event) => event?.type === 'response.completed');
  const streamingStats = summarizeWebSearchResponse(completed?.response ?? {});
  const fileSearchCall = findOutput(fileSearchResult.value, 'file_search_call');
  const section = [
    '',
    `## ${new Date().toISOString()} CodexProviderRuntime live host integration smoke`,
    '',
    `- Provider base URL host: \`${safeUrlHost(env.upstreamBaseUrl)}\``,
    `- Model: \`${env.model}\``,
    `- Runtime mode: \`${state.profile.mode}\``,
    `- Tool strategy: \`${state.profile.toolStrategy}\``,
    `- Upstream key env: \`${env.upstreamKeyName}=<redacted>\``,
    `- Search provider: \`${env.searchProvider}\``,
    `- Search key env: \`${formatHostSearchCredential(env)}\``,
    '- Secrets: redacted; sourced from environment variables.',
    '',
    '| Smoke | Status | Notes |',
    '| --- | --- | --- |',
    `| Mixed runtime local adapter | Passed | Adapter base URL host: ${safeUrlHost(state.adapterBaseUrl ?? '')}. |`,
    `| Normal response | Passed | Latency: ${normal.durationMs} ms. |`,
    `| Custom tool loop | Passed | First turn produced ${findOutput(customToolLoop.value.first, 'custom_tool_call')?.name}; second turn returned final text. Latency: ${customToolLoop.durationMs} ms. |`,
    `| Adapter-emulated file_search | Passed | Results: ${Array.isArray(fileSearchCall?.results) ? fileSearchCall.results.length : 0}; first filename: ${fileSearchCall?.results?.[0]?.filename ?? '<none>'}; latency: ${fileSearchResult.durationMs} ms. |`,
    `| Adapter-emulated web_search | Passed | Sources: ${webStats.sourceCount}; results: ${webStats.resultCount}; annotations: ${webStats.annotationCount}; latency: ${webSearchResult.durationMs} ms. |`,
    `| Streaming adapter-emulated web_search | Passed | SSE events: ${streamingWebSearch.value.length}; sources: ${streamingStats.sourceCount}; results: ${streamingStats.resultCount}; annotations: ${streamingStats.annotationCount}; latency: ${streamingWebSearch.durationMs} ms. |`,
    '',
  ].join('\n');

  await fs.appendFile('docs/LIVE_SMOKE_RESULTS.md', section);
}

function summarizeWebSearchResponse(response: Record<string, any>): {
  sourceCount: number;
  resultCount: number;
  annotationCount: number;
} {
  const webSearchCall = findOutput(response, 'web_search_call');
  const message = findOutput(response, 'message');
  const textPart = Array.isArray(message?.content)
    ? message.content.find((part: any) => part?.type === 'output_text')
    : null;
  return {
    sourceCount: Array.isArray(webSearchCall?.action?.sources) ? webSearchCall.action.sources.length : 0,
    resultCount: Array.isArray(webSearchCall?.results) ? webSearchCall.results.length : 0,
    annotationCount: Array.isArray(textPart?.annotations) ? textPart.annotations.length : 0,
  };
}

async function time<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
  const started = Date.now();
  const value = await fn();
  return {
    durationMs: Date.now() - started,
    value,
  };
}

function resolveHostSmokeEnv(): HostSmokeEnv | null {
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
    return null;
  }
  const upstreamBaseUrl = configuredBaseUrlForKey(upstream.name)
    || inferredBaseUrlForKey(upstream.name);
  const model = configuredModelForKey(upstream.name)
    || inferredModelForKey(upstream.name);
  if (!upstreamBaseUrl || !model) {
    return null;
  }
  const search = firstPresent([
    ['BRAVE_SEARCH_API_KEY', process.env.BRAVE_SEARCH_API_KEY],
    ['SERPER_API_KEY', process.env.SERPER_API_KEY],
    ['TAVILY_API_KEY', process.env.TAVILY_API_KEY],
  ]);
  return {
    upstreamKeyName: upstream.name,
    upstreamApiKey: upstream.value,
    upstreamBaseUrl,
    model,
    searchKeyName: search?.name ?? null,
    searchProvider: search ? searchProviderForKey(search.name) : 'builtin-metasearch',
    searchApiKey: search?.value ?? null,
  };
}

function formatHostSearchCredential(env: HostSmokeEnv): string {
  if (env.searchKeyName) {
    return `${env.searchKeyName}=<redacted>`;
  }
  if (env.searchProvider === 'builtin-metasearch') {
    return '<not set; built-in no-key metasearch>';
  }
  return '<not set; local-index>';
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

function searchProviderForKey(name: string): HostSmokeEnv['searchProvider'] {
  if (name === 'BRAVE_SEARCH_API_KEY') {
    return 'brave';
  }
  if (name === 'SERPER_API_KEY') {
    return 'serper';
  }
  return 'tavily';
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

function providerLabelForKey(name: string): string {
  return name.toLowerCase().replace(/_api_key$/u, '').replace(/[^a-z0-9]+/gu, '_') || 'live_provider';
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '<invalid-url>';
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
