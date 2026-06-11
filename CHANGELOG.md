# Changelog

## Unreleased

### Added

- Added public alpha release plan, provider compatibility matrix, deep web search roadmap, and observability/error policy docs.
- Added OpenRouter, DeepSeek, and DashScope/Qwen provider profile helpers with env and capability metadata.
- Added MiniMax and Moonshot/Kimi provider profile helpers with env and capability metadata.
- Added SiliconFlow provider capability and profile helper coverage with env metadata.
- Added hosted-tool SSE trace redaction regression coverage.
- Added count-only `web_search.citations` trace summaries for adapter-emulated web search output annotations.
- Added count-only `web_search.executed` trace summaries for adapter-emulated web search execution results.
- Added retrieval cache hit/miss counts to web-search executor metadata and `web_search.executed` traces.
- Added local-index hit/miss counts to metasearch-backed web-search metadata and `web_search.executed` traces.
- Added heuristic deep-search planner diagnostics and fixture coverage for decomposition, graph rejection, and reference merging.
- Added deep-search response and executor metadata diagnostics for failed subqueries, unresponsive engines, and planner budget counts.
- Added an opt-in deep-search custom hosted-tool recipe and regression coverage for keeping it separate from default `web_search`.
- Added deep-search no-supporting-evidence response and executor metadata for empty research graphs.
- Added optional deep-search minimum-source diagnostics and hosted-tool metadata for limited-evidence results.

### Changed

- Added explicit `CODEX_PROVIDER_WEB_SEARCH_PROVIDER` selection for live web-search smoke runs.
- Sanitized trace events before invoking `traceSink` by redacting secret-looking values and truncating large payloads.
- Returned structured category and retry metadata for non-streaming and streaming adapter-emulated hosted-tool loop exhaustion.

## 0.1.0-alpha.0

### Added

- Extracted CodexProvider into a standalone private package repository.
- Added root-entrypoint runtime, profile, converter, hosted-tool, web_search, file_search, image generation, code interpreter, computer, and tool_search surfaces.
- Added standalone consumer, web_search live smoke, and host integration smoke harnesses that validate root package consumption without host-app internals.

### Changed

- Kept `private: true` while provider live smoke evidence remains incomplete.
- Kept root `exports` limited to `.` and `./package.json`; no subpath exports are published.
- Removed historical Relay/Gateway compatibility aliases from the active package surface.

### Validation

- Package tarball dry-run is documented in `docs/RELEASE_READINESS.md`.
- Release workflow is manual until provider live smoke evidence is recorded.
