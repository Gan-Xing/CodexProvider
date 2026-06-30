# Live Smoke Recipes

These recipes are for validating `codex-provider` against real upstream services before public packaging.

Historical package names are documented only in archived migration notes. Active smoke recipes use canonical `codex-provider` package behavior.

Live smoke tests are intentionally manual or opt-in. They require provider credentials, may call paid APIs, and should never run in ordinary unit test flows.

## Environment

Run from the repository root unless noted otherwise.

```bash
export OPENROUTER_API_KEY=...
export OPENROUTER_MODEL=deepseek/deepseek-chat
export DEEPSEEK_API_KEY=...
export DEEPSEEK_MODEL=deepseek-chat
export QWEN_API_KEY=...
export QWEN_MODEL=qwen-plus
export TAVILY_API_KEY=...
export BRAVE_SEARCH_API_KEY=...
export SERPAPI_API_KEY=...
export SERPER_API_KEY=...
export CODEX_PROVIDER_WEB_SEARCH_PROVIDER=builtin-metasearch
export EMBEDDINGS_API_KEY=...
export EMBEDDINGS_API_ENDPOINT=https://openrouter.ai/api/v1/embeddings
export EMBEDDINGS_MODEL=qwen/qwen3-embedding-8b
```

The web-search API keys are optional unless `CODEX_PROVIDER_WEB_SEARCH_PROVIDER` explicitly selects `brave`, `serpapi`, `serper`, or `tavily`. The embedding endpoint/model are defaults only. Any OpenAI-compatible embeddings API can be used.

Current recorded full-host evidence covers OpenRouter with `deepseek/deepseek-chat`, DeepSeek official with `deepseek-chat`, and DashScope/Qwen with `qwen-plus`. Other provider records and API-backed Brave/SerpApi/Serper/Tavily search are credential-gated until their keys are present.

## Smoke 1: Mixed Runtime

Goal: verify a non-OpenAI Chat Completions provider can be exposed to Codex as a local Responses-compatible adapter.

```bash
pnpm build
node dist/cli.js \
  --env-file .env.live-openai-compatible.local
```

Expected:

- Server starts and prints a local base URL.
- `GET /v1/models` returns a non-empty model list.
- `POST /v1/responses` translates a simple text request and returns a Responses-shaped object.

## Smoke 2: Adapter-Emulated Self-Hosted Web Search

Goal: verify `web_search` is explicit, executor-backed, self-hosted through CodexProvider metasearch, and does not silently call live search when `external_web_access` is disabled.

Use `examples/adapter-emulated-web-search-metasearch.ts` as the primary wiring reference. `examples/adapter-emulated-web-search.ts` remains a smaller Tavily-only baseline.

For an end-to-end smoke against a real OpenAI-compatible upstream plus live web search, run:

```bash
pnpm smoke:web-search
```

The script requires an upstream key (`CODEX_PROVIDER_API_KEY` or a supported provider preset key) and an upstream base URL/model unless they can be inferred. Search credentials are optional: it prefers `SEARXNG_ENDPOINT` / `OPENSERP_ENDPOINT`, then `BRAVE_SEARCH_API_KEY` / `SERPAPI_API_KEY` / `SERPER_API_KEY` / `TAVILY_API_KEY`, and otherwise uses the built-in no-key HTML metasearch engines.

To force a specific web search provider, set:

```bash
CODEX_PROVIDER_WEB_SEARCH_PROVIDER=brave BRAVE_SEARCH_API_KEY=... pnpm smoke:web-search
CODEX_PROVIDER_WEB_SEARCH_PROVIDER=serpapi SERPAPI_API_KEY=... pnpm smoke:web-search
CODEX_PROVIDER_WEB_SEARCH_PROVIDER=serper SERPER_API_KEY=... pnpm smoke:web-search
CODEX_PROVIDER_WEB_SEARCH_PROVIDER=tavily TAVILY_API_KEY=... pnpm smoke:web-search
CODEX_PROVIDER_WEB_SEARCH_PROVIDER=builtin-metasearch pnpm smoke:web-search
```

If the selected API-backed provider is missing its API key, the smoke records a clear skip instead of fabricating evidence.

Expected:

- `{ name: "web_search", mode: "adapter-emulated" }` is declared.
- `hostedToolExecutors.web_search` is registered.
- Endpoint engines are used when `SEARXNG_ENDPOINT` or `OPENSERP_ENDPOINT` is present.
- API engines are used when `BRAVE_SEARCH_API_KEY`, `SERPAPI_API_KEY`, `SERPER_API_KEY`, or `TAVILY_API_KEY` is present and endpoint engines are not configured.
- `CODEX_PROVIDER_WEB_SEARCH_PROVIDER` overrides automatic endpoint/API/no-key selection for Brave, SerpApi, Serper, Tavily, or built-in metasearch.
- HTML engines provide best-effort live search when endpoint and API credentials are absent.
- A live query returns `results`, `sources`, `documents` or `chunks`, and `retrieved_at`.
- A Responses request can expose synthetic `web_search_call` output when requested through `include`; UI checks should prefer `web_search_call.action.sources` for consulted URLs and treat `web_search_call.results` as adapter/debug compatibility data.
- A request with `external_web_access: false` only uses offline/cache engines such as the local index.
- `custom:deep_web_search` is opt-in and separate from the default `web_search` declaration.

## Smoke 3: Adapter-Emulated File Search Local Vector

Goal: verify local-vector indexing, cache reuse, and OpenAI-compatible search result output.

Use `examples/adapter-emulated-file-search-local-vector.ts` as the wiring reference.

Expected:

- Roots are explicit. The process working directory is not scanned implicitly.
- First query chunks files and calls the embedding provider.
- Second query reuses cached document/chunk embeddings.
- Result content uses `data[]` entries with `file_id`, `filename`, `score`, `attributes`, and `content[]`.
- A Responses request with `include: ["file_search_call.results"]` exposes a `file_search_call` item in `output`.

## Smoke 4: Real Host Integration

Goal: verify the packaged root entrypoint can drive a real non-OpenAI OpenAI-compatible Chat Completions provider through `CodexProviderRuntime` mixed mode and the local `/v1/responses` adapter.

```bash
pnpm smoke:host
```

The script builds the package, runs `npm pack --dry-run`, starts `CodexProviderRuntime` in `mixed` mode, and validates:

- A normal `/v1/responses` request.
- A custom tool call / custom tool output continuation loop.
- Adapter-emulated `file_search` with `include: ["file_search_call.results"]`.
- Adapter-emulated `web_search` with `include: ["web_search_call.action.sources", "web_search_call.results"]`.
- Streaming adapter-emulated `web_search` through SSE.

Required:

- An upstream key through `CODEX_PROVIDER_API_KEY`, `OPENROUTER_API_KEY`, `DASHSCOPE_API_KEY`, `QWEN_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`, or `KIMI_API_KEY`.
- `CODEX_PROVIDER_BASE_URL` and `CODEX_PROVIDER_MODEL` unless the script can infer them from the provider key.

Optional:

- `SEARXNG_ENDPOINT` or `OPENSERP_ENDPOINT` for a self-hosted search endpoint.
- `BRAVE_SEARCH_API_KEY`, `SERPAPI_API_KEY`, `SERPER_API_KEY`, or `TAVILY_API_KEY` for API-backed web search.
- Without endpoint or API credentials, the smoke uses built-in no-key HTML metasearch engines and still requires live results outside the local cache.

## Smoke 5: Image Generation Contract

Goal: verify the provider adapter can call a host-provided image provider without bundling a default one.

Use `examples/adapter-emulated-image-generation.ts` as the wiring reference.

Expected:

- No image provider is active unless `createCodexProviderImageGenerationExecutor()` is registered.
- The provider receives prompt/options.
- Optional `include: ["image_generation_call.results"]` exposes `image_generation_call` output.

## Smoke 6: Unsafe Tool Refusal By Default

Goal: verify unsafe tools cannot run unless a host explicitly supplies an executor.

Validate:

- `code_interpreter` without executor is not exposed or fails clearly.
- `computer` without executor is not exposed or fails clearly.
- Shell-like execution is not provided by this package.

## Required Evidence Before Public Release

For each live smoke, record:

- Provider and model.
- Date.
- Environment variables used, with secrets redacted.
- Request shape.
- Response shape.
- Any provider-specific incompatibility.
- Cost/latency notes.

Do not commit real API keys, local absolute paths containing private user data, or raw provider payloads that include secrets.
