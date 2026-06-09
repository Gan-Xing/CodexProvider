# CodexProvider Rename Cleanup Handoff

Archived historical naming record. This handoff intentionally preserves old naming examples for audit context and should not be treated as current API guidance.

## 0. 当前目标

当前仓库是独立仓库：

```text
Gan-Xing/CodexProvider
```

当前包名已经是：

```json
"name": "@codex-provider/core"
```

本次任务只做一件事：

> 把当前代码里的 `CodexProvider*`、`CODEX_PROVIDER_*`、`CodexProvider*`、`adapter*` 遗留命名改成真正的 `CodexProvider*` 主命名。

不做 Web Search 功能实现，不改 hosted tool 行为，不新增功能。

---

## 1. 当前问题摘要

### 1.1 `package.json` 仍暴露旧 bin

当前 `package.json` 里虽然主 bin 已经有：

```json
"codex-provider-server": "./dist/cli.js"
```

但还保留：

```json
"codex-provider-server": "./dist/cli.js",
"codex-provider-server": "./dist/cli.js"
```

这两个应该在本次改名里删除，除非明确要保留 legacy CLI。

---

### 1.2 `src/index.ts` 仍默认导出 alias 层

当前 root entrypoint 仍然有：

```ts
export * from './codex_provider_aliases.js';
```

这说明 `CodexProvider*` 现在很多不是 primary implementation，而是从 `CodexProvider*` alias 出来的。

同一个 `src/index.ts` 还继续导出 `CodexProvider` 和 `CodexProvider` 类型 / 函数，比如：

```ts
assessCodexProviderProtocolBoundary
CodexProviderProtocolBoundaryDecision
CodexProviderTraceEvent
CodexProviderStandaloneServerConfig
createCodexProviderStandaloneServerFromEnv
createCodexProviderStandaloneServerFromEnv
```

---

### 1.3 `src/codex_provider_aliases.ts` 是主要遗留层

当前 `src/codex_provider_aliases.ts` 把旧 `Provider Adapter` API alias 成新的 `CodexProvider` API，例如：

```ts
buildCodexProviderConfig as buildCodexProviderConfig
CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS as CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS
createCodexProviderWebSearchExecutor as createCodexProviderWebSearchExecutor
```

这次要反过来：源码里的真实实现应叫 `CodexProvider*`，而不是靠 alias 暴露。

---

### 1.4 核心类型仍叫 `CodexProvider*`

`src/types.ts` 里所有核心配置类型仍然是 `CodexProvider*`，并且 `ToolStrategy` 里还有 `'adapter-emulated'`。

`BuildCodexProviderConfigInput` 里也还有 `upstreamBaseUrl`、`providerProtocol` 字段。

---

### 1.5 Hosted tool 层仍叫 Provider Adapter

`src/hosted_tools.ts` 里有：

```ts
CodexProviderHostedToolName
CodexProviderHostedToolMode
CodexProviderHostedToolDeclaration
NormalizedCodexProviderHostedToolDeclaration
normalizeCodexProviderHostedTools
emulatedToolName
adapter-emulated
```

`src/hosted_tool_executors.ts` 里也有：

```ts
CodexProviderHostedToolExecutionRequest
emulatedToolName
CodexProviderHostedToolExecutor
CodexProviderHostedToolExecutorRegistry
createCodexProviderHostedToolExecutorRegistry
formatCodexProviderHostedToolExecutionResult
```

---

### 1.6 Runtime/Profile/Config 仍叫 Provider Adapter

`src/runtime.ts` 里 primary runtime 仍然是：

```ts
CodexProviderRuntime
CodexProviderRuntimeOptions
CodexProviderRuntimeState
CodexProviderAdapterServer
CodexProviderAdapterServerFactory
```

`src/codex_config.ts` 里 primary functions 仍然是：

```ts
buildCodexProviderConfig
buildCodexProviderCliArgs
buildCodexProviderTomlFragment
normalizeProviderBaseUrl
codexBaseUrlForProviderProtocol
```

并且默认 provider 名仍是 `Codex Provider`。

`src/profiles.ts` 里 primary profile 也仍是 `CodexProviderProfile` / `buildCodexProviderProfile`。

---

### 1.7 Built-in tool registry 仍叫 Provider Adapter

`src/builtin-tools/types.ts` 里有：

```ts
CodexProviderBuiltinToolName
CodexProviderBuiltinToolMode
CodexProviderBuiltinToolDefinition
toolModes
adapterEmulatedSupported
defaultEmulatedToolName
```

`src/builtin-tools/normalize.ts` 里的 normalize/get/is/default 函数也都是 `CodexProvider*` 命名。

---

### 1.8 Standalone server 和 CLI 仍叫 Provider Adapter/Provider Adapter

`src/cli.ts` 仍 import：

```ts
createCodexProviderStandaloneServerFromEnv
resolveCodexProviderStandaloneServerEnv
```

并输出：

```text
Codex Provider standalone server started.
Usage: codex-provider-server
```

`src/server/standalone_server.ts` 仍然混用：

```ts
CodexProviderStandaloneServerConfig
CodexProviderStandaloneServerConfig
CODEX_PROVIDER_*
CODEX_PROVIDER_*
```

底部还有：

```ts
source: 'codex-provider-trace'
CODEX_PROVIDER_${suffix}
CODEX_PROVIDER_${suffix}
```

---

### 1.9 Protocol boundary 仍叫 Provider Adapter

`src/capabilities/protocol_boundary.ts` 现在是：

```ts
CodexProviderTargetProtocol
CodexProviderProtocolBoundaryDecision
assessCodexProviderProtocolBoundary
```

这些应改为：

```ts
CodexProviderTargetProtocol
CodexProviderProtocolBoundaryDecision
assessCodexProviderProtocolBoundary
```

---

### 1.10 Public surface test 当前仍在保护旧命名

`test/public_surface.test.ts` 当前 import 了很多旧 API，包括：

```ts
assessCodexProviderProtocolBoundary
createCodexProviderStandaloneServerConfigFromEnv
createCodexProviderStandaloneServerFromEnv
CODEX_PROVIDER_*
loadCodexProviderStandaloneEnvFile
resolveCodexProviderStandaloneServerEnv
```

测试还断言旧 bin 存在：

```ts
codex-provider-server
codex-provider-server
```

并且断言 `CodexProviderRuntime.name === 'CodexProviderRuntime'`，这和本次目标相反。

---

## 2. 改名原则

### 2.1 `CodexProvider*` 是唯一主 API

本次完成后，root entrypoint 应该只暴露：

```ts
CodexProviderRuntime
CodexProviderRuntimeOptions
CodexProviderRuntimeState

CodexProviderHostedToolName
CodexProviderHostedToolDeclaration
CodexProviderHostedToolExecutor
CodexProviderHostedToolExecutorRegistry
createCodexProviderHostedToolExecutorRegistry

buildCodexProviderConfig
buildCodexProviderCliArgs
buildCodexProviderTomlFragment
buildCodexProviderProfile

createCodexProviderFileSearchExecutor
createCodexProviderWebSearchExecutor
createCodexProviderToolSearchExecutor
createCodexProviderImageGenerationExecutor
createCodexProviderCodeInterpreterExecutor
createCodexProviderComputerExecutor

createCodexProviderStandaloneServerConfigFromEnv
createCodexProviderStandaloneServerFromEnv
loadCodexProviderStandaloneEnvFile
resolveCodexProviderStandaloneServerEnv

CodexProviderTraceEvent
CodexProviderTraceSink
```

不要再从 root export `CodexProvider*` / `CodexProvider*`。

---

### 2.2 不保留 legacy alias，除非单独放子入口

用户目标是“adapter 都删掉”，所以建议不要保留 legacy alias。

如果为了迁移一定要留，最多做：

```text
src/legacy_aliases.ts
```

并且不从 `src/index.ts` 默认导出。

本轮推荐直接删除 `src/codex_provider_aliases.ts`。

---

### 2.3 `Provider Adapter` 全部替换为 `CodexProvider`

所有 `CodexProvider*` 改成 `CodexProvider*`。

例如：

```ts
CodexProviderTargetProtocol
CodexProviderProtocolBoundaryDecision
assessCodexProviderProtocolBoundary
```

改成：

```ts
CodexProviderTargetProtocol
CodexProviderProtocolBoundaryDecision
assessCodexProviderProtocolBoundary
```

---

### 2.4 `adapter-emulated` 建议改成 `adapter-emulated`

如果只改 TypeScript 类型名，不改 string literal，代码里仍会残留大量 `adapter-emulated`。用户说“adapter 都删掉”，建议连 mode string 一起改。

推荐：

```ts
'provider-native' | 'adapter-emulated' | 'codex-local-first'
```

替换：

```ts
'provider-native' | 'adapter-emulated' | 'codex-local-first'
```

对应字段：

```ts
toolModes -> toolModes
adapterEmulatedSupported -> adapterEmulatedSupported
defaultEmulatedToolName -> defaultEmulatedToolName
emulatedToolName -> emulatedToolName
```

---

## 3. 全局改名映射表

### 3.1 基础配置

| 当前命名 | 目标命名 |
|---|---|
| `CodexProviderAuthMode` | `CodexProviderAuthMode` |
| `CodexProviderProtocol` | `CodexProviderProtocol` |
| `CodexProviderToolStrategy` | `CodexProviderToolStrategy` |
| `CodexProviderTomlPrimitive` | `CodexProviderTomlPrimitive` |
| `CodexProviderTokenSource` | `CodexProviderTokenSource` |
| `BuildCodexProviderConfigInput` | `BuildCodexProviderConfigInput` |
| `CodexProviderConfigEntry` | `CodexProviderConfigEntry` |
| `CodexProviderConfig` | `CodexProviderConfig` |
| `upstreamBaseUrl` | `providerBaseUrl` 或 `upstreamBaseUrl` |
| `providerProtocol` | `providerProtocol` |
| `normalizeProviderBaseUrl` | `normalizeProviderBaseUrl` |
| `buildCodexProviderConfig` | `buildCodexProviderConfig` |
| `buildCodexProviderCliArgs` | `buildCodexProviderCliArgs` |
| `buildCodexProviderTomlFragment` | `buildCodexProviderTomlFragment` |
| `DEFAULT_CODEX_PROVIDER_PROTOCOL_PROXY_PORT` | `DEFAULT_CODEX_PROVIDER_PROTOCOL_PROXY_PORT` |
| `codexBaseUrlForProviderProtocol` | `codexBaseUrlForProviderProtocol` |

---

### 3.2 Runtime/Profile

| 当前命名 | 目标命名 |
|---|---|
| `CodexProviderRuntime` | `CodexProviderRuntime` |
| `CodexProviderRuntimeOptions` | `CodexProviderRuntimeOptions` |
| `CodexProviderRuntimeState` | `CodexProviderRuntimeState` |
| `CodexProviderAdapterServer` | `CodexProviderAdapterServer` |
| `CodexProviderAdapterServerOptions` | `CodexProviderAdapterServerOptions` |
| `CodexProviderAdapterServerFactory` | `CodexProviderAdapterServerFactory` |
| `CodexProviderProfile` | `CodexProviderProfile` |
| `CodexProviderProfileMode` | `CodexProviderProfileMode` |
| `BuildCodexProviderProfileInput` | `BuildCodexProviderProfileInput` |
| `buildCodexProviderProfile` | `buildCodexProviderProfile` |
| `profile` | `profile` |
| `buildProfile` | `buildProfile` |
| `createDefaultCodexProviderAdapterServer` | `createDefaultCodexProviderAdapterServer` |

---

### 3.3 Hosted tools

| 当前命名 | 目标命名 |
|---|---|
| `CodexProviderHostedToolName` | `CodexProviderHostedToolName` |
| `CodexProviderHostedToolMode` | `CodexProviderHostedToolMode` |
| `CodexProviderHostedToolDeclaration` | `CodexProviderHostedToolDeclaration` |
| `NormalizedCodexProviderHostedToolDeclaration` | `NormalizedCodexProviderHostedToolDeclaration` |
| `normalizeCodexProviderHostedTools` | `normalizeCodexProviderHostedTools` |
| `emulatedToolName` | `emulatedToolName` |
| `defaultHostedEmulatedToolName` | `defaultHostedEmulatedToolName` |
| `adapter-emulated` | `adapter-emulated` |

---

### 3.4 Hosted tool executors

| 当前命名 | 目标命名 |
|---|---|
| `CodexProviderHostedToolExecutionRequest` | `CodexProviderHostedToolExecutionRequest` |
| `CodexProviderHostedToolExecutionResult` | `CodexProviderHostedToolExecutionResult` |
| `CodexProviderHostedToolDeltaEmitter` | `CodexProviderHostedToolDeltaEmitter` |
| `CodexProviderHostedToolExecutor` | `CodexProviderHostedToolExecutor` |
| `CodexProviderHostedToolExecutorRegistration` | `CodexProviderHostedToolExecutorRegistration` |
| `CodexProviderHostedToolExecutorRegistryInput` | `CodexProviderHostedToolExecutorRegistryInput` |
| `CodexProviderHostedToolExecutorRegistry` | `CodexProviderHostedToolExecutorRegistry` |
| `createCodexProviderHostedToolExecutorRegistry` | `createCodexProviderHostedToolExecutorRegistry` |
| `formatCodexProviderHostedToolExecutionResult` | `formatCodexProviderHostedToolExecutionResult` |

---

### 3.5 Built-in tools

| 当前命名 | 目标命名 |
|---|---|
| `CodexProviderBuiltinToolName` | `CodexProviderBuiltinToolName` |
| `CodexProviderBuiltinToolMode` | `CodexProviderBuiltinToolMode` |
| `CodexProviderBuiltinToolDefinition` | `CodexProviderBuiltinToolDefinition` |
| `CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS` | `CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS` |
| `CODEX_PROVIDER_BUILTIN_TOOL_ALIASES` | `CODEX_PROVIDER_BUILTIN_TOOL_ALIASES` |
| `normalizeCodexProviderBuiltinToolName` | `normalizeCodexProviderBuiltinToolName` |
| `getCodexProviderBuiltinToolDefinition` | `getCodexProviderBuiltinToolDefinition` |
| `isCodexProviderBuiltinToolType` | `isCodexProviderBuiltinToolType` |
| `isCodexProviderAdapterEmulatedBuiltinToolType` | `isCodexProviderAdapterEmulatedBuiltinToolType` |
| `isCodexProviderProviderNativeBuiltinToolType` | `isCodexProviderProviderNativeBuiltinToolType` |
| `isCodexProviderUnsafeBuiltinToolType` | `isCodexProviderUnsafeBuiltinToolType` |
| `defaultCodexProviderBuiltinEmulatedToolName` | `defaultCodexProviderBuiltinEmulatedToolName` |
| `codexProviderBuiltinToolParameters` | `codexProviderBuiltinToolParameters` |

---

### 3.6 Standalone server / CLI

| 当前命名 | 目标命名 |
|---|---|
| `CodexProviderStandaloneServerConfig` | `CodexProviderStandaloneServerConfig` |
| `CodexProviderStandaloneServerConfig` | 删除 |
| `createCodexProviderStandaloneServerConfigFromEnv` | `createCodexProviderStandaloneServerConfigFromEnv` |
| `createCodexProviderStandaloneServerFromEnv` | `createCodexProviderStandaloneServerFromEnv` |
| `resolveCodexProviderStandaloneServerEnv` | `resolveCodexProviderStandaloneServerEnv` |
| `loadCodexProviderStandaloneEnvFile` | `loadCodexProviderStandaloneEnvFile` |
| `resolveCodexProviderStandaloneServerEnv` | 删除 |
| `loadCodexProviderStandaloneEnvFile` | 删除 |
| `createCodexProviderStandaloneServerFromEnv` | 删除 |
| `CODEX_PROVIDER_*` env | `CODEX_PROVIDER_*` env |
| `CODEX_PROVIDER_*` env | 删除 |
| `codex-provider-trace` | `codex-provider-trace` |
| `codex-provider-server` | 删除 |
| `codex-provider-server` | 删除 |

---

### 3.7 Protocol boundary

| 当前命名 | 目标命名 |
|---|---|
| `CodexProviderTargetProtocol` | `CodexProviderTargetProtocol` |
| `CodexProviderProtocolBoundaryDecision` | `CodexProviderProtocolBoundaryDecision` |
| `assessCodexProviderProtocolBoundary` | `assessCodexProviderProtocolBoundary` |

---

## 4. 必改文件清单

### 4.1 Package / entrypoint

```text
package.json
src/index.ts
src/codex_provider_aliases.ts
```

要求：

1. `package.json` 删除 `codex-provider-server` / `codex-provider-server` bin。
2. `src/index.ts` 删除 `export * from './codex_provider_aliases.js'`。
3. 删除 `src/codex_provider_aliases.ts`，或者改名为不从 root export 的 `src/legacy_aliases.ts`。
4. root public API 直接从真实模块 export `CodexProvider*`。

---

### 4.2 Core source

```text
src/types.ts
src/codex_config.ts
src/profiles.ts
src/runtime.ts
src/target.ts
src/hosted_tools.ts
src/hosted_tool_executors.ts
```

这些是第一批改名的核心文件。

---

### 4.3 Built-in tools

```text
src/builtin-tools/types.ts
src/builtin-tools/catalog.ts
src/builtin-tools/normalize.ts
src/builtin-tools/index.ts
src/builtin-tools/schemas.ts
```

注意 `schemas.ts` 里本身不一定有 Provider API，但搜索结果里出现了 `adapter-emulated`，需要同步改为 `adapter-emulated`。

---

### 4.4 Server / converter

```text
src/server/responses_adapter_server.ts
src/server/standalone_server.ts
src/converters/responses_adapter.ts
```

`responses_adapter_server.ts` 里不只是 public type，还有内部 trace event、hosted tool execution record、`emulatedToolName`、`AdapterHostedToolCall` 等内部命名。

---

### 4.5 Executors

```text
src/file_search_executor.ts
src/web_search_executor.ts
src/tool_search_executor.ts
src/image_generation_executor.ts
src/code_interpreter_executor.ts
src/computer_executor.ts
```

还有 `src/file-search/` 子模块里大量 `CodexProvider*`。至少包括：

```text
src/file-search/types.ts
src/file-search/stores.ts
src/file-search/sources/memory.ts
src/file-search/sources/remote-documents.ts
src/file-search/sources/sqlite-fts.ts
src/file-search/sources/local-shared.ts
src/file-search/sources/vector-store.ts
src/file-search/sources/in-memory-vector.ts
src/file-search/local-vector-index.ts
src/file-search/embeddings.ts
src/file-search/sources/local-vector.ts
src/file-search/sources.ts
src/file-search/executor.ts
src/file-search/shared.ts
src/file-search/sources/local-fs.ts
```

---

### 4.6 Capabilities

```text
src/capabilities/protocol_boundary.ts
```

此文件应该全部从 `CodexProvider*` 改成 `CodexProvider*`。

---

### 4.7 CLI / examples

```text
src/cli.ts
examples/adapter-emulated-web-search.ts
examples/adapter-emulated-file-search-local-vector.ts
examples/adapter-emulated-image-generation.ts
examples/adapter-emulated-code-interpreter-custom-executor.ts
examples/standalone-consumer-harness.ts
```

`adapter-emulated-*` 示例文件名也应该改掉，例如：

```text
examples/adapter-emulated-web-search.ts
examples/adapter-emulated-file-search-local-vector.ts
examples/adapter-emulated-image-generation.ts
examples/adapter-emulated-code-interpreter-custom-executor.ts
```

---

### 4.8 Tests

至少修改：

```text
test/public_surface.test.ts
test/runtime.test.ts
test/profiles.test.ts
test/converters.test.ts
test/builtin_tools.test.ts
test/server.test.ts
test/standalone_server.test.ts
test/protocol_boundary.test.ts
test/file_search_executor.test.ts
test/web_search_executor.test.ts
test/computer_executor.test.ts
```

`test/public_surface.test.ts` 当前明确保护旧 API 和旧 bin，需要重点重写。

---

### 4.9 Docs

搜索结果显示 `CodexProvider` 命中文档包括：

```text
CHANGELOG.md
README.md
docs/RELEASE_READINESS.md
docs/RECIPES.md
docs/CODEX_PROVIDER_RENAME_AND_EXTRACTION_HANDOFF.md
docs/INDEPENDENT_PACKAGE_CHECKLIST.md
docs/CODEX_PROVIDER_STANDALONE_EXTRACTION_HANDOFF.md
docs/UNSAFE_TOOL_SECURITY.md
docs/TARGET.md
docs/FILE_SEARCH_LOCAL_VECTOR_HANDOFF.md
docs/OPENAI_TOOL_PARITY_AND_PACKAGE_HARDENING_HANDOFF.md
docs/CODEX_PLUS_PLUS_CONVERSION_PORTING.md
docs/OPENAI_BUILTIN_TOOL_COMPATIBILITY.md
```

建议本 PR 只改 README、CHANGELOG、release docs、recipes、examples 相关 docs；历史 handoff 文档如果只是历史记录，可以加一段 “archived historical naming” 注释，不一定全改。

---

## 5. 推荐执行顺序

### Phase 1：Public API 改名

先改这些文件：

```text
src/types.ts
src/codex_config.ts
src/profiles.ts
src/runtime.ts
src/hosted_tools.ts
src/hosted_tool_executors.ts
src/builtin-tools/*
```

目标：所有主类型 / 主函数变成 `CodexProvider*`。

不要先碰 docs。

---

### Phase 2：Root entrypoint 清理

修改：

```text
src/index.ts
src/codex_provider_aliases.ts
```

要求：

1. 删除 `export * from './codex_provider_aliases.js'`。
2. 删除 `src/codex_provider_aliases.ts`。
3. `src/index.ts` 直接导出新名。
4. 删除 `CodexProvider*` 和 `CodexProvider*` root exports。

---

### Phase 3：Server / CLI / env 改名

修改：

```text
package.json
src/cli.ts
src/server/standalone_server.ts
src/server/responses_adapter_server.ts
src/capabilities/protocol_boundary.ts
```

要求：

1. 删除旧 bin。
2. CLI 使用 `codex-provider-server`。
3. 默认 env prefix 从 `CODEX_PROVIDER_` 改为 `CODEX_PROVIDER_`。
4. 删除 `CODEX_PROVIDER_` fallback。
5. trace source 从 `codex-provider-trace` 改成 `codex-provider-trace`。
6. error message 里不要再出现 “Provider Adapter” / “Provider Adapter”。

---

### Phase 4：Executor / file-search 子模块改名

修改所有 executor 和 file-search 子模块。

要求：

1. `createCodexProviderXxx` 全部改成 `createCodexProviderXxx`。
2. `CodexProviderXxxOptions` 全部改成 `CodexProviderXxxOptions`。
3. 内部 import 全部换成新名。
4. 不改变执行逻辑。

---

### Phase 5：测试改名

重点重写：

```text
test/public_surface.test.ts
```

新测试应该断言：

```ts
assert.equal(packageJson.bin?.['codex-provider-server'], './dist/cli.js');
assert.equal(packageJson.bin?.['codex-provider-server'], undefined);
assert.equal(packageJson.bin?.['codex-provider-server'], undefined);

assert.equal(CodexProviderRuntime.name, 'CodexProviderRuntime');
assert.equal(CodexProviderHostedToolExecutorRegistry.name, 'CodexProviderHostedToolExecutorRegistry');

assert.equal('createCodexProviderStandaloneServerFromEnv' in sdk, false);
assert.equal('createCodexProviderStandaloneServerFromEnv' in sdk, false);
```

---

### Phase 6：Examples / docs 改名

修改：

```text
README.md
CHANGELOG.md
docs/RECIPES.md
docs/RELEASE_READINESS.md
docs/INDEPENDENT_PACKAGE_CHECKLIST.md
docs/OPENAI_BUILTIN_TOOL_COMPATIBILITY.md
examples/*
```

要求：

1. 用户面向文档不再说 “Provider Adapter”。
2. 示例文件名不再 `adapter-emulated-*`。
3. 文档命令只使用 `codex-provider-server`。
4. 如果保留历史文档，明确标注 `archived historical handoff`。

---

## 6. 最终验收标准

执行：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
```

然后做 grep：

```bash
grep -R "CodexProvider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "CODEX_PROVIDER" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "CodexProvider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "codex-provider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "codex-provider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "adapter-emulated" src test examples README.md docs package.json scripts --exclude-dir=dist
```

目标：

1. `src/`、`test/`、`examples/`、`package.json` 里应无命中。
2. `docs/` 里只有历史 handoff / changelog 的明确历史记录可以保留。
3. root public API 不再导出 `CodexProvider*` 或 `CodexProvider*`。
4. package bin 只保留 `codex-provider-server`。
5. `CodexProviderRuntime.name === 'CodexProviderRuntime'`。
6. `CodexProviderHostedToolExecutorRegistry.name === 'CodexProviderHostedToolExecutorRegistry'`。
7. `toolStrategy` 使用 `adapter-emulated`，不再使用 `adapter-emulated`。
8. env prefix 使用 `CODEX_PROVIDER_`，不再使用 `CODEX_PROVIDER_` / `CODEX_PROVIDER_`。

---

# 可直接给 Coding Agent 的 Prompt

```text
你正在 Gan-Xing/CodexProvider 仓库工作。注意：这是独立 CodexProvider 仓库，不是 CodexBridge，也不是 packages/codex-provider。

本次任务只做“改名 / 去 Provider Adapter 和 Provider Adapter 遗留命名”。不要实现 Web Search，不要新增功能，不要改工具执行逻辑。

必须先阅读这些文件：

package.json
src/index.ts
src/codex_provider_aliases.ts
src/types.ts
src/codex_config.ts
src/profiles.ts
src/runtime.ts
src/target.ts
src/hosted_tools.ts
src/hosted_tool_executors.ts
src/builtin-tools/types.ts
src/builtin-tools/catalog.ts
src/builtin-tools/normalize.ts
src/server/responses_adapter_server.ts
src/server/standalone_server.ts
src/cli.ts
src/capabilities/protocol_boundary.ts
test/public_surface.test.ts

目标：

1. CodexProvider* 是唯一 primary public API。
2. 删除 root API 中的 CodexProvider*、CODEX_PROVIDER_*、CodexProvider*。
3. 删除 src/index.ts 里的 `export * from './codex_provider_aliases.js'`。
4. 删除 src/codex_provider_aliases.ts，或者改成不从 root export 的 legacy 文件；本任务推荐直接删除。
5. package.json 只保留：
   "bin": {
     "codex-provider-server": "./dist/cli.js"
   }
   删除 codex-provider-server 和 codex-provider-server。
6. CLI usage 改成 codex-provider-server。
7. env prefix 从 CODEX_PROVIDER_ 改成 CODEX_PROVIDER_。
8. 删除 CODEX_PROVIDER_ fallback。
9. trace source 从 codex-provider-trace 改成 codex-provider-trace。
10. tool strategy string 从 adapter-emulated 改成 adapter-emulated。
11. 字段 emulatedToolName 改成 emulatedToolName。
12. 字段 upstreamBaseUrl 改成 providerBaseUrl 或 upstreamBaseUrl，按语义选择；不要保留 upstreamBaseUrl。
13. 字段 providerProtocol 改成 providerProtocol。
14. 函数 normalizeProviderBaseUrl 改成 normalizeProviderBaseUrl。
15. 函数 codexBaseUrlForProviderProtocol 改成 codexBaseUrlForProviderProtocol。
16. 常量 DEFAULT_CODEX_PROVIDER_PROTOCOL_PROXY_PORT 改成 DEFAULT_CODEX_PROVIDER_PROTOCOL_PROXY_PORT。
17. CODEX_PROVIDER_PACKAGE_* 等 deprecated alias 常量删除。
18. LEGACY_CODEX_PROVIDER_PACKAGE_NAME 删除，除非只保留在 CHANGELOG 历史说明中。

具体改名映射：

CodexProviderAuthMode -> CodexProviderAuthMode
CodexProviderProtocol -> CodexProviderProtocol
CodexProviderToolStrategy -> CodexProviderToolStrategy
CodexProviderTomlPrimitive -> CodexProviderTomlPrimitive
CodexProviderTokenSource -> CodexProviderTokenSource
BuildCodexProviderConfigInput -> BuildCodexProviderConfigInput
CodexProviderConfigEntry -> CodexProviderConfigEntry
CodexProviderConfig -> CodexProviderConfig

buildCodexProviderConfig -> buildCodexProviderConfig
buildCodexProviderCliArgs -> buildCodexProviderCliArgs
buildCodexProviderTomlFragment -> buildCodexProviderTomlFragment

CodexProviderRuntime -> CodexProviderRuntime
CodexProviderRuntimeOptions -> CodexProviderRuntimeOptions
CodexProviderRuntimeState -> CodexProviderRuntimeState
CodexProviderAdapterServer -> CodexProviderAdapterServer
CodexProviderAdapterServerOptions -> CodexProviderAdapterServerOptions
CodexProviderAdapterServerFactory -> CodexProviderAdapterServerFactory

CodexProviderProfile -> CodexProviderProfile
CodexProviderProfileMode -> CodexProviderProfileMode
BuildCodexProviderProfileInput -> BuildCodexProviderProfileInput
buildCodexProviderProfile -> buildCodexProviderProfile

CodexProviderHostedToolName -> CodexProviderHostedToolName
CodexProviderHostedToolMode -> CodexProviderHostedToolMode
CodexProviderHostedToolDeclaration -> CodexProviderHostedToolDeclaration
NormalizedCodexProviderHostedToolDeclaration -> NormalizedCodexProviderHostedToolDeclaration
normalizeCodexProviderHostedTools -> normalizeCodexProviderHostedTools

CodexProviderHostedToolExecutionRequest -> CodexProviderHostedToolExecutionRequest
CodexProviderHostedToolExecutionResult -> CodexProviderHostedToolExecutionResult
CodexProviderHostedToolDeltaEmitter -> CodexProviderHostedToolDeltaEmitter
CodexProviderHostedToolExecutor -> CodexProviderHostedToolExecutor
CodexProviderHostedToolExecutorRegistration -> CodexProviderHostedToolExecutorRegistration
CodexProviderHostedToolExecutorRegistryInput -> CodexProviderHostedToolExecutorRegistryInput
CodexProviderHostedToolExecutorRegistry -> CodexProviderHostedToolExecutorRegistry
createCodexProviderHostedToolExecutorRegistry -> createCodexProviderHostedToolExecutorRegistry
formatCodexProviderHostedToolExecutionResult -> formatCodexProviderHostedToolExecutionResult

CodexProviderBuiltinToolName -> CodexProviderBuiltinToolName
CodexProviderBuiltinToolMode -> CodexProviderBuiltinToolMode
CodexProviderBuiltinToolDefinition -> CodexProviderBuiltinToolDefinition
CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS -> CODEX_PROVIDER_BUILTIN_TOOL_DEFINITIONS
CODEX_PROVIDER_BUILTIN_TOOL_ALIASES -> CODEX_PROVIDER_BUILTIN_TOOL_ALIASES
normalizeCodexProviderBuiltinToolName -> normalizeCodexProviderBuiltinToolName
getCodexProviderBuiltinToolDefinition -> getCodexProviderBuiltinToolDefinition
isCodexProviderBuiltinToolType -> isCodexProviderBuiltinToolType
isCodexProviderAdapterEmulatedBuiltinToolType -> isCodexProviderAdapterEmulatedBuiltinToolType
isCodexProviderProviderNativeBuiltinToolType -> isCodexProviderProviderNativeBuiltinToolType
isCodexProviderUnsafeBuiltinToolType -> isCodexProviderUnsafeBuiltinToolType
defaultCodexProviderBuiltinEmulatedToolName -> defaultCodexProviderBuiltinEmulatedToolName
codexProviderBuiltinToolParameters -> codexProviderBuiltinToolParameters

CodexProviderStandaloneServerConfig -> CodexProviderStandaloneServerConfig
createCodexProviderStandaloneServerConfigFromEnv -> createCodexProviderStandaloneServerConfigFromEnv
createCodexProviderStandaloneServerFromEnv -> createCodexProviderStandaloneServerFromEnv
resolveCodexProviderStandaloneServerEnv -> resolveCodexProviderStandaloneServerEnv
loadCodexProviderStandaloneEnvFile -> loadCodexProviderStandaloneEnvFile

CodexProviderTargetProtocol -> CodexProviderTargetProtocol
CodexProviderProtocolBoundaryDecision -> CodexProviderProtocolBoundaryDecision
assessCodexProviderProtocolBoundary -> assessCodexProviderProtocolBoundary

所有 executor 也要改名：
createCodexProviderFileSearchExecutor -> createCodexProviderFileSearchExecutor
createCodexProviderWebSearchExecutor -> createCodexProviderWebSearchExecutor
createCodexProviderToolSearchExecutor -> createCodexProviderToolSearchExecutor
createCodexProviderImageGenerationExecutor -> createCodexProviderImageGenerationExecutor
createCodexProviderCodeInterpreterExecutor -> createCodexProviderCodeInterpreterExecutor
createCodexProviderComputerExecutor -> createCodexProviderComputerExecutor

所有对应 Options / Content / Request / Result / Provider / Source 类型也做同样删除 Provider Adapter 的改名。

测试要求：

1. 重写 test/public_surface.test.ts，不再断言旧 bin、旧 aliases、旧 Provider class name 存在。
2. 新断言：
   - packageJson.bin.codex-provider-server === "./dist/cli.js"
   - packageJson.bin["codex-provider-server"] === undefined
   - packageJson.bin["codex-provider-server"] === undefined
   - CodexProviderRuntime.name === "CodexProviderRuntime"
   - CodexProviderHostedToolExecutorRegistry.name === "CodexProviderHostedToolExecutorRegistry"
   - root sdk 中没有 createCodexProvider*
   - root sdk 中没有 createCodexProvider*
3. 更新所有 tests/imports/examples/docs 中的旧名字。
4. 重命名 examples/adapter-emulated-* 为 examples/adapter-emulated-*。
5. 不要改变功能逻辑。

完成后运行：

pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary

最后运行 grep：

grep -R "CodexProvider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "CODEX_PROVIDER" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "CodexProvider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "codex-provider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "codex-provider" src test examples README.md docs package.json scripts --exclude-dir=dist
grep -R "adapter-emulated" src test examples README.md docs package.json scripts --exclude-dir=dist

src、test、examples、package.json、scripts 中必须无命中。docs 中只允许 CHANGELOG 或历史 handoff 明确标注为 archived historical naming 的记录。
```
