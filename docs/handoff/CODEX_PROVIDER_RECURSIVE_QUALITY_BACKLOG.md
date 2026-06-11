# CodexProvider Recursive Quality Backlog

This file is managed by the recursive quality loop.

Cycle semantics:

- A cycle is counted only after every item in the active cycle is completed (`- [x]`) or explicitly resolved as an external blocker (`- [!]`).
- A single subtask does not count as a cycle.
- After one cycle is completed and validated, re-audit the project and generate the next cycle's backlog.
- Stop when 20 cycles are completed or London time reaches 2026-06-11 05:30.

<!-- cycle:1:start -->
## Cycle 1 Backlog

### C1-A Release Readiness

- [x] Audit README.md, CHANGELOG.md, docs/RELEASE_READINESS.md, and docs/INDEPENDENT_PACKAGE_CHECKLIST.md for public-alpha readiness.
- [x] Add/update docs/PUBLIC_ALPHA_RELEASE_PLAN.md with private:true decision, alpha version policy, npm scope checklist, manual publish steps, and no-auto-publish policy.
- [x] Confirm pnpm pack:dry-run snapshot is current.
- [x] Confirm shipped package surface contains no host-app dependency or secrets.

### C1-B Provider Compatibility Matrix

- [x] Add/update docs/PROVIDER_COMPATIBILITY_MATRIX.md.
- [x] Include OpenRouter, DeepSeek official, DashScope/Qwen, SiliconFlow, MiniMax, Moonshot/Kimi, and OpenAI direct Responses.
- [x] For each provider include base URL env, model env, protocol, recommended profile mode, tools support, streaming support, forced tool behavior, file_search status, web_search status, quirks, and evidence status.
- [x] Link existing OpenRouter smoke evidence.
- [x] Mark providers without credentials as `[!] Pending credentials`; do not fake results.

### C1-C Provider Presets

- [x] Audit profile/runtime modules to choose the right provider preset location.
- [x] Implement minimal provider preset API for OpenRouter and DeepSeek official.
- [x] Add DashScope/Qwen preset if time allows.
- [x] Add root exports.
- [x] Add unit tests for base URLs, profile mode, provider capabilities, and env naming.
- [x] Update README or docs/RECIPES.md with preset usage.

### C1-D Web Search Productization

- [x] Audit examples/live-web-search-smoke.ts for explicit API-backed Brave/Serper/Tavily selection.
- [x] Add env-driven provider selection if missing: CODEX_PROVIDER_WEB_SEARCH_PROVIDER=brave|serper|tavily|builtin-metasearch.
- [x] Document required API key env names.
- [x] Document no-key metasearch vs API-backed search tradeoffs.
- [!] Pending credentials: API-backed Brave/Serper/Tavily smoke was not run because `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, and `TAVILY_API_KEY` were absent.
- [x] If credentials are missing, mark as `[!] Pending credentials`.

### C1-E Deep Search / Observability / Error Policy

- [x] Audit src/web-search/deep/ and document current heuristic/opt-in status.
- [x] Add/update docs/DEEP_WEB_SEARCH_ROADMAP.md.
- [x] Add/update docs/OBSERVABILITY_AND_ERROR_POLICY.md.
- [x] Define request validation error, security violation, recoverable hosted tool provider error, fatal hosted tool error, tool loop exceeded, and trace redaction policy.
- [x] Check existing traces do not expose secrets or full document contents.
- [x] If typed fatal hosted tool errors require code changes beyond this cycle, add them to the next cycle backlog.

### C1-F Validation + Counter

- [x] Run node scripts/recursive-quality-cycle.mjs scan and inspect the report.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 1.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:1:end -->


<!-- cycle:2:start -->
## Cycle 2 Backlog

### C2-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 2 implementation scope: clear CLI scan noise, type hosted-tool loop-exceeded errors, add focused tests, update docs.

### C2-B CLI Scan Noise

- [x] Replace intentional standalone CLI stdout logging with a local stdout writer so recursive scan no longer reports low `console.log` findings in `src/cli.ts`.

### C2-C Hosted Tool Loop Error Taxonomy

- [x] Add a typed hosted-tool loop-exceeded error helper for non-streaming and streaming adapter-emulated hosted-tool loops.
- [x] Return `category: "unsupported_feature"` and retry metadata for `hosted_tool_loop_exceeded` and `hosted_tool_streaming_loop_exceeded`.
- [x] Add server tests that exercise both loop-exceeded paths through `/v1/responses`.

### C2-D Docs

- [x] Update observability/error policy docs to move typed loop-exceeded errors from future work to current behavior.
- [x] Update changelog for the Cycle 2 error metadata fix.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 2.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:2:end -->


<!-- cycle:3:start -->
## Cycle 3 Backlog

### C3-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 3 implementation scope: extend provider profile helper coverage for documented providers with existing capability presets.

### C3-B Provider Profile Presets

- [x] Add `createCodexProviderMiniMaxProfile()` backed by the existing MiniMax capability preset.
- [x] Add `createCodexProviderMoonshotKimiProfile()` backed by the existing Kimi capability preset.
- [x] Preserve provider preset metadata for env names, default base URLs, recommended mode, upstream path, and capability metadata.
- [x] Add profile tests for MiniMax and Moonshot/Kimi defaults.
- [x] Update root public-surface expectations for the new helpers.

### C3-C Documentation

- [x] Update README and recipes with the expanded helper surface.
- [x] Update provider compatibility matrix to mark MiniMax and Moonshot/Kimi profile helpers as available while live evidence remains `[!] Pending credentials`.
- [x] Update the recursive loop handoff planned-helper list to match the actual helper names.
- [!] Cycle 3 left SiliconFlow profile helper blocked because no package capability preset or live behavior record existed yet; Cycle 5 adds package coverage while live evidence remains pending credentials.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 3.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:3:end -->


<!-- cycle:4:start -->
## Cycle 4 Backlog

### C4-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 4 implementation scope: close hosted-tool SSE trace redaction test coverage.

### C4-B Observability Redaction Coverage

- [x] Add a server regression test that emits fake-secret content through hosted-tool SSE delta metadata and completed output preview.
- [x] Verify client SSE still carries executor output while mirrored trace events sent to `traceSink` are redacted.
- [x] Update observability docs to remove hosted-tool SSE redaction tests from future work.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 4.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:4:end -->


<!-- cycle:5:start -->
## Cycle 5 Backlog

### C5-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 5 implementation scope: add conservative SiliconFlow capability/profile helper coverage.

### C5-B SiliconFlow Provider Coverage

- [x] Add a SiliconFlow OpenAI-compatible capability preset with base URL, default model, env prefix, and conservative text-only multimodal metadata.
- [x] Add `createCodexProviderSiliconFlowProfile()` with stable `SILICONFLOW_*` env metadata and root export coverage.
- [x] Add focused tests for SiliconFlow capability metadata, provider profile metadata, and the audited public surface.
- [x] Update README, recipes, provider matrix, tracker, changelog, and recursive handoff notes.
- [!] Live SiliconFlow forced-tool and streaming behavior remains pending credentials; do not mark provider evidence as passed without a live smoke.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 5.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:5:end -->


<!-- cycle:6:start -->
## Cycle 6 Backlog

### C6-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 6 implementation scope: add count-only citation placeholder trace summaries.

### C6-B Citation Observability

- [x] Return citation placeholder annotation summary metadata from the web-search annotation path.
- [x] Emit `web_search.citations` trace events for non-streaming and streaming adapter-emulated web search output merging.
- [x] Cover valid and missing-source placeholder counts without tracing answer text or source document bodies.
- [x] Update observability docs, tracker, changelog, and recursive backlog.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 6.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:6:end -->


<!-- cycle:7:start -->
## Cycle 7 Backlog

### C7-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 7 implementation scope: add count-only adapter-emulated web-search execution trace summaries.

### C7-B Web Search Execution Observability

- [x] Emit `web_search.executed` trace events for non-streaming and streaming adapter-emulated `web_search` executions.
- [x] Include only operational metadata: stream flag, call id, execution status, duration, result/source/document/chunk/retrieval-error/unresponsive-engine/timing/warning counts, external-web-access flag, search-context size, and mode.
- [x] Add regression coverage proving the trace omits query text, URLs, snippets, retrieved documents, and raw result payloads.
- [x] Update observability docs, tracker, changelog, and recursive backlog.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 7.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:7:end -->


<!-- cycle:8:start -->
## Cycle 8 Backlog

### C8-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 8 implementation scope: add retrieval cache hit/miss counts to web-search execution observability.

### C8-B Retrieval Cache Observability

- [x] Add `retrievalCacheHitCount` and `retrievalCacheMissCount` to `web_search.executed` traces.
- [x] Add the same retrieval cache counts to standard web-search executor metadata.
- [x] Cover cache-hit and cache-miss behavior without tracing query text, URLs, snippets, or retrieved document bodies.
- [x] Update observability docs, tracker, changelog, and recursive backlog.
- [x] Leave local-index hit/miss trace summaries for a future cycle because they require engine-level instrumentation beyond retrieval document metadata.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 8.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:8:end -->


<!-- cycle:9:start -->
## Cycle 9 Backlog

### C9-A Audit

- [x] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [x] Generate a concrete backlog for this cycle based on current repository state.
- [x] Identify Cycle 9 implementation scope: add local-index hit/miss counts to web-search observability.

### C9-B Local Index Observability

- [x] Mark local-index search engines so metasearch can identify local-index outcomes without inspecting result text.
- [x] Add local-index hit/miss summary metadata to metasearch-backed web-search responses.
- [x] Add `localIndexHitCount` and `localIndexMissCount` to `web_search.executed` traces.
- [x] Cover local-index hit and miss behavior without tracing query text, URLs, snippets, or indexed document bodies.
- [x] Update observability docs, tracker, changelog, and recursive backlog.
- [x] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [x] Run node scripts/recursive-quality-cycle.mjs scan.
- [x] Run pnpm test.
- [x] Run pnpm typecheck.
- [x] Run pnpm build.
- [x] Run pnpm consumer:harness.
- [x] Run pnpm check-boundary.
- [x] Run pnpm check-package-surface.
- [x] Run pnpm pack:dry-run.
- [x] Update this backlog so no unchecked `- [ ]` remains in Cycle 9.
- [x] Commit and push.
- [x] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:9:end -->


<!-- cycle:10:start -->
## Cycle 10 Backlog

### Audit

- [ ] Re-audit the five target streams: release readiness, provider matrix/presets, web_search productization, deep search, observability/error policy.
- [ ] Generate a concrete backlog for this cycle based on current repository state.
- [ ] Complete all generated backlog items or mark external blockers with `- [!]`.

### Validation

- [ ] Run node scripts/recursive-quality-cycle.mjs scan.
- [ ] Run pnpm test.
- [ ] Run pnpm typecheck.
- [ ] Run pnpm build.
- [ ] Run pnpm consumer:harness.
- [ ] Run pnpm check-boundary.
- [ ] Run pnpm check-package-surface.
- [ ] Run pnpm pack:dry-run.
- [ ] Update this backlog so no unchecked `- [ ]` remains in Cycle 10.
- [ ] Commit and push.
- [ ] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:10:end -->
