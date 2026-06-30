# CodexProvider Architecture & Tool Parity Review Handoff

## Context

Repository: `Gan-Xing/CodexProvider`

This handoff reviews the current CodexProvider architecture after the latest rename/refactor updates and defines the next phased plan toward:

1. Making `@codex-provider/core` independently packageable.
2. Letting Codex use non-OpenAI provider API keys through the local Responses adapter.
3. Hardening adapter-emulated `web_search` so it can replace OpenAI hosted web search for non-OpenAI upstreams.
4. Hardening `file_search` as a separate private/local/document retrieval tool without colliding with `web_search`.
5. Preparing the project for real live smoke validation and, later, public release.

This handoff focuses on project readiness and the next implementation phases. It does **not** ask the next agent to rewrite the whole architecture.

---

## 1. Current State Summary

### 1.1 Package identity is now clean

Current `package.json` is already using the target package name:

```json
{
  "name": "@codex-provider/core",
  "version": "0.1.0-alpha.0",
  "private": true
}
```

The active bin surface has also been cleaned to:

```json
"bin": {
  "codex-provider-server": "./dist/cli.js"
}
```

No historical provider/server bin alias remains.

This is the correct direction. Keep `private: true` for now.

### 1.2 Root exports are now canonical

`src/index.ts` now exports the canonical package surface directly:

```ts
export * from './codex_config.js';
export * from './builtin-tools/index.js';
export * from './code_interpreter_executor.js';
export * from './computer_executor.js';
export * from './file_search_executor.js';
export * from './hosted_tool_executors.js';
export * from './hosted_tools.js';
export * from './image_generation_executor.js';
export * from './profiles.js';
export * from './runtime.js';
export * from './target.js';
export * from './tool_search_executor.js';
export * from './web-search/index.js';
```

The old alias file is no longer exported. This means `CodexProvider*` is no longer just a deprecated alias layer. That is a major milestone.

### 1.3 Responses adapter has been split correctly

The old `src/converters/responses_adapter.ts` has been replaced by a modular entrypoint:

```ts
export * from './types.js';
export * from './request-to-chat/index.js';
export * from './chat-to-responses/index.js';
export * from './sse/index.js';
```

The server side also moved to:

```text
src/server/responses-adapter-server/
```

with separate modules for:

```text
server.ts
responses-handler.ts
adapter-hosted-tools.ts
adapter-hosted-tool-loop.ts
adapter-hosted-tool-streaming-loop.ts
hosted-tool-output.ts
streaming-response.ts
synthetic-sse.ts
retry.ts
upstream.ts
models.ts
errors.ts
```

This is a good architecture. Do not collapse it back into one file.

### 1.4 Hosted tool model is now explicit

The package has a clean hosted tool declaration model:

```ts
export type CodexProviderHostedToolMode =
  | 'provider-native'
  | 'adapter-emulated';
```

`adapter-emulated` tools require explicit declarations and registered executors. This is the right model for replacing OpenAI hosted tools when the upstream provider only supports Chat Completions/function calling.

### 1.5 Web search has advanced significantly

Current `src/web-search/index.ts` exports:

```text
deep/
engines/
local-index/
metasearch/
openai/
retrieval/
```

The top-level factory chooses between:

```ts
createCodexProviderOpenAiWebSearchExecutor(...)
createCodexProviderSourceWebSearchExecutor(...)
```

The metasearch layer already has:

```text
engine
engine-state
errors
processor
registry
result-container
merge
dedupe
score
modes
search-service
```

Search modes already include:

```ts
fast | any | balanced | exhaustive
```

Search engine adapters include:

```text
brave-html
brave-api
duckduckgo-html
ecosia-html
mojeek-html
openserp-endpoint
serper-api
searxng-endpoint
tavily-api
```

The retrieval layer includes:

```text
cache
chunker
content-type
fetcher
html-extractor
ranker
redirects
safety
```

The OpenAI-compatible web search layer includes:

```text
request
executor
tool-output
web-search-call
annotations
placeholders
```

This is now recognizably a TypeScript-native MetaSearch + Web Retrieval Runtime.

### 1.6 File search is strong

`file_search` is now modular:

```text
src/file-search/types.ts
src/file-search/stores.ts
src/file-search/embeddings.ts
src/file-search/sources.ts
src/file-search/executor.ts
```

It supports:

```text
local-fs
memory-documents
sqlite-fts
in-memory-vector
local-vector
vector-store adapter
remote-documents adapter
```

The executor outputs OpenAI-like:

```ts
object: 'vector_store.search_results.page'
data
search_results
has_more
next_page
vector_store_ids
ranking_options
```

It supports metadata filters, vector store ids mapped to source names, include content, ranking options, and bounded payloads.

---

## 2. Architecture Assessment

### 2.1 Is the architecture reasonable?

Yes. The current architecture is now reasonable and aligns with the product target:

```text
Codex app-server
  -> Responses request
  -> CodexProvider local Responses adapter
  -> upstream Chat Completions / Responses provider
  -> adapter-emulated hosted tools when needed
  -> translated Responses output / SSE
```

The package boundary is also much healthier:

- Package root is independent.
- No active `Relay/Gateway` naming remains in active API.
- Runtime can start its own adapter server.
- Hosted tools are explicit.
- Unsafe tools have no bundled default executor.
- Web search and file search are separate modules.
- No runtime dependency explosion is visible in `package.json`.

### 2.2 Is it ready to become an independent package?

It is **close for internal alpha** but **not ready for public npm release**.

Reasons:

1. `package.json` still has `"private": true`, which is intentional.
2. `docs/INDEPENDENT_PACKAGE_CHECKLIST.md` still lists incomplete release gates:
   - live smoke recipes against real upstream providers are not fully recorded;
   - changelog policy and npm release workflow are undecided.
3. `docs/LIVE_SMOKE_RESULTS.md` records non-web OpenRouter smoke, but explicitly says `web_search` live smoke is pending.
4. `docs/RELEASE_READINESS.md` still has some stale language about deprecated aliases. This should be cleaned because active code has moved past that state.

Recommended status label:

```text
Internal alpha / architecture-ready / release-blocked by live smoke and release workflow.
```

### 2.3 Can it adapt OpenAI API shape to other providers?

For OpenAI-compatible Chat Completions upstreams: **yes, structurally.**

The code path exists:

```text
Responses request
  -> responsesRequestToChatCompletions
  -> upstream Chat Completions
  -> optional hosted tool loop
  -> chatCompletionsResponseToResponses
  -> Responses object / SSE
```

For upstream providers that support Responses natively: direct proxy also exists through `upstreamResponsesPath`.

For actual Codex API key replacement:

- In `mixed` or `pure-api` mode, the local adapter lets Codex point to a local Responses-compatible endpoint while CodexProvider owns the third-party upstream API key.
- `CodexProviderRuntime` starts a local adapter server and returns Codex config with local `base_url` for Chat Completions upstreams.
- This is enough for DeepSeek/OpenRouter/Qwen-style OpenAI-compatible providers, assuming their tool-calling behavior is compatible.

What is still missing:

- real upstream live smoke for `web_search`;
- a CodexNext or real Codex app-server end-to-end smoke with a tarball/file dependency;
- provider-specific model capability presets for forced tool call quirks.

---

## 3. Web Search Assessment

### 3.1 What is already good

Current web search is no longer a simple API wrapper. It already has:

1. Native metasearch service.
2. Search modes: `fast`, `any`, `balanced`, `exhaustive`.
3. HTML engines: DuckDuckGo, Brave, Ecosia, Mojeek.
4. API engines: Brave API, SerpApi, Serper, Tavily.
5. Endpoint adapters: SearXNG, OpenSERP.
6. Retrieval with safe fetch.
7. HTML extraction, chunking, ranking.
8. Local web index and cache-index integration.
9. `external_web_access=false` offline/cache path.
10. Synthetic `web_search_call`.
11. Placeholder citation postprocessing into `url_citation` annotations.
12. Streaming response tests for `web_search_call`.

This is the right architecture.

### 3.2 OpenAI parity status

OpenAI's current web search behavior includes:

```text
web_search_call output item
web_search_call.action.type = search | open_page | find_in_page
message.content[0].annotations url_citation
include: ["web_search_call.action.sources"]
filters.allowed_domains / blocked_domains
search_context_size
user_location
return_token_budget: "default" | "unlimited"
```

CodexProvider currently covers:

```text
web_search_call: yes
action.type = search: yes
action.sources include: yes
results include: yes
url_citation placeholder annotations: yes
filters: internal support exists
search_context_size: yes
external_web_access: yes
user_location: partial/pass-through
retrieval/open-page behavior: internally yes, but output only search action
```

Major parity gaps:

1. `return_token_budget` is still modeled as `number | null` in `src/web-search/openai/request.ts` and `src/web-search/types.ts`.
   - OpenAI supports only `"default"` and `"unlimited"`.
   - Numbers are rejected by OpenAI.
   - This must be fixed.

2. `WEB_SEARCH_TOOL_PARAMETERS` schema still only exposes:
   - `query`
   - `search_context_size`
   - `user_location`

   It should also expose:
   - `filters`
   - `external_web_access`
   - `return_token_budget`
   - optional `mode`
   - optional `max_results` / `max_num_results` if you keep those extensions

3. Synthetic `web_search_call` currently always emits one aggregate `search` action.
   - OpenAI can emit `open_page` and `find_in_page` actions for reasoning models.
   - CodexProvider internally retrieves pages, but does not yet expose separate action items.
   - This is acceptable for MVP, but not full parity.

4. Live smoke for `web_search` is still pending.
   - Unit tests prove adapter behavior.
   - They do not prove live Brave/SerpApi/Serper/Tavily/HTML engine behavior against real provider/model tool loops.

### 3.3 Web search next improvements

Priority order:

1. Fix OpenAI protocol fields:
   - `return_token_budget`
   - schema
   - include behavior
   - citation span behavior
2. Add live smoke:
   - one API engine path, e.g. Brave API or Serper
   - one no-key HTML engine path if acceptable
   - one `external_web_access=false` local index path
3. Improve `web_search_call` action fidelity:
   - emit aggregate `search`
   - optionally emit `open_page` actions for retrieved pages
   - optionally emit `find_in_page` actions for ranked chunks
4. Improve engine robustness:
   - fixture snapshots for every engine
   - blocked/captcha classification
   - engine suspension tests
   - parser fallback selectors
5. Add domain policy controls:
   - allowed/blocked domains already exist, but add max 100 validation and clear errors.
6. Add page retrieval privacy/safety documentation:
   - no file_search sources are used by web_search by default.
   - web local index only stores fetched/cached web pages.
7. Add provider capability presets:
   - known upstreams that do or do not handle forced function tool calls well.
8. Add a real Codex/CodexNext integration smoke.

---

## 4. File Search Assessment

### 4.1 What is already good

File search is strong and separate from web search.

It supports:

```text
local-fs source
memory-documents source
sqlite-fts source
remote-documents source
vector-store source contract
in-memory-vector source
local-vector source
memory local vector index
sqlite local vector index through injected database adapter
embedding provider abstraction
OpenAI-compatible result shape
include_content
filters
ranking_options
vector_store_ids source selection
payload limits
byte limits
source counts
scanned/skipped file counts
```

The result output already looks like OpenAI vector-store search results:

```ts
object: 'vector_store.search_results.page'
data
search_results
has_more
next_page
vector_store_ids
ranking_options
```

### 4.2 File search gaps

1. Pagination is not complete.
   - `has_more` can be true.
   - `next_page` is always null.
   - If OpenAI-like pagination matters, add stable page tokens.

2. Source ids are mapped through `vector_store_ids`, but this is package-specific.
   - Document it clearly.
   - Add examples showing `vector_store_ids: ["repo", "docs"]`.

3. More filter tests should be added.
   - nested `and/or`
   - array metadata comparisons
   - missing key behavior
   - numeric comparisons
   - `property` alias

4. Hybrid scoring is functional but should be documented.
   - Explain `embedding_weight` and `text_weight`.
   - Show RRF/hybrid behavior in examples.

5. Persistent local vector cache is adapter-based.
   - Good for dependency policy.
   - But provide a stronger SQLite example with a tiny in-memory fake adapter and a real host-injected adapter example.

6. Separation from `web_search` must be explicit.
   - Web local index must not read file_search sources by default.
   - Future hybrid retrieval should be a separate explicit tool/option.

---

## 5. Can this replace Codex's OpenAI API key for other vendors?

### Short answer

For non-OpenAI upstreams that expose OpenAI-compatible Chat Completions and tool calling: **yes, the architecture is now capable.**

For production confidence: **not yet fully proven until live smoke is recorded for the provider/model combinations you care about.**

### What works in code

1. Runtime can start a local Responses adapter server.
2. Profile modes distinguish:
   - `official` -> direct Responses upstream.
   - `mixed` -> Codex auth-compatible + local adapter for Chat Completions upstream.
   - `pure-api` -> API-key-compatible local adapter.
3. The adapter can convert:
   - Responses request -> Chat Completions request.
   - Chat Completions response -> Responses response.
   - Chat SSE -> Responses SSE.
4. Adapter-emulated hosted tools can execute in the middle of the provider model loop.
5. `file_search` has recorded live smoke through OpenRouter.
6. `web_search` has unit/integration tests but no recorded live smoke yet.

### What still blocks "production confident replacement"

1. Web search live smoke pending.
2. End-to-end Codex/CodexNext smoke with a real packaged dependency pending.
3. More provider-specific forced tool call quirks need coverage.
4. Release workflow/changelog still undecided.
5. Need known-good recipes for DeepSeek/Qwen/OpenRouter/SiliconFlow/MiniMax/etc.
6. Need security review for web retrieval engines before enabling default no-key HTML engines in hosted use.

---

## 6. High Priority Issues to Fix

### Issue 1: `return_token_budget` protocol mismatch

Current code uses `number | null`.

Target:

```ts
export type CodexProviderWebSearchReturnTokenBudget =
  | 'default'
  | 'unlimited'
  | null;
```

Normalizer:

```ts
function normalizeReturnTokenBudget(value: unknown): CodexProviderWebSearchReturnTokenBudget {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'default' || normalized === 'unlimited') {
    return normalized;
  }
  return null;
}
```

If you want OpenAI-compatible strictness, reject numbers with an invalid request error. If you want adapter leniency, drop invalid values and record metadata warning.

### Issue 2: `WEB_SEARCH_TOOL_PARAMETERS` is too small

Add:

```ts
filters.allowed_domains
filters.blocked_domains
external_web_access
return_token_budget
mode
max_results / max_num_results
```

### Issue 3: Real web search live smoke missing

Add a smoke script using:

```text
Brave API or Serper API
adapter-emulated web_search
include: ["web_search_call.action.sources", "web_search_call.results"]
placeholder citation
streaming path
external_web_access=false local index path
```

Record redacted evidence in `docs/LIVE_SMOKE_RESULTS.md`.

### Issue 4: Web search output action fidelity

MVP is okay with one `search` action. Full OpenAI parity should add optional actions:

```text
search
open_page
find_in_page
```

CodexProvider already retrieves pages and ranks chunks; the missing part is output representation.

### Issue 5: Release docs stale text

`docs/RELEASE_READINESS.md` still says to keep `CodexProvider*` aliases as deprecated compatibility names, which no longer matches the current package surface. Fix the wording.

---

## 7. Phased Plan

## Phase 0 — Baseline verification

Goal: prove the current code is healthy before more changes.

Commands:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
pnpm pack:dry-run
```

Expected:

- all pass;
- package tarball contains only intended files;
- no old `Relay/Gateway` names in active code;
- docs archive may retain historical names if explicitly archived.

Prompt:

```text
You are working in Gan-Xing/CodexProvider. Do not implement new functionality. Run the current verification gate and inspect package readiness:
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
pnpm pack:dry-run

Then report:
1. whether active public API contains any legacy Relay/Gateway names;
2. whether package tarball contents are clean;
3. whether docs still contain stale release claims;
4. whether any test failures block the next phase.

Do not change web_search or file_search behavior in this phase except trivial doc/test fixes.
```

---

## Phase 1 — Web search protocol parity cleanup

Goal: fix OpenAI-compatible web search parameter shape.

Tasks:

1. Change `return_token_budget` from number to `'default' | 'unlimited' | null`.
2. Update:
   - `src/web-search/types.ts`
   - `src/web-search/openai/request.ts`
   - `src/web-search/openai/tool-output.ts`
   - any tests that use number values.
3. Expand `WEB_SEARCH_TOOL_PARAMETERS`.
4. Add tests:
   - accepts `return_token_budget: "default"`
   - accepts `return_token_budget: "unlimited"`
   - rejects or drops number values intentionally
   - tool schema includes filters/external_web_access/return_token_budget
5. Update docs.

Prompt:

```text
Implement Phase 1: OpenAI-compatible web_search protocol cleanup.

Required changes:
- `return_token_budget` must no longer be `number | null`.
- Introduce `CodexProviderWebSearchReturnTokenBudget = "default" | "unlimited" | null`.
- Normalize only "default" and "unlimited".
- Expand `WEB_SEARCH_TOOL_PARAMETERS` to include:
  query, search_context_size, user_location, filters.allowed_domains, filters.blocked_domains, external_web_access, return_token_budget.
- Update tool output metadata to carry the string value.
- Add tests proving number values are not treated as valid OpenAI-compatible return_token_budget.
- Do not change search engine behavior.
- Do not add dependencies.

Run:
pnpm test
pnpm typecheck
pnpm build
```

---

## Phase 2 — Web search live smoke

Goal: prove adapter-emulated `web_search` works with a real non-OpenAI upstream model.

Tasks:

1. Add smoke script:
   - `examples/live-web-search-smoke.ts` or `scripts/live-web-search-smoke.ts`.
2. It should configure:
   - `OpenAICompatibleResponsesAdapterServer`
   - `hostedTools: [{ name: "web_search", mode: "adapter-emulated" }]`
   - `hostedToolExecutors.web_search = createCodexProviderWebSearchExecutor(...)`
   - at least one real API engine such as Brave API / Serper / Tavily
3. Test:
   - non-streaming response with `web_search_call`
   - `include: ["web_search_call.action.sources"]`
   - `include: ["web_search_call.results"]`
   - `[[source:N]]` citation annotation
4. Test streaming response with hosted tool loop.
5. Record redacted output in `docs/LIVE_SMOKE_RESULTS.md`.

Prompt:

```text
Implement Phase 2: live smoke for adapter-emulated web_search.

Add a live smoke script that uses environment variables only:
CODEX_PROVIDER_API_KEY or provider preset API key
BRAVE_SEARCH_API_KEY or SERPER_API_KEY or TAVILY_API_KEY
CODEX_PROVIDER_BASE_URL
CODEX_PROVIDER_MODEL

The smoke must:
1. start OpenAICompatibleResponsesAdapterServer;
2. declare web_search as adapter-emulated;
3. register createCodexProviderWebSearchExecutor with a real API search engine;
4. POST /v1/responses with tools: [{ type: "web_search" }];
5. request include: ["web_search_call.action.sources", "web_search_call.results"];
6. verify output contains web_search_call and a final message;
7. run a streaming variant;
8. write redacted evidence to docs/LIVE_SMOKE_RESULTS.md.

Do not commit secrets. If env vars are missing, skip with a clear message.
Run normal unit tests after adding the script.
```

---

## Phase 3 — Web search output action fidelity

Goal: move closer to OpenAI hosted web search output shape.

Tasks:

1. Add internal action tracking to web search tool output:
   - `search`
   - `open_page`
   - `find_in_page`
2. Keep default output minimal, but support richer synthetic `web_search_call` items when `exposeHostedToolResultsInResponsesOutput` or include asks for details.
3. Ensure streaming synthetic events can include appended `open_page` / `find_in_page` items without breaking Codex-compatible clients.
4. Add tests:
   - search-only current behavior still passes.
   - when retrieval is enabled, output can expose `open_page`.
   - chunks can expose `find_in_page`.

Prompt:

```text
Implement Phase 3: richer web_search action output.

CodexProvider already retrieves pages and ranks chunks. Represent those steps as optional synthetic actions:
- search
- open_page
- find_in_page

Do not break the existing web_search_call tests. Existing default may remain a single search action. Add an option or include-driven behavior to expose additional action items.

Update:
src/web-search/openai/tool-output.ts
src/web-search/openai/web-search-call.ts
src/server/responses-adapter-server/hosted-tool-output.ts
tests for non-stream and stream output.

Run:
pnpm test
pnpm typecheck
pnpm build
```

---

## Phase 4 — File search parity hardening

Goal: make `file_search` more production-ready without changing its boundary.

Tasks:

1. Add pagination token support:
   - `has_more`
   - `next_page`
   - request page token.
2. Add stronger metadata filter tests:
   - nested and/or
   - missing keys
   - array values
   - numeric values
   - property alias
3. Add docs/examples for:
   - vector_store_ids mapping to source names
   - local-vector setup
   - sqlite index store injection
   - remote-documents source
4. Add stronger payload-limit tests.
5. Do not merge web_search index with file_search index.

Prompt:

```text
Implement Phase 4: file_search parity hardening.

Do not change the file_search/web_search boundary. file_search must only search explicitly configured file/document sources.

Add:
1. pagination token support where possible;
2. tests for nested metadata filters, array values, numeric comparisons, missing keys, and property alias;
3. docs showing vector_store_ids mapped to source names;
4. docs/examples for local-vector and sqlite index store injection;
5. payload-limit tests.

Run:
pnpm test
pnpm typecheck
pnpm build
```

---

## Phase 5 — Codex/CodexNext real integration smoke

Goal: prove actual Codex-style consumption with a non-OpenAI API key.

Tasks:

1. Build or pack `@codex-provider/core`.
2. Consume through a standalone app-server harness or CodexNext.
3. Use a real provider key:
   - OpenRouter DeepSeek/Qwen
   - DashScope/Qwen OpenAI-compatible endpoint
   - SiliconFlow
   - MiniMax
4. Validate:
   - mixed mode local adapter
   - normal response
   - custom tool loop
   - file_search
   - web_search
   - streaming path
5. Record redacted results.

Prompt:

```text
Implement Phase 5: real host integration smoke.

Use the package root entrypoint only. Do not import internal src paths.

Validate:
- CodexProviderRuntime mixed mode
- third-party upstream API key
- /v1/responses local adapter
- adapter-emulated file_search
- adapter-emulated web_search
- streaming web_search
- tool-loop continuation

Record redacted results in docs/LIVE_SMOKE_RESULTS.md.
If a provider cannot force a tool call reliably, document it as provider-specific behavior and rerun with a known-good model.
```

---

## Phase 6 — Pre-release cleanup

Goal: prepare for possible public alpha release.

Tasks:

1. Fix stale docs:
   - `docs/RELEASE_READINESS.md`
   - `docs/INDEPENDENT_PACKAGE_CHECKLIST.md`
   - `CHANGELOG.md`
2. Decide release workflow:
   - npm scope ownership
   - versioning policy
   - changelog format
   - GitHub Actions or manual release
3. Keep or remove examples from package tarball.
4. Add export audit:
   - every stable root export has a test.
5. Run:
   - `pnpm pack:dry-run`
   - inspect package contents.

Prompt:

```text
Implement Phase 6: pre-release cleanup.

Do not remove private:true yet unless explicitly asked.

Update release docs to reflect the current canonical CodexProvider API only. Remove stale language about deprecated Relay/Gateway aliases.

Add or update export audit tests. Run `pnpm pack:dry-run` and document exactly what would ship.

Do not introduce subpath exports yet.
```

---

## 8. Final Recommendation

Current status:

```text
Architecture: good
Independent internal package: yes
Public npm-ready package: not yet
OpenAI-compatible adapter: structurally yes
Replace Codex OpenAI API key with other vendor key: yes for supported OpenAI-compatible Chat upstreams, but needs provider live smoke
web_search replacement: MVP implemented, not production-proven yet
file_search: strong, needs pagination/docs/filter hardening
```

Main blockers before declaring goal complete:

1. Fix `return_token_budget`.
2. Expand web search tool schema.
3. Run live web_search smoke.
4. Run real Codex/CodexNext host smoke.
5. Clean release docs.
6. Decide release workflow.

Once those are done, this can reasonably be called:

```text
CodexProvider internal alpha with adapter-emulated OpenAI hosted tool compatibility.
```

Public release should wait until live smoke and release workflow are complete.
