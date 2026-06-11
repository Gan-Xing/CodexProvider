# Provider Compatibility Matrix

This matrix tracks public-alpha provider readiness for `@codex-provider/core`. Evidence status is intentionally conservative: providers without current credentials are marked `[!] Pending credentials` rather than treated as passed.

## Matrix

| Provider | Base URL env | Model env | Protocol | Recommended profile | Tools support | Streaming support | Forced tool behavior | `file_search` status | `web_search` status | Known quirks | Evidence status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenRouter | `OPENROUTER_BASE_URL` or `CODEX_PROVIDER_BASE_URL` | `OPENROUTER_MODEL` or `CODEX_PROVIDER_MODEL` | OpenAI-compatible Chat Completions through local Responses adapter | `mixed`; `pure-api` for API-key-only hosts | Custom tools and adapter-emulated hosted tools through CodexProvider | Verified through adapter SSE path | Verified with `deepseek/deepseek-chat`; some models may ignore forced tools | Verified through adapter-emulated source | Verified with built-in no-key metasearch; API-backed search still pending | Model-specific tool-call behavior varies | Passed: see [live smoke results](LIVE_SMOKE_RESULTS.md#2026-06-10t215515241z-codexproviderruntime-live-host-integration-smoke) |
| DeepSeek official | `DEEPSEEK_BASE_URL` or `CODEX_PROVIDER_BASE_URL` | `DEEPSEEK_MODEL` or `CODEX_PROVIDER_MODEL` | OpenAI-compatible Chat Completions through local Responses adapter | `mixed`; `pure-api` for API-key-only hosts | Expected custom tools and adapter-emulated hosted tools | Expected through adapter SSE path | Needs live forced-tool verification | Expected through adapter-emulated source | Expected through no-key metasearch or API-backed search | Official base URL may omit `/v1`; use preset unless provider docs require override | [!] Pending credentials |
| DashScope/Qwen | `DASHSCOPE_BASE_URL` or `QWEN_BASE_URL` | `DASHSCOPE_MODEL` or `QWEN_MODEL` | OpenAI-compatible Chat Completions through local Responses adapter | `mixed`; `pure-api` for API-key-only hosts | Expected custom tools and adapter-emulated hosted tools; Qwen preset records native search capability metadata | Expected through adapter SSE path | Needs live forced-tool verification | Expected through adapter-emulated source | Adapter-emulated search is supported; native `chat_enable_search` must remain provider-specific | Some deployments use `DASHSCOPE_*`, others use `QWEN_*` env names | [!] Pending credentials |
| SiliconFlow | `SILICONFLOW_BASE_URL` or `CODEX_PROVIDER_BASE_URL` | `SILICONFLOW_MODEL` or `CODEX_PROVIDER_MODEL` | OpenAI-compatible Chat Completions through local Responses adapter | `mixed`; use `createCodexProviderSiliconFlowProfile()` | Expected custom tools and adapter-emulated hosted tools | Expected through adapter SSE path | Needs live forced-tool verification | Expected through adapter-emulated source | Expected through adapter-emulated search | Default base URL follows the OpenAI-compatible `/v1` endpoint; live model/tool-call behavior not recorded | [!] Pending credentials |
| MiniMax | `MINIMAX_BASE_URL` or `CODEX_PROVIDER_BASE_URL` | `MINIMAX_MODEL` or `CODEX_PROVIDER_MODEL` | OpenAI-compatible Chat Completions through local Responses adapter | `mixed`; use `createCodexProviderMiniMaxProfile()` | Expected custom tools and adapter-emulated hosted tools | Expected through adapter SSE path | Needs live forced-tool verification | Expected through adapter-emulated source | Expected through adapter-emulated search | Text-only multimodal capability metadata is recorded in the capability preset | [!] Pending credentials |
| Moonshot/Kimi | `KIMI_BASE_URL` or `MOONSHOT_BASE_URL` | `KIMI_MODEL` or `MOONSHOT_MODEL` | OpenAI-compatible Chat Completions through local Responses adapter | `mixed`; use `createCodexProviderMoonshotKimiProfile()` | Expected custom tools and adapter-emulated hosted tools | Expected through adapter SSE path | Needs live forced-tool verification | Expected through adapter-emulated source | Expected through adapter-emulated search | Kimi coding endpoint defaults differ from generic OpenAI base URLs | [!] Pending credentials |
| OpenAI direct Responses | `OPENAI_BASE_URL` or `CODEX_PROVIDER_BASE_URL` | `OPENAI_MODEL` or `CODEX_PROVIDER_MODEL` | Responses | `official` | Provider-native hosted tools only when explicitly declared | Expected native Responses streaming | Needs direct Responses verification | Provider-native or adapter-emulated depending on host strategy | Provider-native or adapter-emulated depending on host strategy | This package is not affiliated with OpenAI; direct OpenAI use is a compatibility mode | [!] Pending credentials |

## Preset Coverage

Profile helper coverage:

- `createCodexProviderOpenRouterProfile()`
- `createCodexProviderDeepSeekProfile()`
- `createCodexProviderDashScopeQwenProfile()`
- `createCodexProviderSiliconFlowProfile()`
- `createCodexProviderMiniMaxProfile()`
- `createCodexProviderMoonshotKimiProfile()`

The helpers return existing `CodexProviderProfile`-compatible objects and attach provider preset metadata for env names, recommended profile mode, upstream path, and capability metadata. They do not add runtime dependencies.

Future cycles should add a SiliconFlow live behavior record and an OpenAI direct Responses recipe after the product default and credentials are available.
