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
- Phase 5: stabilized synthetic `web_search_call` output policy and deterministic citation markers.
- Phase 6: `file_search` source-level cursor pagination, filter/ranking matrix coverage, and pagination docs.
- Phase 7: deterministic search-quality fixture suite, shared CJK-aware tokenization, title-complete ranking boosts, improved article extraction, local-index/file-search boundary coverage, and parser fixture workflow docs.
- Phase 8: package-surface scanner hardening, real tarball-content inspection, CI package hygiene gate, public-surface CI regression test, and refreshed release-readiness dry-run snapshot.
- Phase 9: redacted live smoke evidence for adapter-emulated `web_search`, streaming `web_search`, `file_search`, custom tool loop, normal Responses path, and mixed-runtime host integration.

Out of scope for the latest completed phase:

- API-key-backed Brave/Serper/Tavily live search evidence; no search-provider API key was present, so the live run used built-in no-key metasearch.
- Full provider-preset matrix live records beyond the OpenRouter-compatible mixed-runtime smoke.
- Public release, npm publish automation, dependency additions, or changing `private: true`. Public alpha planning has started, but release approval remains out of scope.

## Phase Status

| Phase | Title | Status | Evidence |
| --- | --- | --- | --- |
| Phase 0 | Baseline and audit snapshot | Complete | Tracker created and final local gate passed on 2026-06-10. |
| Phase 1 | Hosted tool request-config binding | Complete | Binding implementation, docs, and focused tests added. Final local gate passed on 2026-06-10. |
| Phase 2 | Network safety and SSRF hardening | Complete | DNS resolver abstraction, retrieval/metasearch enforcement, redirect revalidation, fake resolver tests, and search response byte limit added. Final local gate passed on 2026-06-10. |
| Phase 3 | True metasearch modes, timeouts, and limits | Complete | Real fast mode, concurrency limits, overall timeout, AbortSignal propagation, and custom engine timeout wrapping added. Search response byte limit was already completed in Phase 2. Final local gate passed on 2026-06-10. |
| Phase 4 | Request validation expansion | Complete | Hosted `web_search` and `file_search` declaration validation added for `tools[]` and `tool_choice.allowed_tools`; final local gate passed on 2026-06-10. |
| Phase 5 | Web search output parity and citation quality | Complete | Include-gated output policy verified, visible `[N]` citation markers added, repeated/invalid/CJK citation tests added, and final local gate passed on 2026-06-10. |
| Phase 6 | File search 100 percent hardening | Complete | Source-level `pageCursor` / `nextPage` contract added, signed tokens preserve per-source cursors and global offsets, filter/ranking/vector-store matrix tests added, and final local gate passed on 2026-06-10. |
| Phase 7 | Ranking and extraction quality evaluation | Complete | Shared tokenizer, deterministic ranking/extraction fixtures, CJK ranking tests, title-complete boosts, local-index/file_search boundary tests, scoring docs, and parser fixture workflow added. Final local gate passed on 2026-06-10. |
| Phase 8 | Package hygiene and CI | Complete | `check-package-surface` now scans actual dry-run tarball files for secrets, private paths, generated artifacts, large files, binary artifacts, and host-app imports; CI runs the package-surface gate before pack dry-run; release readiness snapshot refreshed. Final local gate passed on 2026-06-10. |
| Phase 9 | Live smoke evidence | Complete | Redacted OpenRouter-compatible live evidence recorded in `docs/LIVE_SMOKE_RESULTS.md` for `pnpm smoke:web-search` and `pnpm smoke:host` on 2026-06-10. |
| Phase 10 | Public alpha release decision | Planning in progress | `docs/PUBLIC_ALPHA_RELEASE_PLAN.md` defines the `private:true` decision, alpha version policy, npm scope checklist, manual publish steps, and no-auto-publish policy. Publishing remains blocked on explicit release approval. |

## Audit Item Status

| ID | Priority | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | P0 | Request-level hosted tool configuration is not fully bound to executor calls | Complete | Phase 1 implementation binds adapter-emulated request config to executor args for `web_search` and `file_search`; final gate passed. |
| 2 | P0 | SSRF protection is not DNS-complete | Complete | Phase 2 adds DNS resolver-backed safety for retrieval and metasearch HTTP requests, redirect target revalidation, fake resolver tests, and explicit `allowPrivateHosts` opt-in behavior. |
| 3 | P0 | `fast` metasearch mode is not actually fast | Complete | Phase 3 makes `fast` return on the first sufficient completed engine result, aborts in-flight work, and adds bounded/concurrent execution tests. |
| 4 | P0 | Search processor has no response byte limit | Complete | Phase 2 adds processor/request `maxResponseBytes` and streaming response reads that fail with `max_bytes_exceeded`. |
| 5 | P0 | Live smoke evidence remains the real release gate | Complete | Phase 9 records redacted live evidence for `smoke:web-search` and `smoke:host` using OpenRouter-compatible upstream credentials and built-in no-key metasearch. |
| 6 | P1 | Detailed web_search actions need a stable compatibility policy | Complete | Phase 5 verifies separate include behavior: sources expose only `action.sources`, results expose only `results`, and detailed `open_page` / `find_in_page` actions require `web_search_call.actions` or host override. |
| 7 | P1 | Request validation should cover more hosted tool fields | Complete | Phase 4 validates hosted `web_search` and `file_search` declaration fields in `tools[]` and `tool_choice.allowed_tools`, with strict 400s by default and drop-mode adjustment traces. |
| 8 | P1 | Source-level pagination for file_search is incomplete | Complete | Phase 6 adds `pageCursor` / `pageSize` on source requests, optional `nextPage` / `hasMore` on source results, and signed token preservation of per-source cursors. |
| 9 | P1 | Web local index must remain isolated from file_search | Complete | Phase 7 adds an explicit boundary test proving local web-index results stay in `web_search` and are not visible to `file_search` unless configured as a separate file-search source. |
| 10 | P1 | Citation annotation span behavior is approximate | Complete | Phase 5 replaces valid `[[source:N]]` placeholders with visible `[N]` markers and annotates those exact marker spans; invalid placeholders are removed safely. |
| 11 | P1 | Search ranking needs an evaluation fixture set | Complete | Phase 7 adds `test/fixtures/web-search-ranking/` plus tests for duplicate-engine boosts, exact-title ranking, date-bearing results, tracking cleanup, domain filters, local-index ranking, and file_search lexical ranking. |
| 12 | P1 | CJK tokenization is weak | Complete | Phase 7 adds shared Latin/CJK tokenization with CJK bigrams/trigrams and uses it across metasearch, retrieval chunk ranking, local web index, and file_search query terms. |
| 13 | P1 | HTML extraction needs quality fixtures | Complete | Phase 7 adds article/docs/CJK/malformed HTML fixtures and tests extraction of title, description, canonical URL, language, main text, code/table/list text, and chrome/hidden-content removal. |
| 14 | P1 | Metasearch engine parser snapshots need maintenance workflow | Complete | Phase 7 documents parser fixture policy in `docs/SEARCH_QUALITY_SCORING.md`; existing HTML engine fixtures continue to cover no-results, blocked/captcha, and tracking cleanup. |
| 15 | P1 | Package hygiene checker should scan shipped docs/examples | Complete | Phase 8 hardens `pnpm check-package-surface` to scan README, CHANGELOG, LICENSE, docs, examples, package.json, and the actual `npm pack --dry-run --json` tarball file list for secrets, private paths, generated artifacts, large files, binary artifacts, and host-app imports. |
| 16 | P1 | Hosted tool execution errors need clear policy | Complete | `docs/OBSERVABILITY_AND_ERROR_POLICY.md` defines request validation, security violation, recoverable provider error, fatal hosted tool error, and loop-exceeded policy. Cycle 2 adds typed loop-exceeded error handling with structured category and retry metadata for non-streaming and streaming adapter-emulated hosted-tool loops. |
| 17 | P1 | Provider capability presets need live behavior records | Partially done | Phase 9 records OpenRouter-compatible mixed-runtime behavior. Cycle 1 adds OpenRouter, DeepSeek, and DashScope/Qwen profile helpers plus `docs/PROVIDER_COMPATIBILITY_MATRIX.md`; Cycle 3 adds MiniMax and Moonshot/Kimi profile helpers. Broader live records remain pending credentials. |
| 18 | P2 | Deep search is currently heuristic | Partially done | `docs/DEEP_WEB_SEARCH_ROADMAP.md` documents heuristic opt-in status, planner interface, graph execution, reference merge, synthesis contract, and tests needed. |
| 19 | P2 | Observability should be structured | Partially done | Trace events are now sanitized at the server `emitTrace` exit, and `docs/OBSERVABILITY_AND_ERROR_POLICY.md` defines trace redaction policy. Search latency/cache/citation trace summaries remain future work. |
| 20 | P2 | CI and release automation | Complete | Phase 8 CI runs test, typecheck, build, consumer harness, boundary, package-surface, and pack dry-run checks. Publishing remains manual and `private: true` is unchanged. |

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

## Phase 5 Web Search Output And Citation Contract

Synthetic adapter-emulated `web_search` output is now explicit about what each include exposes.

- Default Responses output appends one aggregate `web_search_call` with `action.type: "search"`.
- `include: ["web_search_call.action.sources"]` adds only `action.sources` to the aggregate search item.
- `include: ["web_search_call.results"]` adds only the normalized `results` list to the aggregate search item.
- `include: ["web_search_call.actions"]` exposes detailed `open_page` and `find_in_page` `web_search_call` items.
- The host option `exposeWebSearchDetailedActions: true` can expose detailed actions without the request include.
- Valid answer placeholders such as `[[source:1]]` are replaced with visible `[1]` markers and `url_citation` annotations span those exact markers.
- Repeated sources can produce repeated annotations, invalid source ids are removed without fabricated annotations, CJK punctuation spacing is preserved, and multiple `output_text` parts are annotated independently.
- Streaming completed responses use the same hosted-tool output append path as non-streaming responses.

## Phase 6 File Search Pagination Contract

`file_search` now supports source-level cursors without replacing the existing signed global page token.

- `CodexProviderFileSearchSourceRequest` includes `pageSize` and `pageCursor`.
- `CodexProviderFileSearchSourceResult` can return `nextPage` and `hasMore`.
- Vector-store and remote-documents adapter contracts receive the same cursor fields.
- The signed `next_page` token keeps the existing global offset and request fingerprint, and also stores a per-source cursor map when sources return cursors.
- Existing offset-only tokens remain compatible because source cursors are optional in the token payload.
- Cursor-aware sources should use `pageSize` as the requested page size and treat `pageCursor` as an opaque source-owned cursor.
- The executor still validates token signatures, request fingerprints, and token shape before using pagination state.
- Filter/ranking coverage now includes additional `lte`, `ne`, and `nin` metadata filter cases together with `vector_store_ids` source scoping and `score_threshold`.

## Phase 7 Search Quality Contract

Search ranking and extraction now have deterministic local evaluation coverage.

- Web metasearch, local web index, retrieval chunk ranking, and file_search lexical ranking share CJK-aware tokenization.
- CJK runs emit the full phrase plus bigrams and trigrams; Latin tokens remain lowercased and hyphen/underscore split parts are also searchable.
- Metasearch scoring now boosts title-complete matches and exact-title matches in addition to rank, upstream score, title/snippet overlap, phrase matches, and duplicate-engine votes.
- File search lexical scoring now boosts documents whose title contains every query term.
- URL canonicalization and ranking fixtures cover duplicate engine evidence, tracking-parameter cleanup, exact-title matching, date-bearing results, domain filters, Chinese queries, local web-index ranking, and file_search ranking.
- HTML extraction now prefers `main` / `article`, strips common page chrome and hidden content, extracts canonical URLs, and has article/docs/CJK/malformed fixture coverage.
- The local web index remains a `web_search` facility only; Phase 7 adds a regression test proving file_search cannot read web-index content unless a host separately configures that content as a file_search source.
- The scoring and parser fixture maintenance policy is documented in `docs/SEARCH_QUALITY_SCORING.md`.

## Phase 8 Package Hygiene And CI Contract

Package hygiene checks now cover the source-side public surface and the real dry-run tarball contents.

- `pnpm check-package-surface` scans README, CHANGELOG, LICENSE, docs, examples, package.json, and the `npm pack --dry-run --json` file list.
- The checker rejects secret-looking literals, private workspace paths, `.env` files, generated cache/index/database/package artifacts, oversized shipped files, binary artifacts, and host-app hard imports.
- The tarball allowlist remains limited to `dist`, `README.md`, `CHANGELOG.md`, `LICENSE`, `docs`, `examples`, and `package.json`.
- CI now runs `pnpm check-package-surface` after `pnpm check-boundary` and before `pnpm pack:dry-run`.
- A public-surface test asserts the CI package hygiene gate stays present and ordered before dry-run packing.
- `docs/RELEASE_READINESS.md` records the current manual release posture and the latest dry-run tarball snapshot.
- Publishing remains manual; no npm auto-publish workflow is added and `private: true` remains unchanged.

## Phase 9 Live Smoke Evidence Contract

Live smoke evidence is recorded with secrets redacted and without changing release posture.

- `docs/LIVE_SMOKE_RESULTS.md` records the latest `pnpm smoke:web-search` evidence for adapter-emulated `web_search`.
- The web-search smoke covers the offline local-index path, non-streaming adapter-emulated `web_search`, streaming adapter-emulated `web_search`, exposed `web_search_call.action.sources`, exposed `web_search_call.results`, and citation annotations.
- `docs/LIVE_SMOKE_RESULTS.md` records the latest `pnpm smoke:host` evidence for mixed-runtime host integration.
- The host smoke covers normal Responses output, custom tool loop continuation, adapter-emulated `file_search`, non-streaming adapter-emulated `web_search`, and streaming adapter-emulated `web_search`.
- The 2026-06-10 run used OpenRouter-compatible upstream credentials from the local environment and built-in no-key metasearch because no Brave, Serper, or Tavily API key was present.
- Secrets remain redacted in the evidence file. `.env` values are not copied into repository docs.
- `private: true` remains unchanged; Phase 10 owns the public alpha release decision.

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

Phase 5 validation run on 2026-06-10:

```bash
pnpm test                # passed: 268 passing, 1 credential-gated integration skipped
pnpm typecheck           # passed
pnpm build               # passed
pnpm consumer:harness    # passed
pnpm check-boundary      # passed
pnpm pack:dry-run        # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/web_search_responses_output.test.ts test/public_surface.test.ts test/server.test.ts  # passed: 57 tests
git diff --check                                                                                              # passed
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

Phase 6 validation run on 2026-06-10:

```bash
pnpm test                # passed: 270 passing, 1 credential-gated integration skipped
pnpm typecheck           # passed
pnpm build               # passed
pnpm consumer:harness    # passed
pnpm check-boundary      # passed
pnpm pack:dry-run        # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/file_search_executor.test.ts test/server.test.ts test/adapter_hosted_tool_config_binding.test.ts  # passed: 80 tests
git diff --check                                                                                                           # passed
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

Phase 7 validation run on 2026-06-10:

```bash
pnpm test                # passed: 277 passing, 1 credential-gated integration skipped
pnpm typecheck           # passed
pnpm build               # passed
pnpm consumer:harness    # passed
pnpm check-boundary      # passed
pnpm pack:dry-run        # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/search_quality_phase7.test.ts test/web_search_retrieval.test.ts test/web_search_local_index.test.ts test/web_search_metasearch_core.test.ts test/file_search_executor.test.ts test/web_search_html_engines.test.ts  # passed: 64 tests
git diff --check                                                                                                                                                                                       # passed
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

Phase 8 validation run on 2026-06-10:

```bash
pnpm test                  # passed: 278 passing, 1 credential-gated integration skipped
pnpm typecheck             # passed
pnpm build                 # passed
pnpm consumer:harness      # passed
pnpm check-boundary        # passed
pnpm check-package-surface # passed
pnpm pack:dry-run          # passed
```

Additional focused validation:

```bash
pnpm exec tsx --test test/public_surface.test.ts  # passed: 11 tests
git diff --check                                  # passed
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

Phase 9 validation run on 2026-06-10:

```bash
pnpm smoke:web-search  # first live attempt built successfully, then failed because the streaming model answer omitted a citation annotation; rerun passed and appended redacted evidence
pnpm smoke:host        # passed and appended redacted evidence
```

Live smoke status:

```bash
CODEX_PROVIDER_API_KEY=present
CODEX_PROVIDER_MODEL=present
OPENROUTER_API_KEY=present
OPENROUTER_MODEL=present
BRAVE_SEARCH_API_KEY=missing
SERPER_API_KEY=missing
TAVILY_API_KEY=missing
```

The successful Phase 9 smoke runs used OpenRouter-compatible upstream credentials and built-in no-key metasearch. Redacted evidence is recorded in `docs/LIVE_SMOKE_RESULTS.md`.

Recursive quality Cycle 1 validation run on 2026-06-10:

```bash
node scripts/recursive-quality-cycle.mjs scan  # passed: 13 low-severity CLI console-output findings, no high findings
pnpm test                                      # passed: 279 passing, 1 credential-gated integration skipped
pnpm typecheck                                 # passed
pnpm build                                     # passed
pnpm consumer:harness                          # passed
pnpm check-boundary                            # passed
pnpm check-package-surface                     # passed
pnpm pack:dry-run                              # passed: 593 files, 346.1 kB package size, 1.5 MB unpacked
```

Additional focused validation:

```bash
pnpm exec tsx --test test/profiles.test.ts test/public_surface.test.ts test/server.test.ts                                      # passed: 56 tests
pnpm exec tsx --test test/adapter_hosted_tool_config_binding.test.ts test/server.test.ts                                        # passed: 45 tests
```

Live smoke status:

```bash
CODEX_PROVIDER_API_KEY=missing
OPENROUTER_API_KEY=missing
DEEPSEEK_API_KEY=missing
DASHSCOPE_API_KEY=missing
QWEN_API_KEY=missing
MINIMAX_API_KEY=missing
KIMI_API_KEY=missing
BRAVE_SEARCH_API_KEY=missing
SERPER_API_KEY=missing
TAVILY_API_KEY=missing
SEARXNG_ENDPOINT=missing
OPENSERP_ENDPOINT=missing
```

`pnpm smoke:web-search` and `pnpm smoke:host` were run and skipped live upstream/API-backed evidence because credentials were absent. The web-search smoke still verified the offline local-index path. Skip evidence is recorded in `docs/LIVE_SMOKE_RESULTS.md`.

Recursive quality Cycle 2 validation run on 2026-06-10:

```bash
node scripts/recursive-quality-cycle.mjs scan  # passed: 0 findings
pnpm test                                      # passed: 281 passing, 1 credential-gated integration skipped
pnpm typecheck                                 # passed
pnpm build                                     # passed
pnpm consumer:harness                          # passed
pnpm check-boundary                            # passed
pnpm check-package-surface                     # passed
pnpm pack:dry-run                              # passed: 593 files, 347.4 kB package size, 1.5 MB unpacked
```

Additional focused validation:

```bash
pnpm exec tsx --test test/server.test.ts  # passed: 40 tests
git diff --check                          # passed
```

Recursive quality Cycle 3 validation run on 2026-06-11:

```bash
node scripts/recursive-quality-cycle.mjs scan  # passed: 0 findings
pnpm test                                      # passed: 281 passing, 1 credential-gated integration skipped
pnpm typecheck                                 # passed
pnpm build                                     # passed
pnpm consumer:harness                          # passed
pnpm check-boundary                            # passed
pnpm check-package-surface                     # passed
pnpm pack:dry-run                              # passed: 593 files, 348.3 kB package size, 1.6 MB unpacked
```

Additional focused validation:

```bash
pnpm exec tsx --test test/profiles.test.ts test/public_surface.test.ts  # passed: 18 tests
git diff --check                                                        # passed
```
