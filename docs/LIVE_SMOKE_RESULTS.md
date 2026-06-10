# Live Smoke Results

This file records redacted live smoke evidence for `@codex-provider/core`.

## 2026-06-07 OpenRouter non-web smoke

- Date: 2026-06-07T20:42:29.450Z
- Provider: OpenRouter
- Model: `deepseek/deepseek-chat`
- Embeddings provider: OpenRouter-compatible embeddings endpoint
- Embeddings model: `qwen/qwen3-embedding-8b`
- Web search: skipped intentionally for this run
- Secrets: redacted; sourced from local `.env`

### Environment

```json
{
  "OPENROUTER_API_KEY": "<redacted>",
  "OPENROUTER_BASE_URL": "<redacted>",
  "OPENROUTER_MODEL": "<redacted>",
  "EMBEDDINGS_API_KEY": "<redacted>",
  "EMBEDDINGS_API_ENDPOINT": "<redacted>",
  "EMBEDDINGS_MODEL": "<redacted>"
}
```

### Results

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime | Passed | `POST /v1/responses` returned a Responses-shaped object with one output item. Latency: 1128 ms. |
| Custom tool loop | Passed | Forced `adapter_echo` produced a `function_call`, then accepted `function_call_output` and returned a final answer. Latencies: 2441 ms + 782 ms. |
| Adapter-emulated file_search, memory source | Passed | `include: ["file_search_call.results"]` exposed a completed `file_search_call`; first result filename: `smoke.md`. Latency: 6413 ms. |
| Local-vector file_search direct executor | Passed | Local-vector source chunked repository files, called embeddings, and returned 3 results. First result filename: `codexnext-integration.ts`. Latency: 70568 ms. |
| Unsafe tools without executors | Passed | `code_interpreter` and `computer` were not exposed as adapter tools without explicit executors. Both requests returned non-500 Responses-compatible results. |

### Provider-specific notes

- `google/gemini-3.1-pro-preview` through OpenRouter did not produce a forced tool call in this smoke; it returned reasoning output only. The live tool-loop smoke was rerun with `deepseek/deepseek-chat` and passed.
- The local-vector smoke is slower than the other checks because it performs live embeddings over repository chunks. This is expected for a cold run without a persistent on-disk vector cache.

### Coverage notes

- `web_search` live smoke has evidence below through built-in no-key metasearch. Endpoint/API-backed search credentials remain optional for additional coverage.
- Real host integration smoke has live evidence below. Current verified paths use OpenRouter with `deepseek/deepseek-chat`, adapter-emulated hosted tools, and both local-index and built-in no-key metasearch web_search coverage.
- A future CodexNext tarball/file dependency smoke should validate a real host app consuming the package when that host workspace is available.

## 2026-06-09T17:48:09.853Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search provider: `local-index`
- Search key env: `<not set; local-index>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:34747. |
| Normal response | Passed | Latency: 1775 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 4430 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 4883 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 4639 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 28; sources: 1; results: 1; annotations: 1; latency: 4531 ms. |

## 2026-06-09T19:45:58.961Z Adapter-emulated web_search live smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Search provider: `builtin-metasearch`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search credential: `not set; built-in no-key metasearch`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Offline local-index path | Passed | Direct executor request used `external_web_access=false` and returned the seeded local-cache result. |
| Non-streaming adapter web_search | Passed | web_search_call sources: 1; results: 1; annotations: 1; latency: 7358 ms. |
| Streaming adapter web_search | Passed | SSE events: 24; web_search_call sources: 1; results: 1; annotations: 1; latency: 6838 ms. |

## 2026-06-09T20:18:40.909Z Adapter-emulated web_search live smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Search provider: `builtin-metasearch`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search credential: `not set; built-in no-key metasearch`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Offline local-index path | Passed | Direct executor request used `external_web_access=false` and returned the seeded local-cache result. |
| Non-streaming adapter web_search | Passed | web_search_call sources: 1; results: 1; annotations: 1; latency: 7703 ms. |
| Streaming adapter web_search | Passed | SSE events: 37; web_search_call sources: 1; results: 1; annotations: 1; latency: 6804 ms. |

## 2026-06-09T20:19:16.358Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search provider: `local-index`
- Search key env: `<not set; local-index>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:40219. |
| Normal response | Passed | Latency: 1143 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 4608 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 3904 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 4847 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 30; sources: 1; results: 1; annotations: 1; latency: 4433 ms. |

## 2026-06-09T20:22:25.619Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search provider: `builtin-metasearch`
- Search key env: `<not set; built-in no-key metasearch>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:33699. |
| Normal response | Passed | Latency: 1814 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 3984 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 4262 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 6604 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 67; sources: 1; results: 1; annotations: 1; latency: 7185 ms. |

## 2026-06-10T08:58:06.025Z Adapter-emulated web_search live smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Search provider: `builtin-metasearch`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search credential: `not set; built-in no-key metasearch`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Offline local-index path | Passed | Direct executor request used `external_web_access=false` and returned the seeded local-cache result. |
| Non-streaming adapter web_search | Passed | web_search_call sources: 1; results: 1; annotations: 1; latency: 6912 ms. |
| Streaming adapter web_search | Passed | SSE events: 27; web_search_call sources: 1; results: 1; annotations: 1; latency: 6381 ms. |

## 2026-06-10T08:58:44.001Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search provider: `builtin-metasearch`
- Search key env: `<not set; built-in no-key metasearch>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:43083. |
| Normal response | Passed | Latency: 1649 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 4327 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 4229 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 6553 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 23; sources: 1; results: 1; annotations: 1; latency: 5497 ms. |

## 2026-06-10T21:54:34.347Z Adapter-emulated web_search live smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Search provider: `builtin-metasearch`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search credential: `not set; built-in no-key metasearch`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Offline local-index path | Passed | Direct executor request used `external_web_access=false` and returned the seeded local-cache result. |
| Non-streaming adapter web_search | Passed | web_search_call sources: 1; results: 1; annotations: 1; latency: 7036 ms. |
| Streaming adapter web_search | Passed | SSE events: 25; web_search_call sources: 1; results: 1; annotations: 1; latency: 6573 ms. |

## 2026-06-10T21:55:15.241Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `openrouter.ai`
- Model: `deepseek/deepseek-chat`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search provider: `builtin-metasearch`
- Search key env: `<not set; built-in no-key metasearch>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:38763. |
| Normal response | Passed | Latency: 1712 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 3384 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 5169 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 6296 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 23; sources: 1; results: 1; annotations: 1; latency: 5957 ms. |
