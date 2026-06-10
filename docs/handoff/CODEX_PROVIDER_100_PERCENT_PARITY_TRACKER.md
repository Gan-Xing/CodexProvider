# CodexProvider 100 Percent Parity Tracker

Last updated: 2026-06-10

Scope source: `docs/handoff/CODEX_PROVIDER_DEEP_AUDIT_100_PERCENT_PARITY_HANDOFF.md`

Branch policy: all future changes must be made on `main`. Do not create or switch to a separate working branch unless the user explicitly requests it.

## Current Scope

This tracker is the living audit snapshot for the 100 percent parity loop. The current implementation scope is intentionally limited to:

- Phase 0: baseline/audit tracker.
- Phase 1: hosted tool request-config binding for adapter-emulated `web_search` and `file_search`.

Out of scope for this pass:

- DNS-complete SSRF hardening.
- Metasearch mode rewrites, engine ranking, extraction quality work, or byte-limit changes.
- File source rewrites or web-index/file-search mixing.
- Package publishing, dependency additions, or changing `private: true`.

## Phase Status

| Phase | Title | Status | Evidence |
| --- | --- | --- | --- |
| Phase 0 | Baseline and audit snapshot | Complete | Tracker created and final local gate passed on 2026-06-10. |
| Phase 1 | Hosted tool request-config binding | Complete | Binding implementation, docs, and focused tests added. Final local gate passed on 2026-06-10. |
| Phase 2 | Network safety and SSRF hardening | Not started | Out of current scope. |
| Phase 3 | True metasearch modes, timeouts, and limits | Not started | Out of current scope. |
| Phase 4 | Request validation expansion | Not started | Out of current scope. |
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
| 2 | P0 | SSRF protection is not DNS-complete | Not started | Future Phase 2. |
| 3 | P0 | `fast` metasearch mode is not actually fast | Not started | Future Phase 3. |
| 4 | P0 | Search processor has no response byte limit | Not started | Future Phase 3. |
| 5 | P0 | Live smoke evidence remains the real release gate | Not started | Future Phase 9. |
| 6 | P1 | Detailed web_search actions need a stable compatibility policy | Partially done before this phase | Existing docs/tests gate detailed actions behind includes/options; not changed here. |
| 7 | P1 | Request validation should cover more hosted tool fields | Not started | Future Phase 4. |
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

## Validation Log

Validation run on 2026-06-10:

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
