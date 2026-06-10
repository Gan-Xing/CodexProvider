# CodexProvider Deep Audit Handoff: 100% Tool Parity & Package Hardening Loop

> Repository: `Gan-Xing/CodexProvider`
> Package: `@codex-provider/core`
> Current target: make CodexProvider a production-grade provider compatibility SDK that can replace OpenAI API-key-only usage in Codex-style hosts while preserving OpenAI-compatible Responses, hosted-tool, streaming, `web_search`, and `file_search` behavior.

---

## 0. Executive Summary

The project has moved far beyond the previous refactor stage.

Current status:

```text
Architecture: strong
Internal-alpha package boundary: mostly ready
web_search: strong MVP, close to OpenAI adapter parity
file_search: strong MVP, now has signed pagination
Release readiness: blocked mainly by live smoke evidence and final hardening
```

However, for the user's target of "100%" rather than "85%", the project still has several important gaps. The biggest gap is not a missing search engine. It is a hosted-tool semantics issue:

> Adapter-emulated tools currently rely too heavily on model-generated function arguments. OpenAI hosted tool fields such as `web_search.filters`, `web_search.search_context_size`, `web_search.return_token_budget`, and `file_search.vector_store_ids` are request-level tool declaration configuration. These must be bound by CodexProvider and enforced during executor execution, not delegated to the model to restate.

This is P0 because it affects real OpenAI compatibility.

---

## 1. Current Confirmed Strengths

### 1.1 Package boundary

- `package.json` uses `@codex-provider/core`.
- Only `codex-provider-server` is exposed as bin.
- No active Relay/Gateway public API remains.
- No runtime dependencies beyond dev tooling.
- Root export is canonical.
- `responses_adapter.ts` has been split into modular `responses-adapter/`.
- `responses-adapter-server/` is modular.

### 1.2 Hosted tool architecture

- Hosted tool modes are explicit:
  - `provider-native`
  - `adapter-emulated`
  - `codex-local-first`
- Adapter-emulated tools require explicit declarations.
- Adapter-emulated tools require explicit executors.
- Unsafe tools have no default executor.

### 1.3 `web_search`

Current implementation already has:

```text
metasearch/
engines/
retrieval/
local-index/
deep/
openai/
```

It supports:

- Brave API
- Serper API
- Tavily API
- DuckDuckGo HTML
- Brave HTML
- Ecosia HTML
- Mojeek HTML
- SearXNG endpoint
- OpenSERP endpoint
- retrieval fetcher
- SSRF string-level guard
- redirect handling
- content-type allowlist
- byte/time limits
- extraction/chunking/ranking
- cache/local-index path
- `external_web_access=false`
- `web_search_2025_08_26`
- `return_token_budget` strict/droppable strategy
- synthetic `web_search_call`
- `action.sources`
- `results`
- optional detailed `open_page` / `find_in_page`
- placeholder citation annotations

### 1.4 `file_search`

Current implementation supports:

- local filesystem source
- memory documents source
- SQLite FTS source contract
- remote documents source contract
- vector store adapter contract
- in-memory vector source
- local-vector source
- embedding provider interface
- local vector index store
- SQLite local vector index store contract
- OpenAI-like `vector_store.search_results.page`
- `file_search_call.results`
- signed page-token pagination
- metadata filters
- hybrid scoring options
- payload/byte/result limits

---

## 2. Deep Audit Findings

## P0 Finding 1: Request-level hosted tool configuration is not fully bound to executor calls

### Problem

OpenAI hosted tool configuration lives on the `tools[]` declaration, for example:

```json
{
  "tools": [
    {
      "type": "web_search",
      "search_context_size": "high",
      "filters": {
        "allowed_domains": ["example.com"]
      },
      "return_token_budget": "default"
    }
  ]
}
```

And file search:

```json
{
  "tools": [
    {
      "type": "file_search",
      "vector_store_ids": ["repo-docs"],
      "filters": {
        "type": "eq",
        "key": "source",
        "value": "docs"
      }
    }
  ]
}
```

In adapter-emulated mode, CodexProvider converts the hosted tool into a Chat function tool. The upstream model later calls:

```json
{
  "name": "adapter_web_search",
  "arguments": "{\"query\":\"...\"}"
}
```

The model may **not** repeat the original `filters`, `search_context_size`, `return_token_budget`, `vector_store_ids`, etc. It should not be responsible for preserving security/scoping constraints.

Current risk:

```text
User request tool config may be lost unless the model repeats it.
```

This affects:

- `web_search.filters`
- `web_search.search_context_size`
- `web_search.user_location`
- `web_search.external_web_access`
- `web_search.return_token_budget`
- `file_search.vector_store_ids`
- `file_search.filters`
- `file_search.ranking_options`
- `file_search.max_num_results`
- possibly image/code/computer defaults later

### Required behavior

Adapter-emulated hosted tool execution must merge:

```text
effective tool args = request-level tool config + model-generated function args
```

But with secure merge rules.

### Web search merge rules

- `query`, `q`, `search_query`, `input`: model call args win.
- `search_context_size`: request tool config wins unless absent.
- `return_token_budget`: request tool config wins unless absent.
- `user_location`: request tool config wins unless absent.
- `external_web_access`: `false` must dominate. If request-level config says false, model cannot override true.
- `filters.allowed_domains`: request-level allowed domains are a constraint. If model also supplies allowed domains, intersect them. If only request has them, use request value.
- `filters.blocked_domains`: union request-level and model-level blocked domains.
- `max_results` / `max_num_results`: use the more restrictive value.

### File search merge rules

- `query`, `q`, `search_query`, `input`: model call args win.
- `vector_store_ids`: request-level ids constrain source selection. If model supplies ids too, intersect them. If only request has ids, use request ids.
- `filters`: request-level filters are constraints. Combine with model-level filters using `and`.
- `ranking_options`: request-level values are base defaults; model can only further restrict if safe.
- `max_num_results`: use the smaller value.
- `include_content`: request-level default; model can set false, but should not be able to force true if request-level config explicitly false.

### Implementation plan

Add a tool-config binding layer in `src/server/responses-adapter-server/`.

Suggested files:

```text
src/server/responses-adapter-server/adapter-hosted-tool-config.ts
src/server/responses-adapter-server/adapter-hosted-tool-args.ts
```

Data model:

```ts
export interface AdapterHostedToolRequestConfig {
  canonicalToolName: string;
  originalToolType: string;
  emulatedToolName: string;
  config: JsonRecord;
}

export interface AdapterHostedToolCall {
  declaration: NormalizedCodexProviderHostedToolDeclaration;
  requestConfig?: AdapterHostedToolRequestConfig | null;
  toolCall: JsonRecord;
  message: JsonRecord;
}
```

Flow:

1. At request handling time, inspect `requestBody.tools`.
2. For every adapter-emulated tool declaration present in request tools, capture its tool declaration config.
3. Attach config to executable tool calls when `collectAdapterHostedToolCalls()` maps function name to declaration.
4. In `executeAdapterHostedToolCall()`, merge request config with parsed function arguments before registry execution.
5. Emit trace event showing config merge summary, with no secrets.
6. Add tests proving model cannot bypass request-level restrictions.

Tests to add:

```text
test/adapter_hosted_tool_config_binding.test.ts
```

Required cases:

- web_search request-level filters apply even when model omits filters.
- web_search `external_web_access:false` cannot be overridden by model args.
- web_search request-level `return_token_budget:"default"` reaches executor even if model omits it.
- file_search request-level `vector_store_ids` reaches executor even if model omits it.
- file_search model vector ids are intersected with request vector ids.
- file_search request-level filters are combined with model filters.
- config binding works in streaming hosted tool loop too.

---

## P0 Finding 2: SSRF protection is not DNS-complete

### Problem

`retrieval/safety.ts` blocks obvious private IP string hostnames and local names, but it does not resolve DNS before fetch.

Current guard catches:

```text
127.0.0.1
localhost
169.254.x.x
private IPv4 string literals
private IPv6 string literals
```

But it may not catch:

```text
https://public-looking-domain.example -> resolves to 127.0.0.1
DNS rebinding
internal split-horizon DNS
CNAME to private address
```

Also, the metasearch HTTP processor currently executes engine `buildRequest()` URLs without the same retrieval safety policy. Custom SearXNG/OpenSERP endpoints or engine URLs could point to private/internal hosts if misconfigured or compromised.

### Required behavior

Add DNS-level safety to both:

```text
web retrieval fetcher
metasearch processor HTTP requests
```

### Implementation plan

Add:

```text
src/web-search/security/network-safety.ts
```

or extend:

```text
src/web-search/retrieval/safety.ts
```

with:

```ts
export interface CodexProviderNetworkResolver {
  lookup(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>>;
}
```

Default implementation:

```ts
import { lookup } from 'node:dns/promises';

await lookup(hostname, { all: true, verbatim: true });
```

Checks:

- Validate URL protocol.
- Validate no credentials.
- Validate hostname string.
- Resolve DNS.
- Reject if any resolved address is private/local/link-local/metadata/multicast/reserved.
- Revalidate every redirect target.
- Apply same check to search engine HTTP processor unless engine is explicitly marked trusted or `allowPrivateHosts` is true.

Tests:

```text
test/web_search_network_safety.test.ts
```

Cases:

- hostname resolves to 127.0.0.1 -> blocked
- hostname resolves to 10.0.0.1 -> blocked
- hostname resolves to 169.254.169.254 -> blocked
- redirect target hostname resolves to private -> blocked
- search processor engine endpoint resolving private -> blocked
- allowPrivateHosts opt-in works only when explicitly set

---

## P0 Finding 3: `fast` metasearch mode is not actually fast

### Problem

`fast` mode currently calls `Promise.all()` over all engines, waits for all of them, then selects the fastest successful outcome.

That is not fast mode. It is parallel mode with post-hoc fastest selection.

### Required behavior

`fast` should return once the first successful engine produces enough useful results, while safely draining/aborting the others if possible.

### Implementation plan

Add:

```ts
maxEngineConcurrency?: number
minFastModeResults?: number
overallTimeoutMs?: number
```

Change search processor request contract to include optional `AbortSignal`:

```ts
export interface CodexProviderSearchEngineRequest {
  ...
  signal?: AbortSignal | null;
}
```

Implement:

- `fast`: race engines, return first ok outcome with results.
- `balanced`: run parallel with concurrency limit.
- `exhaustive`: run all, but still obey global timeout.
- `any`: sequential fallback as now.

Tests:

```text
test/web_search_metasearch_modes.test.ts
```

Cases:

- fast returns before slow engine finishes.
- balanced returns all outcomes.
- any stops after first sufficient success.
- exhaustive records slow failures but does not hang forever.
- custom `engine.search()` is timeout-wrapped.

---

## P0 Finding 4: Search processor has no response byte limit

### Problem

`processor.ts` calls `response.text()` for engine HTTP responses. A broken/malicious endpoint could return a huge body.

Retrieval has max bytes. Search processor should too.

### Required behavior

Add:

```ts
maxResponseBytes?: number
```

to search processor and/or engine request.

Implement streaming read with a byte limit similar to retrieval fetcher.

Tests:

- huge SERP response -> `max_bytes_exceeded`
- JSON/API response within limit works
- HTML response within limit works

---

## P0 Finding 5: Live smoke evidence remains the real release gate

### Problem

Scripts exist:

```bash
pnpm smoke:web-search
pnpm smoke:host
```

But `docs/LIVE_SMOKE_RESULTS.md` still records evidence as pending.

### Required behavior

Run with real provider credentials and search credentials.

Minimum acceptable evidence:

```text
OpenRouter or DeepSeek or Qwen-compatible upstream
+
Brave Search or Serper or Tavily
```

Required results:

- normal adapter response
- custom tool loop
- adapter-emulated file_search
- adapter-emulated web_search non-streaming
- adapter-emulated web_search streaming
- local-index `external_web_access=false`
- unsafe tools without default executors

After success:

- append redacted evidence to `docs/LIVE_SMOKE_RESULTS.md`
- check the release checklist box
- keep secrets out of repo

---

## P1 Finding 6: Detailed web_search actions need a stable compatibility policy

### Current state

`web_search_call.actions` include-gate exists. `open_page` and `find_in_page` items are available.

### Remaining risk

OpenAI clients may not expect many appended `web_search_call` output items unless they are known to support them. Overexposure can bloat `response.output`.

### Required behavior

Define documented policy:

```text
Default: aggregate search web_search_call only
include web_search_call.action.sources: include sources in search action
include web_search_call.results: include normalized result list
include web_search_call.actions: include open_page/find_in_page detailed action items
exposeWebSearchDetailedActions: host-level debug/parity override
```

Add tests:

- include sources does not add detailed actions
- include results does not add detailed actions
- include actions adds open_page/find_in_page
- host option adds detailed actions
- streaming completed response follows same rule

---

## P1 Finding 7: Request validation should cover more hosted tool fields

Current validation focuses on `web_search.return_token_budget`.

Add validators for:

### Web search

- `search_context_size` must be low/medium/high if present.
- `filters.allowed_domains` / `blocked_domains` must be arrays of strings.
- domain entries must not include wildcards or protocols unless normalization handles them.
- max domain list length, e.g. 100.
- `external_web_access` must be boolean if present.
- `user_location` must be object if present.

### File search

- `vector_store_ids` must be string array.
- `max_num_results`/`max_results` must be integer 1..50.
- `filters` must be recognized filter tree.
- `ranking_options.score_threshold` must be 0..1.

Strategy should mirror web search:

```ts
invalidParameterStrategy: 'error' | 'drop'
```

But default should be strict.

---

## P1 Finding 8: Source-level pagination for file_search is incomplete

The top-level executor now supports signed page tokens by asking sources for `offset + maxResults + 1`.

This works for local sources that can return enough sorted results, but adapter sources may not support returning deep pages.

### Required behavior

Add optional source-level pagination contract:

```ts
export interface CodexProviderFileSearchSourceResult {
  results: CodexProviderFileSearchSourceMatch[];
  nextPage?: string | null;
  hasMore?: boolean | null;
}
```

Executor should preserve both:

- global page token
- per-source page cursor map

This is not required for local MVP, but needed for remote/vector-store parity.

---

## P1 Finding 9: Web local index must remain isolated from file_search

The current design is good: web local index indexes fetched web pages, not file_search sources.

Keep strengthening this with tests:

- web_search local index does not read file_search sources.
- file_search does not read web retrieval cache.
- future hybrid search must be explicit.

Add docs:

```text
docs/WEB_SEARCH_LOCAL_INDEX_BOUNDARY.md
```

---

## P1 Finding 10: Citation annotation span behavior is approximate

Placeholder replacement currently maps `[[source:N]]` to annotation spans around prior sentence/word. This is acceptable but should be validated more thoroughly.

Add tests:

- multiple citations in one sentence
- repeated same source
- invalid source id is removed safely
- Chinese punctuation
- no whitespace before placeholder
- placeholder at beginning
- multiple output_text parts
- streaming completed response

Optional improvement:

- replace placeholder with `[N]` instead of deleting it, then annotate `[N]`.
- This makes citation location visible and more deterministic.

---

## P1 Finding 11: Search ranking needs an evaluation fixture set

Current ranking is heuristic. To move from "works" to "trusted", add a small benchmark fixture suite.

Add:

```text
test/fixtures/web-search-ranking/
```

Scenarios:

- multi-engine duplicate should outrank single-engine result
- exact title match should outrank snippet-only match
- recent news with date should be boosted for time-sensitive queries
- spam/tracking/duplicate domains should be demoted
- allowed/blocked domains enforced after merge
- Chinese query tokenization

If no external deps are allowed, keep the evaluator deterministic.

---

## P1 Finding 12: CJK tokenization is weak

Current tokenization splits on non-letter/non-number and filters tokens length > 1. This is weak for Chinese/Japanese/Korean queries where there may be no spaces.

Add a simple CJK fallback:

- keep CJK bigrams/trigrams
- preserve Latin tokens
- use same tokenizer in file_search/web_search ranking

No dependencies required.

---

## P1 Finding 13: HTML extraction needs quality fixtures

Add more fixture pages:

- article with nav/header/footer
- docs page with code blocks
- table
- nested lists
- HTML entities
- Chinese page
- malformed HTML
- page with hidden content
- page with canonical URL

Add extractor score tests:

- title
- description
- canonical URL if supported
- main text
- no script/style/nav leakage

---

## P1 Finding 14: Metasearch engine parser snapshots need maintenance workflow

HTML engines are brittle by nature. Add a policy:

```text
test/fixtures/web-search/*.html are snapshot fixtures.
When an engine parser is updated, update fixture expectations and note provider page variant.
Live engine smoke remains optional and credential-gated.
```

Add one test per engine for:

- no results
- blocked/captcha
- malformed result block
- tracking redirect cleanup
- relative links

---

## P1 Finding 15: Package hygiene checker should scan shipped docs/examples

`check-boundary.mjs` currently focuses on `src`. That is good for source imports, but package tarball ships:

```text
README.md
CHANGELOG.md
docs
examples
```

Add:

```bash
pnpm check-package-surface
```

It should scan shipped text for:

- `.env`
- API keys / secret-looking strings
- absolute local paths
- generated caches
- host app code imports
- accidental CodexBridge/CodexNext implementation dependency
- large files
- binary files

Docs can mention CodexBridge/CodexNext as consumers, but examples must not import them.

---

## P1 Finding 16: Hosted tool execution errors need clear policy

Currently executor exceptions are converted into tool output and the model is allowed to continue.

That is useful for model-generated tool-call errors, but not always correct for user request validation or security failures.

Define policy:

```text
Request validation errors -> HTTP 400
Security policy violation -> HTTP 400 or 403 depending source
Tool provider transient failure -> tool output error, model may recover
Tool loop exceeded -> HTTP 502
Unsafe executor not registered -> not exposed
```

Add typed error class:

```ts
CodexProviderHostedToolFatalError
```

or extend existing validation errors so `executeAdapterHostedToolCall()` can optionally propagate fatal errors instead of swallowing all exceptions.

---

## P1 Finding 17: Provider capability presets need live behavior records

Different providers vary:

- forced tool choice works / fails
- streaming tool calls format differs
- reasoning fields differ
- response usage fields differ
- tool call arguments may be partial or fragmented
- JSON schema support varies

Add provider behavior table:

```text
docs/PROVIDER_COMPATIBILITY_MATRIX.md
```

Minimum rows:

- OpenRouter + deepseek/deepseek-chat
- DeepSeek official
- DashScope/Qwen compatible
- SiliconFlow
- MiniMax
- Moonshot/Kimi
- OpenAI direct responses

Record:

- normal response
- forced custom tool
- adapter file_search
- adapter web_search
- streaming web_search
- reasoning behavior
- known quirks

---

## P2 Finding 18: Deep search is currently heuristic

`deep/` exists and has heuristic planning. This is fine as optional future work, but do not claim full MindSearch/Perplexity behavior yet.

Next steps:

- Add LLM-planner interface.
- Add graph execution budget.
- Add reference merge tests.
- Add final answer synthesis contract.
- Keep it separate from default `web_search`.

---

## P2 Finding 19: Observability should be structured

Add trace events for:

- search engine selected
- search engine skipped
- search engine suspended
- search engine latency
- retrieval started/completed/failed
- cache hit/miss
- local index hit
- citation placeholder count
- detailed actions count
- file_search page token offset
- file_search source count

Ensure no secrets or full document contents leak into trace by default.

---

## P2 Finding 20: CI and release automation

Before public release:

- Add GitHub Actions for:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm consumer:harness`
  - `pnpm check-boundary`
  - `pnpm pack:dry-run`
- Do not add auto-publish yet.
- Add manual release checklist.
- Add export audit test for all root exports.

---

## 3. Multi-Stage Execution Plan

Branch policy:

- All implementation, documentation, validation, and commit work must happen on `main`.
- Do not create, switch to, or push a separate working branch unless the user explicitly requests a branch.
- If a previous local branch exists, fast-forward or merge the completed work back to `main`, push `main`, then remove the temporary branch when safe.

Each phase must be implemented independently. After every phase:

1. Run full local gate.
2. Update docs.
3. Write bilingual summary.
4. Commit using bilingual standard format.
5. If anything fails, fix before moving to the next phase.

Full local gate:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
pnpm pack:dry-run
```

Credential-gated smoke gate:

```bash
pnpm smoke:web-search
pnpm smoke:host
```

---

## Phase 0: Baseline and audit snapshot

Goal: verify current repository state and create a living audit tracker.

Tasks:

- Run full local gate.
- Create/update `docs/handoff/CODEX_PROVIDER_100_PERCENT_PARITY_TRACKER.md`.
- List all current P0/P1/P2 items.
- Mark which ones are already done.
- Do not change runtime behavior.

Tests:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
pnpm pack:dry-run
```

---

## Phase 1: Hosted tool request-config binding

Goal: bind OpenAI hosted tool declaration fields to adapter-emulated executor calls.

Tasks:

- Add request tool config extraction.
- Merge tool declaration config with function call args.
- Implement secure merge rules for `web_search`.
- Implement secure merge rules for `file_search`.
- Support non-streaming and streaming hosted tool loops.
- Add trace metadata for config binding.
- Add tests.

Critical tests:

- `tools[].filters` applies to `web_search` even if model omits filters.
- `external_web_access:false` cannot be overridden by model args.
- `tools[].return_token_budget` reaches executor.
- `tools[].vector_store_ids` reaches `file_search`.
- File search vector ids are intersected.
- File search filters combine with `and`.
- Streaming loop preserves bound config.

---

## Phase 2: Network safety and SSRF hardening

Goal: DNS-complete SSRF protection for retrieval and metasearch engine requests.

Tasks:

- Add DNS resolver abstraction.
- Resolve hostnames before fetch.
- Block private/reserved/link-local/metadata resolved IPs.
- Apply to redirects.
- Apply to metasearch processor HTTP engine requests.
- Add configurable `allowPrivateHosts`.
- Add tests with fake resolver.

Tests:

- hostname -> 127.0.0.1 blocked
- hostname -> 10.x blocked
- hostname -> 169.254.x blocked
- redirect hostname -> private blocked
- search engine endpoint -> private blocked
- opt-in private host works only with explicit option

---

## Phase 3: True metasearch modes, timeouts, and limits

Goal: make `fast`, `balanced`, `any`, `exhaustive` behavior real and bounded.

Tasks:

- Implement true fast mode.
- Add engine concurrency limit.
- Add overall search timeout.
- Add timeout wrapping for custom `engine.search()`.
- Add max response bytes for search processor.
- Add abort signal support where possible.
- Add tests.

Tests:

- fast returns before slow engine finishes
- balanced waits for all within timeout
- any stops after first sufficient success
- exhaustive records failures
- huge SERP response blocked

---

## Phase 4: Request validation expansion

Goal: validate OpenAI hosted tool configs strictly and consistently.

Tasks:

- Validate web_search:
  - `search_context_size`
  - `filters`
  - `external_web_access`
  - `user_location`
  - `return_token_budget`
  - max result fields
- Validate file_search:
  - `vector_store_ids`
  - `filters`
  - `ranking_options`
  - `max_num_results`
- Implement `error` and `drop` strategies consistently.
- Ensure HTTP 400 for strict mode.

Tests:

- invalid web_search field returns 400
- drop mode removes invalid field and traces adjustment
- invalid file_search filters return 400
- allowed_tools validation also works

---

## Phase 5: Web search output parity and citation quality

Goal: stabilize synthetic output contract.

Tasks:

- Keep default aggregate `search` call only.
- Keep detailed `open_page/find_in_page` behind `web_search_call.actions` or host option.
- Add deterministic citation replacement tests.
- Add support for visible `[N]` marker mode if chosen.
- Add multilingual citation tests.

Tests:

- sources include only sources
- results include only results
- actions include detailed actions
- multiple placeholders work
- invalid placeholder removed safely
- Chinese punctuation citation span works
- streaming completed response matches non-streaming behavior

---

## Phase 6: File search 100% hardening

Goal: make file_search reliable under pagination, remote sources, vector sources, and filters.

Tasks:

- Add source-level pagination extension.
- Preserve per-source cursor map in next_page token.
- Add filter test matrix.
- Add ranking option test matrix.
- Add vector_store_ids docs and examples.
- Add stable page token secret docs.

Tests:

- next_page retrieves second page
- token rejects tampering
- token rejects changed query/fingerprint
- remote source pagination works
- nested filters work
- numeric and array metadata filters work

---

## Phase 7: Ranking and extraction quality evaluation

Goal: turn heuristic retrieval into measured retrieval.

Tasks:

- Add web ranking fixture suite.
- Add CJK tokenizer fallback.
- Add HTML extraction fixture suite.
- Add local index ranking fixtures.
- Add file_search ranking fixtures.
- Add docs explaining scoring.

Tests:

- multi-engine duplicate boost
- exact title match boost
- CJK query works
- main article extraction beats nav/footer
- tracking URLs deduped
- local index offline result ranks correctly

---

## Phase 8: Package hygiene and CI

Goal: make package safe to ship.

Tasks:

- Add `check-package-surface`.
- Scan docs/examples/package tarball contents.
- Add GitHub Actions check workflow.
- Add export audit.
- Fix stale release docs.
- Keep publishing manual.

Tests:

```bash
pnpm check-package-surface
pnpm pack:dry-run
```

---

## Phase 9: Live smoke evidence

Goal: close release blocker.

Tasks:

- Run `pnpm smoke:web-search`.
- Run `pnpm smoke:host`.
- Record redacted evidence.
- Update checklist.
- Add provider compatibility notes.

Minimum credentials:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-chat
BRAVE_SEARCH_API_KEY=...
```

or equivalent.

---

## Phase 10: Public alpha release decision

Goal: decide whether to publish alpha.

Tasks:

- Confirm npm scope ownership.
- Update CHANGELOG.
- Update RELEASE_READINESS.
- If publishing:
  - set `private:false`
  - bump `0.1.0-alpha.1`
  - run full gate
  - run pack dry run
  - publish manually
- If not publishing:
  - keep private true
  - record remaining blockers

---

## 4. Reusable Codex Goal Prompt

Use this as the master prompt for iterative execution.

```text
You are working in Gan-Xing/CodexProvider.

Goal: drive CodexProvider from internal-alpha to 100% verified provider/tool parity according to docs/handoff/CODEX_PROVIDER_DEEP_AUDIT_100_PERCENT_PARITY_HANDOFF.md.

Rules:
1. Work one phase at a time.
2. Do not skip phases unless the tracker marks the phase complete.
3. Work on main only. Do not create or switch to a separate branch unless the user explicitly asks for one.
4. Before editing, read:
   - docs/handoff/CODEX_PROVIDER_DEEP_AUDIT_100_PERCENT_PARITY_HANDOFF.md
   - docs/handoff/CODEX_PROVIDER_100_PERCENT_PARITY_TRACKER.md if it exists
   - README.md
   - docs/OPENAI_BUILTIN_TOOL_COMPATIBILITY.md
   - docs/INDEPENDENT_PACKAGE_CHECKLIST.md
   - docs/RELEASE_READINESS.md
5. For the current phase:
   - inspect the relevant code
   - write or update tests first when practical
   - implement the smallest complete fix
   - update docs
   - update the tracker
6. Run the full local gate after each phase:
   pnpm test
   pnpm typecheck
   pnpm build
   pnpm consumer:harness
   pnpm check-boundary
   pnpm pack:dry-run
7. If credentials are present and the phase touches live behavior, also run:
   pnpm smoke:web-search
   pnpm smoke:host
8. Do not add runtime dependencies unless the phase explicitly allows it.
9. Do not add sqlite/browser/vector-db/sandbox dependencies.
10. Do not introduce default unsafe executors.
11. Do not leak secrets into docs, tests, examples, or traces.
12. Keep web_search local index separate from file_search sources.
13. Preserve root entrypoint compatibility.
14. Use only canonical CodexProvider names. Do not reintroduce Relay/Gateway names except archived docs.

Required completion output for each phase:
- Chinese summary
- English summary
- Files changed
- Tests run
- Remaining risks
- Next recommended phase

Commit format:
<type>(<scope>): <English concise title>

中文:
- <中文变更摘要>
- <中文测试结果>

English:
- <English change summary>
- <English test result>

Validation:
- pnpm test
- pnpm typecheck
- pnpm build
- pnpm consumer:harness
- pnpm check-boundary
- pnpm pack:dry-run
- smoke commands if run

If a phase cannot be completed, stop and write:
- blocker
- reproduction
- attempted fixes
- safest next step
```

---

## 5. Phase-Specific Prompt Templates

### Phase 1 Prompt

```text
Implement Phase 1: hosted tool request-config binding.

The main issue is that adapter-emulated hosted tools currently rely on model-generated function arguments, but OpenAI hosted tool configuration lives on request.tools[].

Implement secure request-level config binding for web_search and file_search.

Required:
- Extract adapter-emulated tool config from request.tools[].
- Attach it to AdapterHostedToolCall.
- Merge it with parsed function call args before executor execution.
- Secure merge rules:
  web_search:
    query from model args;
    request filters constrain model filters;
    blocked domains union;
    allowed domains intersection if both exist;
    external_web_access false dominates;
    request search_context_size/user_location/return_token_budget are preserved;
    max results uses smaller value.
  file_search:
    query from model args;
    vector_store_ids constrained by request-level ids;
    filters combine with AND;
    max results uses smaller value;
    include_content false dominates.
- Cover non-streaming and streaming hosted tool loops.
- Add tests in test/adapter_hosted_tool_config_binding.test.ts.
- Update docs/handoff tracker.

Run:
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
pnpm pack:dry-run
```

### Phase 2 Prompt

```text
Implement Phase 2: DNS-complete network safety.

Add DNS-level SSRF protection to web retrieval and metasearch HTTP engine requests.

Required:
- Add resolver abstraction with default dns.promises.lookup(all:true).
- Block hostnames resolving to private/local/link-local/metadata/reserved addresses.
- Revalidate redirect targets.
- Apply same safety to metasearch processor engine HTTP requests.
- Add max response bytes for search processor if practical in this phase.
- Add fake resolver tests.

Run the full local gate.
```

### Phase 3 Prompt

```text
Implement Phase 3: real metasearch modes and bounded execution.

Fix fast mode so it returns after the first sufficient successful engine instead of waiting for all engines.
Add concurrency/overall timeout support.
Wrap custom engine.search() with timeout.
Add tests for fast/balanced/any/exhaustive behavior.

Run the full local gate.
```

### Phase 4 Prompt

```text
Implement Phase 4: expanded strict request validation.

Validate web_search and file_search hosted tool declaration fields in request.tools and tool_choice.allowed_tools.
Default strategy is error. Drop strategy must emit request.adjusted trace metadata.
Add HTTP 400 tests.

Run the full local gate.
```

### Phase 5 Prompt

```text
Implement Phase 5: web_search output/citation parity hardening.

Stabilize include behavior:
- action.sources only exposes sources
- results only exposes results
- actions exposes open_page/find_in_page
- host option can expose detailed actions
Add robust citation placeholder tests including repeated sources and CJK punctuation.

Run the full local gate.
```

### Phase 6 Prompt

```text
Implement Phase 6: file_search 100% hardening.

Add source-level pagination support and per-source cursor preservation.
Add filter/ranking/vector_store_ids test matrix.
Update docs and examples for file_search source scoping and pagination.

Run the full local gate.
```

### Phase 7 Prompt

```text
Implement Phase 7: ranking/extraction quality fixtures.

Add deterministic ranking and extraction fixtures for web_search and file_search.
Add CJK tokenizer fallback with tests.
Do not add dependencies.

Run the full local gate.
```

### Phase 8 Prompt

```text
Implement Phase 8: package hygiene and CI readiness.

Add check-package-surface script.
Scan shipped files: README, CHANGELOG, docs, examples, package.json.
Reject secrets, .env contents, generated indexes/caches, binary artifacts, host-app imports.
Add docs and tests.

Run the full local gate.
```

### Phase 9 Prompt

```text
Implement Phase 9: live smoke evidence.

If credentials are available:
- run pnpm smoke:web-search
- run pnpm smoke:host
- append redacted results to docs/LIVE_SMOKE_RESULTS.md
- update docs/INDEPENDENT_PACKAGE_CHECKLIST.md
- update provider compatibility notes

If credentials are not available:
- do not fake results
- document exactly which env vars are missing
```

### Phase 10 Prompt

```text
Implement Phase 10: public alpha release decision.

Do not publish automatically.
Prepare release docs and changelog.
If release is approved:
- set private:false
- bump alpha version
- verify npm scope ownership instructions
- run full local gate
- run pack dry run
Otherwise keep private:true and document blockers.
```

---

## 6. Definition of 100%

CodexProvider reaches the user's "100%" target when all of the following are true:

### Protocol

- Responses request -> Chat Completions conversion is covered.
- Chat Completions -> Responses conversion is covered.
- Chat SSE -> Responses SSE conversion is covered.
- Adapter-emulated hosted tool loops work in non-streaming and streaming.
- OpenAI-compatible web_search and file_search request fields are either supported or explicitly rejected with correct errors.

### Web search

- OpenAI canonical and dated `web_search` tool types are supported.
- Request-level config is enforced.
- MetaSearch modes are correct.
- Retrieval is safe by DNS and redirect.
- Output supports `web_search_call`, `action.sources`, `results`, `actions`, and citations.
- Offline cache/local-index path works.
- Live smoke is recorded.

### File search

- Request-level config is enforced.
- Source scoping works.
- Pagination works.
- Metadata filters work.
- Ranking options work.
- Vector/local/remote/sqlite contracts have tests.
- File search stays separate from web search.

### Package

- Root API is canonical.
- No historical names in active surface.
- No secrets or generated caches in tarball.
- CI/local gate passes.
- Live smoke is recorded.
- Release workflow is decided.

Only after that should the project claim:

```text
CodexProvider provides production-grade adapter-emulated OpenAI hosted-tool compatibility for non-OpenAI provider API keys.
```
