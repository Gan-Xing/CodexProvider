# Live Smoke Results

This file records redacted live smoke evidence for `@codex-provider/core`.

## 2026-06-07 OpenRouter non-web smoke

- Date: 2026-06-07T20:42:29.450Z
- Provider: OpenRouter
- Model: `deepseek/deepseek-chat`
- Embeddings provider: OpenRouter-compatible embeddings endpoint
- Embeddings model: `qwen/qwen3-embedding-8b`
- Web search: skipped intentionally for this run
- Secrets: redacted; sourced from local `.env`

### Environment

```json
{
  "OPENROUTER_API_KEY": "<redacted>",
  "OPENROUTER_BASE_URL": "<redacted>",
  "OPENROUTER_MODEL": "<redacted>",
  "EMBEDDINGS_API_KEY": "<redacted>",
  "EMBEDDINGS_API_ENDPOINT": "<redacted>",
  "EMBEDDINGS_MODEL": "<redacted>"
}
```

### Results

| Smoke | Status | Notes |
| --- | --- | --- |
| Mixed runtime | Passed | `POST /v1/responses` returned a Responses-shaped object with one output item. Latency: 1128 ms. |
| Custom tool loop | Passed | Forced `relay_echo` produced a `function_call`, then accepted `function_call_output` and returned a final answer. Latencies: 2441 ms + 782 ms. |
| Relay-emulated file_search, memory source | Passed | `include: ["file_search_call.results"]` exposed a completed `file_search_call`; first result filename: `smoke.md`. Latency: 6413 ms. |
| Local-vector file_search direct executor | Passed | Local-vector source chunked repository files, called embeddings, and returned 3 results. First result filename: `codexnext-integration.ts`. Latency: 70568 ms. |
| Unsafe tools without executors | Passed | `code_interpreter` and `computer` were not exposed as relay tools without explicit executors. Both requests returned non-500 Responses-compatible results. |

### Provider-specific notes

- `google/gemini-3.1-pro-preview` through OpenRouter did not produce a forced tool call in this smoke; it returned reasoning output only. The live tool-loop smoke was rerun with `deepseek/deepseek-chat` and passed.
- The local-vector smoke is slower than the other checks because it performs live embeddings over repository chunks. This is expected for a cold run without a persistent on-disk vector cache.

### Pending

- `web_search` live smoke remains pending by product decision.
- A future CodexNext tarball/file dependency smoke should validate a real host app consuming the package.
