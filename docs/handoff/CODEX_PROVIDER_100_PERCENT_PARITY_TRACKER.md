# CodexProvider 100 Percent Parity Tracker

Last updated: 2026-06-10

Scope source: `docs/handoff/CODEX_PROVIDER_DEEP_AUDIT_100_PERCENT_PARITY_HANDOFF.md`

Branch policy: all future changes must be made on `main`. Do not create or switch to a separate working branch unless the user explicitly requests it.

## Current Scope

This tracker is the living audit snapshot for the 100 percent parity loop. The completed implementation scope now includes:

- Phase 0: baseline/audit tracker.
- Phase 1: hosted tool request-config binding for adapter-emulated `web_search` and `file_search`.
- Phase 2: DNS-complete network safety and SSRF hardening for retrieval and metasearch HTTP requests.
- Phase 3: true metasearch modes, bounded execution, concurrency, and timeout support.
- Phase 4: expanded adapter request validation for hosted `web_search` and `file_search` declarations.

Out of scope for the latest completed phase:

- Metasearch ranking, extraction quality work, parser maintenance, or retrieval quality evaluation.
- File source rewrites or web-index/file-search mixing.
- Package publishing, dependency additions, or changing `private: true`.

## Phase Status

| Phase | Title | Status | Evidence |
| --- | --- | --- | --- |
| Phase 0 | Baseline and audit snapshot | Complete | Tracker created and final local gate passed on 2026-06-10. |
| Phase 1 | Hosted tool request-config binding | Complete | Binding implementation, docs, and focused tests added. Final local gate passed on 2026-06-10. |
| Phase 2 | Network safety and SSRF hardening | Complete | DNS resolver abstraction, retrieval/metasearch enforcement, redirect revalidation, fake resolver tests, and search response byte limit added. Final local gate passed on 2026-06-10. |
| Phase 3 | True metasearch modes, timeouts, and limits | Complete | Real fast mode, concurrency limits, overall timeout, AbortSignal propagation, and custom engine timeout wrapping added. Search response byte limit was already completed in Phase 2. Final local gate passed on 2026-06-10. |
| Phase 4 | Request validation expansion | Complete | Hosted `web_search` and `file_search` declaration validation added for `tools[]` and `tool_choice.allowed_tools`; final local gate passed on 2026-06-10. |
| Phase 5 | Web search output parity and citation quality | Not started | Existing detailed action gate noted; broader phase out of scope. |
| Phase 6 | File search 100 percent hardening | Not started | Out of current scope. |
| Phase 7 | Ranking and extraction quality evaluation | Not started | Out of current scope. |
| Phase 8 | Package hygiene and CI | Not started | Out of current scope. |
| Phase 9 | Live smoke evidence | Not started | Out of current scope. |
| Phase 10 | Public alpha release decision | Not started | Out of current scope. |

## Audit Item Status

| ID | Priority | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | P0 | Request-level hosted tool configuration is not fully bound to executor calls | Complete | Phase 1 implementation binds adapter-emulated request config to executor args for `web_search` and `file_search`; final gate passed. |
| 2 | P0 | SSRF protection is not DNS-complete | Complete | Phase 2 adds DNS resolver-backed safety for retrieval and metasearch HTTP requests, redirect target revalidation, fake resolver tests, and explicit `allowPrivateHosts` opt-in behavior. |
| 3 | P0 | `fast` metasearch mode is not actually fast | Complete | Phase 3 makes `fast` return on the first sufficient completed engine result, aborts in-flight work, and adds bounded/concurrent execution tests. |
| 4 | P0 | Search processor has no response byte limit | Complete | Phase 2 adds processor/request `maxResponseBytes` and streaming response reads that fail with `max_bytes_exceeded`. |
| 5 | P0 | Live smoke evidence remains the real release gate | Not started | Future Phase 9. |
| 6 | P1 | Detailed web_search actions need a stable compatibility policy | Partially done before this phase | Existing docs/tests gate detailed actions behind includes/options; not changed here. |
| 7 | P1 | Request validation should cover more hosted tool fields | Complete | Phase 4 validates hosted `web_search` and `file_search` declaration fields in `tools[]` and `tool_choice.allowed_tools`, with strict 400s by default and drop-mode adjustment traces. |
| 8 | P1 | Source-level pagination for file_search is incomplete | Not started | Future Phase 6. |
| 9 | P1 | Web local index must remain isolated from file_search | Not started | Future Phase 6/7 boundary tests. |
| 10 | P1 | Citation annotation span behavior is approximate | Not started | Future Phase 5. |
| 11 | P1 | Search ranking needs an evaluation fixture set | Not started | Future Phase 7. |
| 12 | P1 | CJK tokenization is weak | Not started | Future Phase 7. |
| 13 | P1 | HTML extraction needs quality fixtures | Not started | Future Phase 7. |
| 14 | P1 | Metasearch engine parser snapshots need maintenance workflow | Not started | Future Phase 7. |
| 15 | P1 | Package hygiene checker should scan shipped docs/examples | Partially done before this phase | `pnpm check-package-surface` exists; this pass keeps requested final `check-boundary`/`pack:dry-run` gates. |
| 16 | P1 | Hosted tool execution errors need clear policy | Not started | Future policy/error-class phase. |
| 17 | P1 | Provider capability presets need live behavior records | Not started | Future provider matrix/live smoke work. |
| 18 | P2 | Deep search is currently heuristic | Not started | Future optional deep-search phase. |
| 19 | P2 | Observability should be structured | Partially done | Phase 1 adds sanitized `hosted_tool.config_bound` trace metadata; broader observability remains future work. |
| 20 | P2 | CI and release automation | Not started | Future Phase 8. |

## Phase 1 Binding Contract

Adapter-emulated hosted tool execution now treats Responses `tools[]` hosted tool configuration as request-owned policy. The adapter extracts the matching tool declaration config once, attaches it to collected adapter-hosted tool calls, merges it with model-produced Chat function arguments, and passes only the effective arguments to the registered executor.

### Web Search

- Query fields (`query`, `q`, `search_query`, `input`) remain model-owned.
- Request `search_context_size`, `return_token_budget`, and `user_location` win when present.
- `external_web_access: false` dominates model arguments.
- `filters.allowed_domains` are intersected.
- `filters.blocked_domains` are unioned.
- `max_results` / `max_num_results` / `num_results` use the smallest positive integer.

### File Search

- Query fields (`query`, `q`, `search_query`, `input`) remain model-owned.
- Request `vector_store_ids` constrain model-provided ids by intersection.
- Request and model `filters` are combined with `and`.
- `max_num_results` / `max_results` use the smallest positive integer.
- `include_content: false` dominates model arguments.
- Request `ranking_options` act as defaults; `score_threshold` uses the more restrictive larger value.

## Phase 2 Network Safety Contract

Network-capable web retrieval and metasearch HTTP engine requests now use a shared resolver-backed safety check before live network access.

- Default DNS resolution uses `node:dns/promises.lookup(hostname, { all: true, verbatim: true })`.
- Tests can inject a fake `CodexProviderNetworkResolver`.
- URL validation still rejects unsupported protocols and credentials.
- Unless `allowPrivateHosts: true` is explicitly configured, hostname literals and resolved DNS addresses are rejected when they are private, local, link-local, metadata, multicast, carrier-grade NAT, documentation, benchmarking, or otherwise reserved ranges.
- Web retrieval validates the current URL before every live fetch and validates redirect targets before following them.
- Metasearch HTTP engines validate their request URL before fetch, use manual redirects, validate each redirect target, and expose SSRF failures through engine outcomes with `ssrf_blocked`.
- Metasearch HTTP response bodies are read with a bounded byte limit and fail with `max_bytes_exceeded` when exceeded.
- Cached/offline retrieval reads do not require DNS because no live network fetch occurs.

## Phase 3 Metasearch Execution Contract

Metasearch mode execution is now bounded and mode-specific.

- `fast` starts concurrent engine work and returns the first successful outcome with at least `minFastModeResults`; remaining in-flight work receives an abort signal.
- `balanced` and `exhaustive` use the shared concurrent runner and honor `maxEngineConcurrency`.
- `any` remains sequential fallback and stops after the first sufficient successful engine.
- `overallTimeoutMs` bounds mode execution and records timeout outcomes instead of hanging indefinitely.
- `CodexProviderSearchEngineRequest.signal` is passed to engines so custom and HTTP engines can observe cancellation.
- Custom `engine.search()` implementations are wrapped by processor-level timeouts using `engine.timeoutMs`.
- HTTP engine fetches honor the request abort signal in addition to their per-request timeout.
- Search response byte limits remain the Phase 2 `maxResponseBytes` processor/request behavior.

## Phase 4 Request Validation Contract

The Responses adapter now validates hosted tool declaration fields before request conversion for both top-level `tools[]` and `tool_choice.allowed_tools.tools[]`.

- `web_search` validation covers `search_context_size`, `filters`, `external_web_access`, `user_location`, `return_token_budget`, and result-count aliases (`max_results`, `max_num_results`, `num_results`).
- Web search domain filters are bounded, normalized, and rejected for wildcard, credentialed, whitespace-containing, unsupported-protocol, empty, or non-host-like entries.
- `file_search` validation covers `vector_store_ids`, `filters`, `ranking_options`, and result-count aliases (`max_num_results`, `max_results`).
- File search filters validate recognized comparison operators and nested `and` / `or` filter trees with bounded depth and fan-out.
- File search ranking options validate object shape and require `score_threshold` to be a number from 0 through 1 when present.
- The default invalid-parameter strategy returns HTTP 400 before forwarding to the upstream adapter.
- The `drop` strategy removes only the invalid field from the cloned request, records a `field_filtered` adjustment, emits `request.adjusted`, and continues validating remaining fields.

## Validation Log

Phase 1 validation run on 2026-06-10:

```bash
pnpm test                # passed: 245 passing, 1 credential-gated integration skipped
pnpm typecheck           # passed
pnpm build               # passed
pnpm consumer:harness    # passed
pnpm check-boundary      # passed
pnpm pack:dry-run        # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/adapter_hosted_tool_config_binding.test.ts  # passed: 7 tests
git diff --check                                                     # passed
```

Phase 2 validation run on 2026-06-10:

```bash
pnpm test                # passed: 253 passing, 1 credential-gated integration skipped
pnpm typecheck           # passed
pnpm build               # passed
pnpm consumer:harness    # passed
pnpm check-boundary      # passed
pnpm pack:dry-run        # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/web_search_network_safety.test.ts test/web_search_fetch_security.test.ts test/web_search_retrieval.test.ts test/web_search_api_engines.test.ts test/web_search_endpoint_engines.test.ts test/web_search_html_engines.test.ts test/web_search_local_index.test.ts test/public_surface.test.ts  # passed: 46 tests
git diff --check                                                                                                                                                                                                                       # passed
```

Phase 3 validation run on 2026-06-10:

```bash
pnpm test                # passed: 258 passing, 1 credential-gated integration skipped
pnpm typecheck           # passed
pnpm build               # passed
pnpm consumer:harness    # passed
pnpm check-boundary      # passed
pnpm pack:dry-run        # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/web_search_metasearch_modes.test.ts test/web_search_metasearch_core.test.ts test/web_search_network_safety.test.ts  # passed: 20 tests
git diff --check                                                                                                                              # passed
```

Phase 4 validation run on 2026-06-10:

```bash
pnpm test                # passed: 263 passing, 1 credential-gated integration skipped
pnpm typecheck           # passed
pnpm build               # passed
pnpm consumer:harness    # passed
pnpm check-boundary      # passed
pnpm pack:dry-run        # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/hosted_tool_request_validation.test.ts test/server.test.ts test/adapter_hosted_tool_config_binding.test.ts  # passed: 50 tests
git diff --check                                                                                                                       # passed
```

Live smoke status:

```bash
OPENROUTER_API_KEY=missing
OPENROUTER_MODEL=missing
BRAVE_SEARCH_API_KEY=missing
SERPER_API_KEY=missing
TAVILY_API_KEY=missing
```

Live smoke was skipped because no required credentials were present in the local environment.
