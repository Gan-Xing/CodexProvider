# Live Smoke Recipes

These recipes are for validating `@codex-provider/core` against real upstream services before public packaging.

Historical names under `@codexbridge/codex-provider` and `codex-provider-server` remain as deprecated aliases during the stabilization cycle.

Live smoke tests are intentionally manual or opt-in. They require provider credentials, may call paid APIs, and should never run in ordinary unit test flows.

## Environment

Run from the repository root unless noted otherwise.

```bash
export OPENROUTER_API_KEY=...
export OPENROUTER_MODEL=deepseek/deepseek-chat
export TAVILY_API_KEY=...
export BRAVE_SEARCH_API_KEY=...
export SERPER_API_KEY=...
export EMBEDDINGS_API_KEY=...
export EMBEDDINGS_API_ENDPOINT=https://openrouter.ai/api/v1/embeddings
export EMBEDDINGS_MODEL=qwen/qwen3-embedding-8b
```

The web-search API keys are optional unless the recipe explicitly uses the Tavily-only baseline example. The embedding endpoint/model are defaults only. Any OpenAI-compatible embeddings API can be used.

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

Expected:

- `{ name: "web_search", mode: "adapter-emulated" }` is declared.
- `hostedToolExecutors.web_search` is registered.
- API engines are used when `BRAVE_SEARCH_API_KEY` or `SERPER_API_KEY` is present.
- HTML engines still provide best-effort live search when search API keys are absent.
- A live query returns `results`, `sources`, `documents` or `chunks`, and `retrieved_at`.
- A Responses request can expose synthetic `web_search_call` output when requested through `include`.
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

## Smoke 4: Image Generation Contract

Goal: verify the provider adapter can call a host-provided image provider without bundling a default one.

Use `examples/adapter-emulated-image-generation.ts` as the wiring reference.

Expected:

- No image provider is active unless `createCodexProviderImageGenerationExecutor()` is registered.
- The provider receives prompt/options.
- Optional `include: ["image_generation_call.results"]` exposes `image_generation_call` output.

## Smoke 5: Unsafe Tool Refusal By Default

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
