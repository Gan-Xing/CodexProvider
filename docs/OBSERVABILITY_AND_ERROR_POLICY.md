# Observability and Error Policy

This document defines the current debug and error contract for `@codex-provider/core` host integrations.

## Trace Events

Trace events are opt-in through `traceSink` or `CODEX_PROVIDER_TRACE=stderr-json` in the standalone server. The server sanitizes trace events before they reach the sink:

- Secret-like values are replaced with `<redacted>`.
- Fields whose names look credential-bearing, such as `apiKey`, `authorization`, `token`, `secret`, `password`, or `credential`, are replaced with `<redacted>`.
- Long strings are truncated after 500 characters.
- Large arrays and objects are bounded.
- Deep objects are truncated to avoid dumping full documents.

Current event families:

- `request.received`
- `request.translated`
- `request.adjusted`
- `response.translated`
- `response.compaction_fallback`
- `upstream.retry`
- `upstream.error`
- `stream.event`
- `stream.completed`
- `web_search.executed`
- `web_search.citations`
- `hosted_tool.config_bound`
- `hosted_tool.executed`

Hosted-tool SSE observability is separate and opt-in through `emitHostedToolSseEvents`. It can emit `hosted_tool.started`, `hosted_tool.delta`, `hosted_tool.completed`, and `hosted_tool.failed` before normal Responses SSE events.

## Error Classes

| Class | Definition | HTTP/status behavior | Retry policy | Trace/event behavior |
| --- | --- | --- | --- | --- |
| Request validation error | The incoming Responses request has invalid hosted-tool fields or unsupported parameter shapes. | Return HTTP 400 with `invalid_request_error`. | Not retryable until the caller fixes the request. | May emit `request.adjusted` only when configured drop-mode removes invalid fields. |
| Security violation | A request attempts unsafe network/file behavior, such as blocked private-host retrieval or unsafe local file traversal. | Return a tool/provider error instead of bypassing the guard. | Not retryable without policy/config changes. | Trace only sanitized metadata; never include secret values or full local file contents. |
| Recoverable hosted tool provider error | A provider/search/retrieval dependency fails transiently while the adapter can continue with a structured tool error or unresponsive-engine record. | Keep the Responses loop alive when the tool result can represent the failure safely. | Retryable only when the underlying provider category is transient or rate-limited. | Hosted-tool lifecycle can emit `hosted_tool.failed`; trace emits execution ids, not raw full output. |
| Fatal hosted tool error | A hosted tool failure prevents safe continuation or creates an invalid adapter state. | Return a Responses-compatible error or upstream error response. | Depends on root cause; default is not retryable unless classified transient. | Trace emits sanitized error metadata. |
| Tool loop exceeded | The adapter-emulated hosted-tool loop exceeds `maxHostedToolIterations`. | Return HTTP 502 with `hosted_tool_loop_exceeded` or `hosted_tool_streaming_loop_exceeded`, `category: "unsupported_feature"`, and retry metadata. | Not retryable until the prompt/tool behavior changes or the host intentionally increases the configured limit. | Trace emits the final sanitized upstream error path. |

## Provider Error Categories

Upstream HTTP errors are normalized into categories:

- `authentication`
- `rate_limit`
- `transient_upstream`
- `unsupported_feature`
- `not_found`
- `invalid_request`
- `malformed_upstream`
- `upstream_failure`

Each category carries retry metadata such as `retryable`, `hint`, and optional `retry_after_ms` when available.

## Redaction Policy

Do not send these values to trace sinks, logs, docs, or live smoke evidence:

- API keys, bearer tokens, access tokens, cookies, or passwords.
- Raw `.env` file contents.
- Full local file contents returned by `file_search`.
- Full retrieved web documents.
- Raw provider payloads containing secrets or user-private content.

Trace sinks are for local debugging and operational telemetry, not durable transcript storage. Hosts that persist traces should apply their own retention and access-control policy on top of the SDK sanitization.

## Current Code Audit

Cycle 1 audit found that trace events were opt-in but could previously include full request, upstream request, and response objects. The server now sanitizes events at the unified `emitTrace` exit before invoking `traceSink`.

Cycle 2 audit closed the plain-object hosted-tool loop-exceeded gap. Non-streaming and streaming adapter-emulated hosted-tool loop exhaustion now use a typed internal error helper and return structured `category` and `retry` metadata through the public Responses route.

Cycle 4 audit added regression coverage for hosted-tool SSE trace redaction. Client SSE lifecycle events still carry executor output, while mirrored `stream.event` traces are sanitized before `traceSink` receives deltas, metadata, and output previews.

Cycle 6 audit added count-only `web_search.citations` trace summaries for adapter-emulated web search output annotation. The event records source, output text part, placeholder, annotation, and missing-source counts without copying answer text or source documents into a dedicated observability event.

Cycle 7 audit added count-only `web_search.executed` trace summaries for adapter-emulated web search executor runs. The event records stream mode, call id, execution status, duration, result/source/document/chunk/retrieval-error/unresponsive-engine/timing/warning counts, external-web-access flag, search-context size, and metasearch mode without copying query text, URLs, snippets, retrieved documents, or raw provider payloads.

Cycle 8 audit added retrieval cache hit/miss counts to `web_search.executed` trace summaries and web-search executor metadata. The counts are derived from `documents[].from_cache` and expose only aggregate hit/miss totals.

Cycle 9 audit added local-index hit/miss counts to metasearch-backed web-search metadata and `web_search.executed` trace summaries. Local-index hits count result rows returned by engines explicitly marked as local indexes; misses count local-index engine queries that completed successfully with zero results.

Cycle 13 audit added deep-search `no_supporting_evidence` response diagnostics and hosted-tool `noSupportingEvidence` metadata. The flag is derived from an empty merged-source set and does not copy query text, snippets, URLs, or provider payloads into observability metadata.

Cycle 14 audit added deep-search `minimum_source_count` / `below_minimum_sources` response diagnostics and hosted-tool `minimumSourceCount` / `belowMinimumSources` metadata. These fields expose aggregate source-count policy state only.

Cycle 15 audit added deep-search `citation_budget` / `citation_count` response diagnostics and hosted-tool `citationBudget` / `citationCount` metadata. These fields expose aggregate citation-budget state only and do not copy query text, URLs, snippets, or source contents.

Cycle 16 audit added deep-search `answer_shape` response diagnostics and hosted-tool `answerShape` metadata. The field records only the normalized requested synthesis shape and does not copy source contents or model output.

Cycle 17 audit added deep-search graph budget diagnostics and hosted-tool metadata for search-node count, executed subquery count, raw result count, configured budgets, and duration. These fields are aggregate counts and timing only.

Remaining hardening for future cycles:

- No known structured-observability gaps remain from this recursive audit. Future cycles should re-audit as hosted-tool surfaces or telemetry requirements change.
