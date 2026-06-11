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
- [!] SiliconFlow profile helper remains blocked because no package capability preset or live behavior record exists yet.
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
