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

- [ ] Audit README.md, CHANGELOG.md, docs/RELEASE_READINESS.md, and docs/INDEPENDENT_PACKAGE_CHECKLIST.md for public-alpha readiness.
- [ ] Add/update docs/PUBLIC_ALPHA_RELEASE_PLAN.md with private:true decision, alpha version policy, npm scope checklist, manual publish steps, and no-auto-publish policy.
- [ ] Confirm pnpm pack:dry-run snapshot is current.
- [ ] Confirm shipped package surface contains no host-app dependency or secrets.

### C1-B Provider Compatibility Matrix

- [ ] Add/update docs/PROVIDER_COMPATIBILITY_MATRIX.md.
- [ ] Include OpenRouter, DeepSeek official, DashScope/Qwen, SiliconFlow, MiniMax, Moonshot/Kimi, and OpenAI direct Responses.
- [ ] For each provider include base URL env, model env, protocol, recommended profile mode, tools support, streaming support, forced tool behavior, file_search status, web_search status, quirks, and evidence status.
- [ ] Link existing OpenRouter smoke evidence.
- [ ] Mark providers without credentials as `[!] Pending credentials`; do not fake results.

### C1-C Provider Presets

- [ ] Audit profile/runtime modules to choose the right provider preset location.
- [ ] Implement minimal provider preset API for OpenRouter and DeepSeek official.
- [ ] Add DashScope/Qwen preset if time allows.
- [ ] Add root exports.
- [ ] Add unit tests for base URLs, profile mode, provider capabilities, and env naming.
- [ ] Update README or docs/RECIPES.md with preset usage.

### C1-D Web Search Productization

- [ ] Audit examples/live-web-search-smoke.ts for explicit API-backed Brave/Serper/Tavily selection.
- [ ] Add env-driven provider selection if missing: CODEX_PROVIDER_WEB_SEARCH_PROVIDER=brave|serper|tavily|builtin-metasearch.
- [ ] Document required API key env names.
- [ ] Document no-key metasearch vs API-backed search tradeoffs.
- [ ] If credentials exist, run API-backed smoke and record evidence.
- [ ] If credentials are missing, mark as `[!] Pending credentials`.

### C1-E Deep Search / Observability / Error Policy

- [ ] Audit src/web-search/deep/ and document current heuristic/opt-in status.
- [ ] Add/update docs/DEEP_WEB_SEARCH_ROADMAP.md.
- [ ] Add/update docs/OBSERVABILITY_AND_ERROR_POLICY.md.
- [ ] Define request validation error, security violation, recoverable hosted tool provider error, fatal hosted tool error, tool loop exceeded, and trace redaction policy.
- [ ] Check existing traces do not expose secrets or full document contents.
- [ ] If typed fatal hosted tool errors require code changes beyond this cycle, add them to the next cycle backlog.

### C1-F Validation + Counter

- [ ] Run node scripts/recursive-quality-cycle.mjs scan and inspect the report.
- [ ] Run pnpm test.
- [ ] Run pnpm typecheck.
- [ ] Run pnpm build.
- [ ] Run pnpm consumer:harness.
- [ ] Run pnpm check-boundary.
- [ ] Run pnpm check-package-surface.
- [ ] Run pnpm pack:dry-run.
- [ ] Update this backlog so no unchecked `- [ ]` remains in Cycle 1.
- [ ] Commit and push.
- [ ] Run node scripts/recursive-quality-cycle.mjs complete-cycle.
<!-- cycle:1:end -->
