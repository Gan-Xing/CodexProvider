# CodexProvider Responses Adapter Refactor Handoff

## 0. Context

Repository: `Gan-Xing/CodexProvider`

The local path mentioned by the maintainer is:

```text
src/converters/responses_adapter.ts
```

The current GitHub `main` snapshot shows:

- `src/converters/responses_adapter.ts`: about 2900 lines.
- `src/server/responses_adapter_server.ts`: about 3400 lines.
- `src/web_search_executor.ts`: about 800 lines.
- `src/capabilities/thinking_policy.ts`: about 800 lines.
- `src/converters/codex_tool_context.ts`: about 430 lines.
- `src/web-search/retrieval/fetcher.ts`: about 350 lines.

The immediate task is **not** to implement new Web Search behavior. The immediate task is to refactor the large adapter/converter files so the project becomes easier to extend before the next Web Search work.

Primary refactor target:

```text
src/converters/responses_adapter.ts
```

Secondary large-file target:

```text
src/server/responses_adapter_server.ts
```

Other later targets:

```text
src/web_search_executor.ts
src/capabilities/thinking_policy.ts
src/converters/codex_tool_context.ts
src/web-search/retrieval/fetcher.ts
```

## 1. Current Problem

`src/converters/responses_adapter.ts` currently owns three independent responsibilities:

1. Responses request -> Chat Completions
   - `responsesRequestToChatCompletions`
   - input item conversion
   - content part conversion
   - hosted/built-in tool conversion
   - tool choice conversion
   - payload compatibility filtering
   - reasoning/thinking policy application

2. Chat Completions response -> Responses
   - `chatCompletionsResponseToResponses`
   - assistant text conversion
   - reasoning output items
   - tool call output items
   - usage normalization / estimation
   - compaction fallback response

3. Chat Completions SSE -> Responses SSE
   - `translateChatCompletionsSseToResponsesEvents`
   - `translateChatCompletionsSseStreamToResponsesSse`
   - stream state management
   - function call argument deltas
   - reasoning deltas
   - output item lifecycle events
   - terminal success/failure events

This makes the file hard to safely extend. Any Web Search addition, tool parity change, or provider compatibility fix risks touching unrelated conversion paths.

## 2. Refactor Goals

1. Keep public API stable.
2. Move code into responsibility-focused modules.
3. Avoid behavior changes in the first refactor PR.
4. Keep `src/converters/responses_adapter.ts` as a compatibility facade.
5. Add/maintain tests around each public conversion surface.
6. Make future Web Search output parity changes land in small files, not the giant adapter.
7. Do not add runtime dependencies.
8. Do not implement new Web Search functionality in this refactor.

## 3. Non-Goals

Do not do these in this refactor:

- Do not implement new Web Search engines.
- Do not change tool calling behavior.
- Do not change SSE event semantics.
- Do not change provider capability defaults.
- Do not change `web_search` retrieval behavior.
- Do not rename public API again.
- Do not remove existing tests.
- Do not redesign the server loop.

This refactor should be mostly move/extract/rename-private-helper work.

## 4. Target Directory Layout

Create a new directory:

```text
src/converters/responses-adapter/
```

Suggested structure:

```text
src/converters/responses-adapter/
  index.ts
  types.ts

  request-to-chat/
    index.ts
    convert.ts
    input-items.ts
    content-parts.ts
    messages.ts
    tools.ts
    tool-choice.ts
    payload-compatibility.ts
    unsupported.ts

  chat-to-responses/
    index.ts
    convert.ts
    compaction.ts
    output-items.ts
    tool-calls.ts
    reasoning.ts
    usage.ts
    response-object.ts

  sse/
    index.ts
    translate.ts
    state.ts
    parser.ts
    events.ts
    finish.ts
    format.ts

  shared/
    json.ts
    strings.ts
    numbers.ts
    ids.ts
    text.ts
    model.ts
    errors.ts
    tool-names.ts
```

Then reduce the old file to a facade:

```ts
// src/converters/responses_adapter.ts
export * from './responses-adapter/index.js';
```

If there are TypeScript circular import issues, use explicit named re-exports instead:

```ts
export {
  responsesRequestToChatCompletions,
} from './responses-adapter/request-to-chat/index.js';
export {
  chatCompletionsResponseToResponses,
  responsesRequestToCompactionResponse,
  inspectOpenAICompatiblePayloadCompatibility,
} from './responses-adapter/chat-to-responses/index.js';
export {
  translateChatCompletionsSseStreamToResponsesSse,
  translateChatCompletionsSseToResponsesEvents,
} from './responses-adapter/sse/index.js';
export type {
  ResponsesToChatOptions,
  ChatToResponsesOptions,
  ResponsesSseTranslateOptions,
} from './responses-adapter/types.js';
```

## 5. Public API to Preserve

These exports must keep working from `src/converters/responses_adapter.ts` and root `src/index.ts`:

```ts
responsesRequestToChatCompletions
chatCompletionsResponseToResponses
responsesRequestToCompactionResponse
inspectOpenAICompatiblePayloadCompatibility
translateChatCompletionsSseToResponsesEvents
translateChatCompletionsSseStreamToResponsesSse
```

Types to preserve:

```ts
ResponsesToChatOptions
ChatToResponsesOptions
ResponsesSseTranslateOptions
```

Do not change function signatures in the first PR.

## 6. Suggested Module Ownership

### 6.1 `types.ts`

Move public and shared internal types:

```ts
JsonRecord
ToolNameMap
AdapterEmulatedHostedToolMap
ResponsesToChatOptions
ChatToResponsesOptions
ResponsesSseTranslateOptions
InputConversionState
StreamToolCallState
InlineThinkMode
InlineThinkState
StreamState
```

Keep `JsonRecord` local if importing it from many modules causes conflicts, but avoid multiple incompatible definitions.

### 6.2 `request-to-chat/convert.ts`

Owns only:

```ts
responsesRequestToChatCompletions
```

It orchestrates:

```text
build tool context
build tool name map
copy scalar fields
convert input items to chat messages
convert tools
convert tool_choice
apply thinking policy
apply payload compatibility
return chat body
```

It should delegate the details to smaller modules.

### 6.3 `request-to-chat/input-items.ts`

Move:

```ts
appendInputItem
createInputConversionState
flushPendingToolCalls
flushPendingReasoning
mergeToolCallsIntoAssistantMessage
appendReasoningToAssistantMessage
takePendingReasoningText
responsesReasoningText
customToolCallToChatToolCall
function_call/function_call_output conversion helpers
orphan tool output helpers
```

### 6.4 `request-to-chat/content-parts.ts`

Move:

```ts
convertResponsesContentToChatContent
unsupportedInputPartToText
input_image handling
input_file handling
text part handling
```

This will make future multimodal/file input changes safer.

### 6.5 `request-to-chat/tools.ts`

Move:

```ts
convertResponsesToolToChatTool
convertResponsesBuiltinToolToChatTool
buildRelay/adapter-emulated hosted chat tool
normalizeBuiltinToolType
requestUsesBuiltinWebSearch
isBuiltinWebSearchToolType
supportsBuiltinWebSearchTool
resolveBuiltinWebSearchTransport
resolveAdapterEmulatedHostedTools
```

Suggested naming should stay `adapter-emulated`, not the historical relay-style wording.

### 6.6 `request-to-chat/tool-choice.ts`

Move:

```ts
convertResponsesToolChoiceToChatToolChoice
buildForcedFunctionToolChoice
allowed_tools recursion handling
```

### 6.7 `request-to-chat/payload-compatibility.ts`

Move:

```ts
inspectOpenAICompatiblePayloadCompatibility
applyOpenAICompatiblePayloadCompatibility
applyOpenAICompatiblePayloadRules
resolveModelMaxOutputTokens
field filtering helpers
```

Keep dependency on `capabilities/thinking_policy.ts` one-way if possible.

### 6.8 `chat-to-responses/convert.ts`

Owns:

```ts
chatCompletionsResponseToResponses
```

It delegates to:

```text
response-object.ts
output-items.ts
tool-calls.ts
reasoning.ts
usage.ts
```

### 6.9 `chat-to-responses/output-items.ts`

Move:

```ts
buildCompletedReasoningOutputItem
message output item construction
chatToolCallToResponseOutputItem
function_call item conversion
custom_tool_call item conversion
```

### 6.10 `chat-to-responses/tool-calls.ts`

Move:

```ts
responseToolCallId
buildFunctionCallItemId
tool call argument normalization
custom tool call reconstruction hooks
```

### 6.11 `chat-to-responses/reasoning.ts`

Move:

```ts
splitLeadingThinkBlock
extractReasoningText
THINK_OPEN_TAG
THINK_CLOSE_TAG
reasoning content helpers
```

### 6.12 `chat-to-responses/usage.ts`

Move:

```ts
mapProviderUsage
estimateUsageIfEnabled
withUsagePricingMetadata
usage metadata normalization
```

### 6.13 `chat-to-responses/compaction.ts`

Move:

```ts
responsesRequestToCompactionResponse
normalizeCompactionOutput
```

### 6.14 `chat-to-responses/response-object.ts`

Move:

```ts
buildResponsesObject
response metadata helpers
```

### 6.15 `sse/translate.ts`

Owns public exports:

```ts
translateChatCompletionsSseToResponsesEvents
translateChatCompletionsSseStreamToResponsesSse
```

Delegates to `state.ts`, `parser.ts`, `events.ts`, `finish.ts`, `format.ts`.

### 6.16 `sse/state.ts`

Move:

```ts
createStreamState
StreamState
messageStates
reasoningStates
toolCalls
sequence tracking
```

### 6.17 `sse/parser.ts`

Move:

```ts
translateChatCompletionStreamData
chunk JSON parsing
error chunk normalization
```

### 6.18 `sse/events.ts`

Move:

```ts
response.created
response.output_item.added
response.content_part.added
response.output_text.delta
response.function_call_arguments.delta
reasoning delta events
```

### 6.19 `sse/finish.ts`

Move:

```ts
finishStreamState
failStreamState
terminal emitted handling
```

### 6.20 `sse/format.ts`

Move:

```ts
formatSseEvent
```

### 6.21 `shared/*`

Move generic helpers:

```ts
normalizeString
normalizeArray
normalizeNumber
copyIfPresent
omitUndefined
cloneJson
joinTextBlocks
shortenToolName
buildToolNameMap
buildReverseToolNameMap
isOpenAIOFamilyModel
isGptFiveOrNewerModel
normalizeRole
```

Keep shared helpers small and domain-agnostic. If a helper knows about Responses or Chat semantics, put it in a domain module instead.

## 7. Phase Plan

### Phase 0: Baseline and Safety Net

Before moving code:

1. Run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
```

2. Add or verify golden tests for:

```text
Responses request -> Chat Completions
Chat Completions response -> Responses
Chat SSE -> Responses SSE
custom tools
namespace tools
apply_patch proxy
file_search hosted tool conversion
web_search provider-native and adapter-emulated conversion
image input downgrade
file input downgrade
reasoning/thinking conversion
usage mapping
error stream chunks
```

3. Do not begin extraction until baseline passes.

### Phase 1: Create Directory Skeleton

Add the new directory structure and empty barrel files.

No behavior changes.

`responses_adapter.ts` should still contain the original implementation at this phase.

### Phase 2: Move Types and Shared Utilities

Move types and generic helper functions first.

Rules:

- Keep names stable.
- Avoid export-all cycles.
- Run tests after this phase.

### Phase 3: Extract Request -> Chat Conversion

Move `responsesRequestToChatCompletions` and the helpers it needs into:

```text
request-to-chat/*
```

Keep a named re-export from the facade.

Run all converter tests.

### Phase 4: Extract Chat -> Responses Conversion

Move `chatCompletionsResponseToResponses`, compaction, output item construction, reasoning, usage.

Run all converter tests.

### Phase 5: Extract SSE Translation

Move stream state, chunk parser, SSE event builders, finish/fail logic, async generator formatter.

Run SSE-specific tests and full test suite.

### Phase 6: Delete Internal Logic from Facade

After all pieces are moved, reduce:

```text
src/converters/responses_adapter.ts
```

to exports only.

Target size:

```text
<= 80 lines
```

### Phase 7: Split Server Adapter

After converter split is stable, address the next large file:

```text
src/server/responses_adapter_server.ts
```

Suggested structure:

```text
src/server/responses-adapter-server/
  index.ts
  types.ts
  server.ts
  routes.ts
  upstream-client.ts
  retry.ts
  errors.ts
  models.ts
  hosted-tool-loop.ts
  hosted-tool-execution.ts
  hosted-tool-output.ts
  streaming.ts
  synthetic-sse.ts
  request-adjustments.ts
  body.ts
  urls.ts
```

Then make the old file a facade:

```ts
export * from './responses-adapter-server/index.js';
```

Keep public exports stable:

```ts
OpenAICompatibleResponsesAdapterServer
OpenAICompatibleResponsesAdapterServerOptions
CodexProviderTraceEvent
CodexProviderTraceSink
reserveLocalPort
buildOpenAICompatibleChatCompletionsUrl
buildOpenAICompatibleModelsUrl
isOpenAICompatibleChatCompletionsProxyPath
isOpenAICompatibleModelsProxyPath
isOpenAICompatibleResponsesProxyPath
```

### Phase 8: Split `web_search_executor.ts`

Current state already has:

```text
src/web-search/openai/*
src/web-search/metasearch/*
src/web-search/retrieval/*
```

But `src/web_search_executor.ts` still includes legacy provider source logic.

Move legacy providers to:

```text
src/web-search/legacy-provider-source.ts
```

or, preferably:

```text
src/web-search/providers/http-api-source.ts
```

Target:

```text
src/web_search_executor.ts <= 80 lines
```

It should only re-export public API or delegate to `web-search/index.ts`.

### Phase 9: Split `thinking_policy.ts`

Later target:

```text
src/capabilities/thinking-policy/
  index.ts
  types.ts
  policy.ts
  provider-inference.ts
  payload-rules.ts
  model-capabilities.ts
  merge.ts
```

This is lower priority than converter/server split.

## 8. Current Web Search Note

The current code already has Web Search modularization started:

```text
src/web-search/openai/executor.ts
src/web-search/openai/request.ts
src/web-search/openai/tool-output.ts
src/web-search/openai/web-search-call.ts
src/web-search/openai/annotations.ts
src/web-search/openai/placeholders.ts
src/web-search/metasearch/*
src/web-search/retrieval/*
```

`src/web-search/openai/executor.ts` already composes metasearch + retrieval, and returns tool output through `buildCodexProviderOpenAiWebSearchToolOutput`.

`src/server/responses_adapter_server.ts` already imports Web Search annotation and `web_search_call` helpers, so Web Search output parity is no longer entirely inside the server file.

Do not undo this direction. The converter/server refactor should make it easier to continue Web Search work.

## 9. Testing Strategy

### 9.1 Keep Existing Tests Passing

After each phase:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Before final handoff:

```bash
pnpm consumer:harness
pnpm check-boundary
```

### 9.2 Add Golden Fixture Tests if Missing

Suggested fixtures:

```text
test/fixtures/converters/responses-to-chat/*.json
test/fixtures/converters/chat-to-responses/*.json
test/fixtures/converters/chat-sse-to-responses-sse/*.txt
```

Each fixture should include:

```text
input.json
expected.json
```

For SSE:

```text
input.sse.txt
expected-events.json
```

### 9.3 High-Risk Cases

Must preserve behavior for:

- `input` as string.
- `input` as array of Responses items.
- `instructions` as string and parts.
- `reasoning` request present with no reasoning text.
- `<think>...</think>` leading blocks.
- provider-specific `reasoning_content`.
- function tool call conversion.
- custom tool call conversion.
- `apply_patch` proxy conversion.
- namespace tool flattening.
- file input downgrade.
- image input downgrade.
- built-in `web_search` provider-native forwarding.
- built-in `web_search` adapter-emulated function conversion.
- `file_search` adapter-emulated conversion.
- `tool_choice` string, object, function, allowed_tools.
- stream tool call deltas split across chunks.
- stream reasoning deltas.
- stream top-level error events.
- missing upstream usage.
- provider usage mapping.

## 10. Refactor Rules

1. Move code first, change behavior later.
2. One phase per PR is preferred.
3. Keep old public import path working.
4. Do not introduce circular imports.
5. Do not make shared utility modules know too much about domain semantics.
6. Keep each file under ~500 lines where possible.
7. Barrel files should only re-export.
8. If a module gets over 700 lines, split it immediately.
9. Use explicit named exports for public APIs.
10. Avoid default exports.

## 11. Completion Criteria

The refactor is complete when:

```text
src/converters/responses_adapter.ts <= 80 lines
src/server/responses_adapter_server.ts <= 120 lines
src/web_search_executor.ts <= 120 lines
```

and:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
```

all pass.

Also run:

```bash
find src -type f -name '*.ts' -print0 \
  | xargs -0 wc -l \
  | sort -nr \
  | head -30
```

Target: no source file above ~700 lines except explicitly accepted generated/catalog files.

## 12. Prompt for Coding Agent

Use this prompt for the implementation agent:

```text
You are working in the Gan-Xing/CodexProvider repository.

Task: refactor the large Responses adapter code for maintainability. Do not implement new Web Search behavior. Do not change tool semantics. Do not add runtime dependencies.

Primary target:
src/converters/responses_adapter.ts

Current responsibilities:
1. responsesRequestToChatCompletions
2. chatCompletionsResponseToResponses
3. translateChatCompletionsSseToResponsesEvents / translateChatCompletionsSseStreamToResponsesSse

Goal:
Split the file into responsibility-focused modules under:
src/converters/responses-adapter/

Required target layout:
src/converters/responses-adapter/index.ts
src/converters/responses-adapter/types.ts
src/converters/responses-adapter/request-to-chat/convert.ts
src/converters/responses-adapter/request-to-chat/input-items.ts
src/converters/responses-adapter/request-to-chat/content-parts.ts
src/converters/responses-adapter/request-to-chat/messages.ts
src/converters/responses-adapter/request-to-chat/tools.ts
src/converters/responses-adapter/request-to-chat/tool-choice.ts
src/converters/responses-adapter/request-to-chat/payload-compatibility.ts
src/converters/responses-adapter/request-to-chat/unsupported.ts
src/converters/responses-adapter/chat-to-responses/convert.ts
src/converters/responses-adapter/chat-to-responses/compaction.ts
src/converters/responses-adapter/chat-to-responses/output-items.ts
src/converters/responses-adapter/chat-to-responses/tool-calls.ts
src/converters/responses-adapter/chat-to-responses/reasoning.ts
src/converters/responses-adapter/chat-to-responses/usage.ts
src/converters/responses-adapter/chat-to-responses/response-object.ts
src/converters/responses-adapter/sse/translate.ts
src/converters/responses-adapter/sse/state.ts
src/converters/responses-adapter/sse/parser.ts
src/converters/responses-adapter/sse/events.ts
src/converters/responses-adapter/sse/finish.ts
src/converters/responses-adapter/sse/format.ts
src/converters/responses-adapter/shared/json.ts
src/converters/responses-adapter/shared/strings.ts
src/converters/responses-adapter/shared/numbers.ts
src/converters/responses-adapter/shared/ids.ts
src/converters/responses-adapter/shared/text.ts
src/converters/responses-adapter/shared/model.ts
src/converters/responses-adapter/shared/errors.ts
src/converters/responses-adapter/shared/tool-names.ts

Keep src/converters/responses_adapter.ts as a compatibility facade that re-exports the same public API.

Public API that must remain available:
responsesRequestToChatCompletions
chatCompletionsResponseToResponses
responsesRequestToCompactionResponse
inspectOpenAICompatiblePayloadCompatibility
translateChatCompletionsSseToResponsesEvents
translateChatCompletionsSseStreamToResponsesSse
ResponsesToChatOptions
ChatToResponsesOptions
ResponsesSseTranslateOptions

Rules:
1. No behavior changes in this refactor.
2. No new runtime dependencies.
3. Keep all tests passing after each extraction phase.
4. Avoid circular imports.
5. Keep barrel files as re-export only.
6. Do not implement new Web Search features.
7. Do not modify provider capability behavior.
8. Do not modify hosted tool execution behavior.

Recommended phase order:
Phase 0: run baseline tests.
Phase 1: create directory skeleton and barrel files.
Phase 2: move types and shared utilities.
Phase 3: extract Responses -> Chat request conversion.
Phase 4: extract Chat -> Responses conversion.
Phase 5: extract Chat SSE -> Responses SSE conversion.
Phase 6: reduce src/converters/responses_adapter.ts to re-exports only.
Phase 7: run full test/typecheck/build/consumer harness/check-boundary.

After this is stable, prepare a second PR to split:
src/server/responses_adapter_server.ts

Suggested server split:
src/server/responses-adapter-server/index.ts
src/server/responses-adapter-server/types.ts
src/server/responses-adapter-server/server.ts
src/server/responses-adapter-server/routes.ts
src/server/responses-adapter-server/upstream-client.ts
src/server/responses-adapter-server/retry.ts
src/server/responses-adapter-server/errors.ts
src/server/responses-adapter-server/models.ts
src/server/responses-adapter-server/hosted-tool-loop.ts
src/server/responses-adapter-server/hosted-tool-execution.ts
src/server/responses-adapter-server/hosted-tool-output.ts
src/server/responses-adapter-server/streaming.ts
src/server/responses-adapter-server/synthetic-sse.ts
src/server/responses-adapter-server/request-adjustments.ts
src/server/responses-adapter-server/body.ts
src/server/responses-adapter-server/urls.ts

Final commands:
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary

Also check large files:
find src -type f -name '*.ts' -print0 | xargs -0 wc -l | sort -nr | head -30
```
