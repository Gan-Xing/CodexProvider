# CodexProvider Recipes

These recipes describe how a host app should wire `@codex-provider/core` without depending on CodexBridge internals.

## Mixed OpenRouter Runtime

Use `profileMode: "mixed"` when Codex should talk to a local Responses adapter while the provider adapter calls an upstream Chat Completions API.

```ts
const runtime = new CodexProviderRuntime({
  apiKey: process.env.OPENROUTER_API_KEY!,
  upstreamBaseUrl: "https://openrouter.ai/api/v1",
  defaultModel: "deepseek/deepseek-chat",
  providerLabel: "openrouter",
  profileMode: "mixed",
  toolStrategy: "codex-local-first",
});
```

## Adapter-Emulated Hosted Tools

Adapter-emulated tools must be declared and registered.

```ts
hostedTools: [{ name: "web_search", mode: "adapter-emulated" }],
hostedToolExecutors: {
  web_search: createCodexProviderWebSearchExecutor({
    provider: "tavily",
    apiKey: process.env.TAVILY_API_KEY!,
  }),
}
```

The provider adapter then exposes a function tool to Chat Completions upstreams, executes the host-provided executor, appends the tool output, and continues the model loop.

## Self-Hosted Web Search

Use native metasearch engines when the host should not depend on OpenAI hosted Web Search. API engines are optional; HTML engines provide best-effort fallback without API keys.

```ts
const webSearch = createCodexProviderWebSearchExecutor({
  mode: "balanced",
  engines: [
    process.env.BRAVE_SEARCH_API_KEY
      ? createCodexProviderBraveApiEngine({ apiKey: process.env.BRAVE_SEARCH_API_KEY })
      : null,
    process.env.SERPER_API_KEY
      ? createCodexProviderSerperApiEngine({ apiKey: process.env.SERPER_API_KEY })
      : null,
    createCodexProviderDuckDuckGoHtmlEngine(),
    createCodexProviderBraveHtmlEngine(),
    createCodexProviderEcosiaHtmlEngine(),
    createCodexProviderMojeekHtmlEngine(),
  ].filter(Boolean),
  fetchPages: true,
  maxResults: 10,
  maxRetrievedPages: 5,
});
```

For offline fallback, index retrieved pages into a local cache engine. When requests set `external_web_access=false`, only `live: false` engines such as the local index are queried.

```ts
const localIndex = createCodexProviderMemoryWebSearchLocalIndex();
const retrieval = createCodexProviderWebRetrievalFetcher({
  cache: createCodexProviderLocalIndexingWebRetrievalCache({
    cache: createCodexProviderMemoryWebRetrievalCache(),
    index: localIndex,
  }),
});

const webSearch = createCodexProviderWebSearchExecutor({
  mode: "balanced",
  engines: [
    createCodexProviderLocalIndexSearchEngine({ index: localIndex, name: "local-cache" }),
    createCodexProviderDuckDuckGoHtmlEngine(),
  ],
  retrieval,
  fetchPages: true,
});
```

Deep search is opt-in and should be exposed as a separate custom hosted tool, not as the default `web_search`.

```ts
const research = createCodexProviderDeepWebSearchExecutor({
  search: createCodexProviderMetaSearchService({
    engines: [
      createCodexProviderDuckDuckGoHtmlEngine(),
      createCodexProviderBraveHtmlEngine(),
    ],
    mode: "balanced",
  }),
  maxSubqueries: 4,
  maxSources: 20,
});
```

## Local Vector File Search

Use explicit roots and an explicit embedding provider.

```ts
const fileSearch = createCodexProviderFileSearchExecutor({
  sources: [{
    type: "local-vector",
    roots: [workspaceRoot],
    embeddingProvider: createCodexProviderEmbeddingsApiProvider({
      apiKey: process.env.EMBEDDINGS_API_KEY,
      endpoint: process.env.EMBEDDINGS_API_ENDPOINT,
      model: process.env.EMBEDDINGS_MODEL,
    }),
  }],
});
```

The package does not scan the process working directory implicitly. Hosts must decide which roots are safe.

## Unsafe Tool Policy

`code_interpreter`, `computer`, shell-like tools, and any real environment-control surface require a host-owned executor and safety policy. The provider adapter package only defines contracts and output normalization.

## Standalone Server Env

Use the new prefix for new deployments:

```bash
CODEX_PROVIDER_CAPABILITY_PRESET=openrouter
CODEX_PROVIDER_API_KEY=...
CODEX_PROVIDER_MODEL=deepseek/deepseek-chat
CODEX_PROVIDER_TRACE=stderr-json
codex-provider-server
```

## Release Validation

Before publishing or wiring a new host application, review:

- [Live smoke recipes](LIVE_SMOKE_RECIPES.md)
- [Unsafe tool security](UNSAFE_TOOL_SECURITY.md)
- [Release readiness](RELEASE_READINESS.md)
