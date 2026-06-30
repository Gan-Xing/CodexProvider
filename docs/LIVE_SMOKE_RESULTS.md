# Live Smoke Results

This file records redacted live smoke evidence for `codex-provider`.

## Current Evidence Summary

As of 2026-06-30, full host-integration live evidence is recorded for:

- OpenRouter with `deepseek/deepseek-chat`: mixed runtime, normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- DeepSeek official with `deepseek-chat`: mixed runtime, normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- DashScope/Qwen with `qwen-plus`: mixed runtime, normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.

API-backed SerpApi web_search evidence is recorded. Additional Brave/Serper/Tavily search records and remaining provider-preset records remain credential-gated. Secrets are redacted; raw API keys are never recorded here.

## 2026-06-30 SerpApi Search Evidence Update

- `SERPAPI_API_KEY` was configured in the local ignored `.env`.
- `pnpm smoke:web-search` passed with `CODEX_PROVIDER_WEB_SEARCH_PROVIDER=serpapi`, `DEEPSEEK_API_KEY=<redacted>`, and `deepseek-chat`.
- This closes the API-backed web_search evidence blocker for the current public-alpha audit. The package now uses the unscoped `codex-provider` npm name, so npm organization ownership is no longer required.

## 2026-06-30 Public Alpha Blocker Audit

- npm auth update: `npm whoami` now passes as `ganxing` after browser-assisted CLI login on the server.
- Earlier scoped-package check returned `E404 Scope not found`; the project now uses the unscoped `codex-provider` package name instead.
- npm package: `npm view codex-provider --json` returned `E404 Not found`; the unscoped package is not publicly visible yet and is available for first publish.
- API-backed search credentials were missing at the time of this blocker audit; later in this cycle `SERPAPI_API_KEY` became available and the SerpApi smoke evidence below closed the search-evidence blocker.
- Third-provider evidence: `DEEPSEEK_API_KEY` was available in local `.env` and the DeepSeek official full-host smoke passed at `2026-06-30T16:29:29.940Z`; SiliconFlow, MiniMax, Moonshot/Kimi, and OpenAI direct Responses remain credential-gated.

## 2026-06-30 npm Scope Login Update

- `npm whoami` passed as `ganxing` after server-side CLI web login.
- Authenticated scoped-package org/team checks still returned `E404`, so the release path moved away from an npm organization.
- Authenticated `npm view codex-provider --json` returned `E404 Not found`.
- Follow-up decision: use the unscoped `codex-provider` package name instead of creating an npm organization. Search evidence and npm login are no longer blockers.

## 2026-06-30 Public Alpha Publish

- `codex-provider@0.1.0-alpha.0` was published to npm with `npm publish --tag alpha`.
- npm browser 2FA authorization was required and completed.
- `npm view codex-provider version dist-tags --json` returns `0.1.0-alpha.0` with `alpha` and `latest` pointing at the published version.
- Source tag: `v0.1.0-alpha.0` at commit `6514cf0`.

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

## 2026-06-10T23:46:21.463Z Recursive quality Cycle 1 smoke credential audit

- Upstream credentials: not set in the execution environment.
- API-backed web search credentials: `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, and `TAVILY_API_KEY` not set.
- Endpoint search credentials: `SEARXNG_ENDPOINT` and `OPENSERP_ENDPOINT` not set.
- Secrets: no values recorded.

| Smoke | Status | Notes |
| --- | --- | --- |
| `pnpm smoke:web-search` | Skipped live upstream | Script built successfully, verified offline local-index `web_search`, then skipped because upstream provider credentials were missing. |
| API-backed Brave/SerpApi/Serper/Tavily web_search | [!] Pending credentials | Not run because the corresponding API keys were absent. |
| `pnpm smoke:host` | Skipped live upstream | Script built and dry-run packed successfully, then skipped because upstream provider credentials were missing. |

## 2026-06-11T10:23:30.494Z Adapter-emulated web_search live smoke

- Provider base URL host: `144.217.243.161:8320`
- Model: `gpt-5.3-codex-spark`
- Search provider: `builtin-metasearch`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search credential: `not set; built-in no-key metasearch`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Offline local-index path | Passed | Direct executor request used `external_web_access=false` and returned the seeded local-cache result. |
| Non-streaming adapter web_search | Passed | web_search_call sources: 5; results: 5; annotations: 1; latency: 5133 ms. |
| Streaming adapter web_search | Passed | SSE events: 14; web_search_call sources: 5; results: 5; annotations: 1; latency: 8816 ms. |

## 2026-06-11T10:24:07.343Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `144.217.243.161:8320`
- Model: `gpt-5.3-codex-spark`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `CODEX_PROVIDER_API_KEY=<redacted>`
- Search provider: `builtin-metasearch`
- Search key env: `<not set; built-in no-key metasearch>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:40841. |
| Normal response | Passed | Latency: 1995 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 2318 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 1597 ms. |
| Adapter-emulated web_search | Passed | Sources: 5; results: 5; annotations: 1; latency: 6262 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 14; sources: 5; results: 5; annotations: 1; latency: 5870 ms. |

## 2026-06-11T14:55:03.866Z Adapter-emulated web_search live smoke

- Provider base URL host: `dashscope-us.aliyuncs.com`
- Model: `qwen3.6-plus`
- Search provider: `builtin-metasearch`
- Upstream key env: `QWEN_API_KEY=<redacted>`
- Search credential: `not set; built-in no-key metasearch`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Offline local-index path | Passed | Direct executor request used `external_web_access=false` and returned the seeded local-cache result. |
| Non-streaming adapter web_search | Passed | web_search_call sources: 1; results: 1; annotations: 1; latency: 12736 ms. |
| Streaming adapter web_search | Passed | SSE events: 26; web_search_call sources: 1; results: 1; annotations: 1; latency: 8396 ms. |

## 2026-06-11T14:55:53.145Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `dashscope-us.aliyuncs.com`
- Model: `qwen3.6-plus`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `QWEN_API_KEY=<redacted>`
- Search provider: `builtin-metasearch`
- Search key env: `<not set; built-in no-key metasearch>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:43071. |
| Normal response | Passed | Latency: 10736 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 11621 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 3892 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 7183 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 25; sources: 1; results: 1; annotations: 1; latency: 5668 ms. |

## 2026-06-29T23:20:33.021Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `dashscope-us.aliyuncs.com`
- Model: `qwen-plus`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `QWEN_API_KEY=<redacted>`
- Search provider: `builtin-metasearch`
- Search key env: `<not set; built-in no-key metasearch>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:40023. |
| Normal response | Passed | Latency: 1434 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 1684 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 1868 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 4865 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 25; sources: 6; results: 6; annotations: 1; latency: 6125 ms. |

## 2026-06-30T16:29:29.940Z CodexProviderRuntime live host integration smoke

- Provider base URL host: `api.deepseek.com`
- Model: `deepseek-chat`
- Runtime mode: `mixed`
- Tool strategy: `adapter-emulated`
- Upstream key env: `DEEPSEEK_API_KEY=<redacted>`
- Search provider: `builtin-metasearch`
- Search key env: `<not set; built-in no-key metasearch>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime local adapter | Passed | Adapter base URL host: 127.0.0.1:41479. |
| Normal response | Passed | Latency: 1108 ms. |
| Custom tool loop | Passed | First turn produced echo_probe; second turn returned final text. Latency: 2382 ms. |
| Adapter-emulated file_search | Passed | Results: 1; first filename: host-smoke.md; latency: 2589 ms. |
| Adapter-emulated web_search | Passed | Sources: 1; results: 1; annotations: 1; latency: 3712 ms. |
| Streaming adapter-emulated web_search | Passed | SSE events: 62; sources: 1; results: 1; annotations: 1; latency: 3461 ms. |

## 2026-06-30T17:06:48.247Z Adapter-emulated web_search live smoke

- Provider base URL host: `api.deepseek.com`
- Model: `deepseek-chat`
- Search provider: `serpapi`
- Upstream key env: `DEEPSEEK_API_KEY=<redacted>`
- Search credential: `SERPAPI_API_KEY=<redacted>`
- Secrets: redacted; sourced from environment variables.

| Smoke | Status | Notes |
| --- | --- | --- |
| Offline local-index path | Passed | Direct executor request used `external_web_access=false` and returned the seeded local-cache result. |
| Non-streaming adapter web_search | Passed | web_search_call sources: 1; results: 1; annotations: 1; latency: 5332 ms. |
| Streaming adapter web_search | Passed | SSE events: 46; web_search_call sources: 1; results: 1; annotations: 1; latency: 5138 ms. |
