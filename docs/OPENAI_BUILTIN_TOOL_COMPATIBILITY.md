# OpenAI Built-in Tool Compatibility

This document tracks how `@codex-provider/core` maps OpenAI Responses built-in tools to package-owned behavior.

Historical package and tool names are documented only in archived migration notes. The active package surface uses canonical `@codex-provider/core` exports and canonical hosted tool names.

The package goal is not to pretend every upstream provider supports OpenAI hosted tools. It must make each tool mode explicit:

- `provider-native`: forward the OpenAI tool only when the upstream actually supports the same hosted tool semantics.
- `adapter-emulated`: expose a Chat function proxy, execute the matching package/host executor, append tool output, and continue the model loop.
- `codex-local-first`: leave execution to Codex app-server / Codex CLI / host-owned local tool orchestration.
- `declaration-only`: the package may recognize the tool name, but it is not executable without a future executor contract.

## Source Baseline

Official OpenAI docs checked for this matrix:

- Responses tools overview: https://platform.openai.com/docs/guides/tools?api-mode=responses
- Responses API reference: https://platform.openai.com/docs/api-reference/responses/create?api-mode=responses
- Web search: https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses
- File search: https://platform.openai.com/docs/guides/tools-file-search
- Remote MCP / connectors: https://platform.openai.com/docs/guides/tools-remote-mcp
- Image generation tool: https://platform.openai.com/docs/guides/tools-image-generation
- Code interpreter tool: https://platform.openai.com/docs/guides/tools-code-interpreter
- Computer use: https://platform.openai.com/docs/guides/tools-computer-use
- Codex manual for Codex-local skills, MCP, shell, computer, and local execution surfaces.

## Compatibility Matrix

| Tool | OpenAI tool type | Current support | Tool mode | Executor required | Output parity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Web search | `web_search` | Strong v1. Adapter executor supports native metasearch, Tavily/Brave/Serper API engines, no-key HTML engines, SearXNG/OpenSERP endpoint adapters, retrieval/chunking, local cache indexes, optional deep-search custom tooling, deterministic ranking/extraction fixtures, and request-level `tools[]` config binding for adapter-emulated execution. | `provider-native` / `adapter-emulated` | Yes for `adapter-emulated` | Strong adapter parity for synthetic `web_search_call`, include-gated `action.sources` / `results`, explicit detailed `actions`, and `[[source:N]]` conversion to visible `[N]` markers with `url_citation` annotations. Adapter-emulated calls bind request `filters`, `search_context_size`, `return_token_budget`, `user_location`, `external_web_access`, and result limits before executor execution, so model function args cannot drop or loosen request constraints. Exact OpenAI hosted index quality is not claimed. Local ranking policy is documented in `docs/SEARCH_QUALITY_SCORING.md`. | P1 done |
| File search | `file_search` | Strong v1. Local-fs, memory, sqlite-fts, in-memory-vector, local-vector, cache fingerprint, RRF, safety bounds, shared CJK-aware lexical tokenization, vector-store contract, remote-doc contract, signed global and per-source cursor pagination, `include: ["file_search_call.results"]` exposure, and request-level `tools[]` config binding exist. | `adapter-emulated` | Yes | Strong adapter parity for OpenAI-like `data[]`, `has_more` / `next_page`, and synthetic `file_search_call.results`. Adapter-emulated calls bind request `vector_store_ids`, `filters`, `ranking_options`, `max_num_results`, and `include_content` before executor execution, so model function args cannot bypass request scoping. Exact OpenAI-hosted retrieval annotations are not claimed. Local ranking policy is documented in `docs/SEARCH_QUALITY_SCORING.md`. | P1 done |
| Tool search | `tool_search` as package-owned deferred discovery surface. | Partial. Registry/converter/server loop support adapter-emulated `tool_search`; `createCodexProviderToolSearchExecutor()` can return deferred function tools and namespaces. | `adapter-emulated` / client-deferred | Yes | Partial. Returned tools are appended to the next Chat request; no provider-native output item is synthesized. | P2 done |
| Remote MCP / connectors | `mcp` | No package executor. OpenAI-hosted Responses can use `mcp`; Codex hosts may also handle MCP locally. | `provider-native` / `codex-local-first`; future `adapter-emulated` only with explicit host adapter | Yes for adapter | No | P2 |
| Skills | Not an OpenAI Responses hosted tool type; Codex-local customization surface. | No package support. Should stay host/Codex-local unless modeled as deferred tool definitions later. | `codex-local-first` | No package executor by default | Not applicable | P2 |
| Image generation | `image_generation` | Partial. Registry/converter/server loop support adapter-emulated `image_generation`; `createCodexProviderImageGenerationExecutor()` exposes a host-supplied provider contract. | `provider-native` / `adapter-emulated` | Yes for adapter | Partial. Opt-in `image_generation_call` output can be appended; no default image provider is bundled. | P3 done |
| Code interpreter | `code_interpreter` | Partial. Registry/converter/server loop support adapter-emulated `code_interpreter`; `createCodexProviderCodeInterpreterExecutor()` exposes a host-supplied sandbox contract. | `provider-native` / `adapter-emulated` | Yes for adapter | Partial. stdout/stderr/result/files are returned as tool output; stdout/stderr can stream through hosted tool SSE deltas. No default sandbox is bundled. | P4 done |
| Computer | `computer` | Partial. Registry/converter/server loop support adapter-emulated `computer`; `createCodexProviderComputerExecutor()` exposes a host-supplied computer adapter contract. | `codex-local-first` first / `provider-native` / `adapter-emulated` only with explicit executor | Yes for adapter | Partial. actions/display are normalized and screenshot/observations are returned as tool output. No default computer control is bundled. | P5 done |
| Shell | Codex-local tool surface, not a general OpenAI hosted tool. Existing converter has Codex built-in context handling for `local_shell`. | Partial Codex-local conversion only. No hosted adapter shell executor. | `codex-local-first`; future `adapter-emulated` should remain unsafe and opt-in only | Yes for adapter | Partial for Codex-local custom-tool conversion only | P5 |
| Local shell | `local_shell` in Codex-local context, not a general public OpenAI hosted tool. | Partial Codex-local conversion only. | `codex-local-first` | No package executor by default | Partial | Keep local-first |
| Apply patch | Codex custom tool `apply_patch` | Strong Codex++ proxy conversion for structured Chat tool calls and response reconstruction. | `codex-local-first` | Codex executes; package only translates/proxies | Strong for current Codex custom-tool bridge | Keep |

## Current Package Reality

Current public package surface already exports:

- `createCodexProviderWebSearchExecutor`
- `createCodexProviderFileSearchExecutor`
- `createCodexProviderToolSearchExecutor`
- `createCodexProviderCodeInterpreterExecutor`
- `createCodexProviderComputerExecutor`
- `createCodexProviderImageGenerationExecutor`
- `createCodexProviderOpenAICompatibleImageGenerationProvider`
- hosted tool declarations and executor registry
- Responses-to-Chat and Chat-to-Responses converters
- local Responses adapter server
- profile/runtime helpers

Current implementation now centralizes canonical built-in metadata in `src/builtin-tools/`, with adapter-specific wiring still present in:

- `src/hosted_tools.ts`
- `src/hosted_tool_executors.ts`
- `src/converters/responses-adapter/`
- `src/server/responses-adapter-server/`
- `src/converters/codex_tool_context.ts`

The next phase should keep moving heavy or unsafe tools behind explicit executor contracts without changing existing public behavior.

## Required Semantics

1. Hosted tools must be explicit.
   Example: `{ name: "file_search", mode: "adapter-emulated" }`.

2. Adapter-emulated tools must have registered executors.
   Example: `hostedToolExecutors.file_search = createCodexProviderFileSearchExecutor(...)`.

3. Provider-native tools must only be forwarded when provider capabilities explicitly say they are supported.

4. Unsafe tools remain disabled by default:
   - `computer`
   - `shell`
   - `local_shell`
   - `code_interpreter`
   - `apply_patch` execution

5. Codex-local tools remain Codex-local unless the host opts into an explicit adapter executor.

6. Adapter-emulated hosted tool request config is executor-bound.
   For OpenAI Responses `tools[]` entries, hosted tool configuration is request-level policy, not model-owned function-call data. The adapter extracts the request tool declaration config, attaches it to matching Chat function tool calls, and merges it into executor arguments for both non-streaming and streaming hosted tool loops.

   Web search merge policy:
   - query fields come from model function args.
   - request `search_context_size`, `return_token_budget`, and `user_location` win when present.
   - `external_web_access: false` dominates.
   - `filters.allowed_domains` are intersected.
   - `filters.blocked_domains` are unioned.
   - result limits use the smaller positive value.

   File search merge policy:
   - query fields come from model function args.
   - request `vector_store_ids` constrain model vector ids by intersection.
   - request and model `filters` are combined with `and`.
   - result limits use the smaller positive value.
   - `include_content: false` dominates.

## Priority Plan

### P1: Registry and canonical names

- Done: added `src/builtin-tools/`.
- Done: defined canonical tool names.
- Done: canonical hosted tool names are required at declaration and execution boundaries.
- Done: replaced distributed built-in checks with registry-backed facade functions where they affect hosted adapter exposure.
- Done: canonical public API and tests are enforced.

### P1: File search parity hardening

- Preserve current executor output page.
- Add Responses `include: ["file_search_call.results"]` observability strategy.
- Standardize result content fields across all sources.
- Add more metadata filter parity tests.
- Add vector-store and remote-doc source contracts only; do not bind Qdrant/LanceDB/pgvector.
- Done: source adapters can receive `pageCursor` / `pageSize` and return `nextPage` / `hasMore`; the executor preserves per-source cursors inside the signed `next_page` token while keeping the global offset and request fingerprint checks.

### P2: Web search v2

- Done: parse `search_context_size`, `user_location`, `filters`, `external_web_access`, and OpenAI-compatible `return_token_budget` values (`default` / `unlimited`).
- Done: `return_token_budget` is OpenAI-strict by default. `null`, numbers, and other strings return `invalid_request_error`; hosts can opt into `webSearchInvalidParameterStrategy: "drop"` / `CODEX_PROVIDER_WEB_SEARCH_INVALID_PARAMETER_STRATEGY=drop` to remove invalid values with warnings.
- Done: metasearch page retrieval defaults on for OpenAI-like grounding and citation quality. Budgets are bounded by `search_context_size` (`low` 1 page, `medium` 3 pages, `high` 5 pages), and hosts can explicitly set `fetchPages: false` for snippet-only search.
- Done: Tavily/Brave/Serper providers are available as API search engines.
- Done: added no-key HTML engines, SearXNG/OpenSERP endpoint adapters, retrieval/chunking, local cache indexes, and optional deep-search graph runtime.
- Done: synthetic Responses output now appends aggregate `web_search_call`, supports `include: ["web_search_call.action.sources", "web_search_call.results"]`, emits optional standard `open_page` / `find_in_page` action items only through `include: ["web_search_call.actions"]` or `exposeWebSearchDetailedActions: true`, and converts `[[source:N]]` placeholders into visible `[N]` markers with `url_citation` annotations on those markers.
- UI guidance: `web_search_call.action.sources` is the recommended OpenAI-aligned path for displaying complete consulted URLs. `web_search_call.results` stays available for adapter debugging, compatibility, and raw normalized result inspection.

### P2: Tool search / MCP / skills planning

- Done: added `createCodexProviderToolSearchExecutor()`.
- Done: adapter-emulated `tool_search` can return deferred function tools/namespaces and append them to the next Chat request.
- Treat OpenAI `mcp` separately from Codex-local MCP.
- Treat Codex skills as local/deferred tool definitions, not OpenAI hosted tools.
- `tool_search` remains guarded by explicit hosted tool declaration plus registered executor.

### P3-P5: Unsafe or heavy tools

- Done for `image_generation`: executor contract and optional OpenAI-compatible image provider factory exist, but no provider is enabled by default.
- Done for `code_interpreter`: executor contract exists and supports stdout/stderr hosted tool deltas, but no sandbox is enabled by default.
- Done for `computer`: executor contract exists and supports actions/display plus screenshot/observation output, but no computer-control adapter is enabled by default.
- Do not provide default executors for unsafe or environment-controlling tools.
- Require host-owned sandbox, approval, and safety policy.

## Non-Goals For This Phase

- No external vector DB adapter implementation.
- No sqlite driver dependency.
- No Qdrant, LanceDB, pgvector, sqlite-vec dependency.
- No CodexBridge/CodexNext session or UI logic.
- No shell/computer/code execution default.
- No package publishing switch; `private: true` stays until package readiness is complete.

## Package Independence Status

- Done: formal `CodexProviderTraceEvent` and `CodexProviderTraceSink` names are exported.
- Done: formal standalone server helpers are exported:
  - `createCodexProviderStandaloneServerConfigFromEnv`
  - `createCodexProviderStandaloneServerFromEnv`
  - `loadCodexProviderStandaloneEnvFile`
  - `resolveCodexProviderStandaloneServerEnv`
- Done: only canonical `CodexProvider*` exports are part of the active root surface.
- Done: standalone deployments can use `CODEX_PROVIDER_*` environment variables while the env namespace remains stable.
- Done: host-neutral examples and recipes exist under `examples/` and `docs/RECIPES.md`.
- Done: live smoke recipes, unsafe tool security notes, and release-readiness policy docs exist.
- Done: redacted OpenRouter-compatible and DashScope/Qwen live smoke evidence is recorded in `docs/LIVE_SMOKE_RESULTS.md` for adapter-emulated `web_search`, streaming `web_search`, `file_search`, custom tool loop, and mixed-runtime host integration.
- Remaining: finalize the public alpha release decision. Additional provider-preset live records and API-key-backed search-provider smoke remain future validation work.
