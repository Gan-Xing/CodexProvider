import {
  CodexProviderRuntime,
  createCodexProviderBraveApiEngine,
  createCodexProviderBraveHtmlEngine,
  createCodexProviderDeepWebSearchExecutor,
  createCodexProviderDuckDuckGoHtmlEngine,
  createCodexProviderEcosiaHtmlEngine,
  createCodexProviderLocalIndexingWebRetrievalCache,
  createCodexProviderLocalIndexSearchEngine,
  createCodexProviderMemoryWebRetrievalCache,
  createCodexProviderMemoryWebSearchLocalIndex,
  createCodexProviderMetaSearchService,
  createCodexProviderMojeekHtmlEngine,
  createCodexProviderSerpApiEngine,
  createCodexProviderSerperApiEngine,
  createCodexProviderWebRetrievalFetcher,
  createCodexProviderWebSearchExecutor,
  type CodexProviderSearchEngine,
} from 'codex-provider';

const localIndex = createCodexProviderMemoryWebSearchLocalIndex();
const retrieval = createCodexProviderWebRetrievalFetcher({
  cache: createCodexProviderLocalIndexingWebRetrievalCache({
    cache: createCodexProviderMemoryWebRetrievalCache(),
    index: localIndex,
  }),
});

const engines = [
  process.env.BRAVE_SEARCH_API_KEY
    ? createCodexProviderBraveApiEngine({ apiKey: process.env.BRAVE_SEARCH_API_KEY })
    : null,
  process.env.SERPER_API_KEY
    ? createCodexProviderSerperApiEngine({ apiKey: process.env.SERPER_API_KEY })
    : null,
  process.env.SERPAPI_API_KEY
    ? createCodexProviderSerpApiEngine({ apiKey: process.env.SERPAPI_API_KEY })
    : null,
  createCodexProviderLocalIndexSearchEngine({ index: localIndex, name: 'local-cache' }),
  createCodexProviderDuckDuckGoHtmlEngine(),
  createCodexProviderBraveHtmlEngine(),
  createCodexProviderEcosiaHtmlEngine(),
  createCodexProviderMojeekHtmlEngine(),
].filter((engine): engine is CodexProviderSearchEngine => Boolean(engine));

const search = createCodexProviderMetaSearchService({
  engines,
  mode: 'balanced',
  maxResults: 10,
});

const webSearch = createCodexProviderWebSearchExecutor({
  search,
  retrieval,
  fetchPages: true,
  maxResults: 10,
  maxRetrievedPages: 5,
});

const deepWebSearch = createCodexProviderDeepWebSearchExecutor({
  search,
  maxSubqueries: 4,
  maxSources: 20,
});

const runtime = new CodexProviderRuntime({
  apiKey: mustGetEnv('OPENROUTER_API_KEY'),
  upstreamBaseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat',
  providerLabel: 'openrouter',
  profileMode: 'mixed',
  toolStrategy: 'adapter-emulated',
  hostedTools: [
    { name: 'web_search', mode: 'adapter-emulated' },
    {
      name: 'custom:deep_web_search',
      mode: 'adapter-emulated',
      emulatedToolName: 'deep_web_search',
      description: 'Run an opt-in deep web research graph over the configured metasearch service.',
    },
  ],
  hostedToolExecutors: {
    web_search: webSearch,
    'custom:deep_web_search': deepWebSearch,
  },
  emitHostedToolSseEvents: true,
});

await runtime.start();

function mustGetEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
