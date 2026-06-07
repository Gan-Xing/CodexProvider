# CodexProvider Standalone Repository Extraction Handoff

## 目标

把当前 CodexBridge monorepo 中的 CodexProvider 包拆成独立项目。

当前源包目录：

```text
packages/codex-provider-relay
```

当前包名已经改为：

```text
@codex-provider/core
```

产品名：

```text
CodexProvider
```

目标仓库建议：

```text
Gan-Xing/CodexProvider
```

本阶段目标不是 npm 发布，而是：

```text
private standalone repository
+
CI/test/typecheck/build/pack dry-run
+
root entrypoint consumer validation
```

---

## 当前状态判断

当前 CodexBridge 仓库里的包已经具备抽取条件：

- `packages/codex-provider-relay/package.json` 已经使用 `@codex-provider/core`。
- 版本是 `0.1.0-alpha.0`。
- 仍然 `private: true`。
- 主 bin 已经有 `codex-provider-server`，旧 bin `codex-provider-relay-server` / `codex-gateway-server` 保留。
- README 已经改成 `# CodexProvider`，并且把 `@codex-provider/core` 作为主包名。
- Root entrypoint 已经导出 `codex_provider_aliases.ts`，对外提供 `CodexProvider*` public API alias。
- 根 `package.json` 已经有新的 `codex-provider:*` scripts，同时保留旧 `codex-provider-relay:*` scripts。
- checklist 里剩余 blockers 是 live smoke、external consumer validation、changelog/release workflow。

所以当前可以开始“独立仓库抽取”，但不要 public publish。

---

## 为什么现在可以先拆

之前不建议立刻拆，是因为包名和 API 还没稳定。
现在这些关键项已经完成：

```text
CodexProvider
@codex-provider/core
CodexProviderRuntime
createCodexProviderFileSearchExecutor
codex-provider-server
```

因此，继续留在 CodexBridge monorepo 里会带来三个问题：

1. 新用户仍然看到目录名 `codex-provider-relay`，容易误解它属于 CodexBridge。
2. CI / dependency / docs 仍然混在 CodexBridge 项目里。
3. 外部 consumer validation 不够真实，因为同仓路径依赖容易掩盖边界问题。

独立仓库可以更早暴露这些问题：

- 是否缺 package-level devDependencies。
- 是否缺独立 tsconfig。
- 是否有隐性 monorepo 脚本依赖。
- 是否 docs 仍引用 CodexBridge 路径。
- 是否 examples 可以只通过 root entrypoint 编译。

---

## 非目标

本阶段不要做：

- 不要 public publish。
- 不要删除 deprecated aliases。
- 不要改核心协议架构。
- 不要新增外部 vector DB adapter。
- 不要新增 Docker/browser/shell/image provider 默认依赖。
- 不要把 CodexBridge host state 复制到新仓库。
- 不要把 WeChat/Telegram/Web UI/mission-control/codex-native-api 一起复制过去。
- 不要为了独立仓库而改动 runtime 行为。

---

## 建议独立仓库结构

如果当前只拆一个包，建议新仓库根目录就是 npm package root：

```text
CodexProvider/
  package.json
  tsconfig.json
  README.md
  LICENSE
  CHANGELOG.md
  src/
  test/
  docs/
  examples/
  scripts/
  .gitignore
  .npmignore or files field
  .github/
    workflows/
      ci.yml
```

不要再用：

```text
CodexProvider/packages/core
```

除非你现在确定要马上拆 `@codex-provider/server`、`tool-file-search`、`tool-web-search` 等多个 package。

当前阶段推荐单包 root repo，简单、清晰、方便 npm publish。

---

## 抽取方式选择

### Option A：保留历史

如果希望保留 `packages/codex-provider-relay` 的 git 历史，用 `git filter-repo`：

```bash
git clone git@github.com:Gan-Xing/CodexBridge.git CodexProvider-extract
cd CodexProvider-extract

git filter-repo \
  --path packages/codex-provider-relay/ \
  --path scripts/check-codex-provider-relay-boundary.mjs \
  --path-rename packages/codex-provider-relay/:
```

然后手动整理：

```text
scripts/check-codex-provider-relay-boundary.mjs -> scripts/check-boundary.mjs
```

优点：

- 保留历史。
- 适合正式开源项目。

缺点：

- 操作稍复杂。
- 需要清理路径和历史残留。

### Option B：不保留历史，直接复制

```bash
mkdir CodexProvider
cp -R CodexBridge/packages/codex-provider-relay/* CodexProvider/
mkdir -p CodexProvider/scripts
cp CodexBridge/scripts/check-codex-provider-relay-boundary.mjs CodexProvider/scripts/check-boundary.mjs
```

优点：

- 快。
- 最适合先做 private standalone validation。

缺点：

- 不保留细粒度历史。

我的建议：

```text
先 Option B 快速创建 private repo 验证。
确认没有边界问题后，如果需要历史，再用 Option A 正式迁移。
```

---

## 独立仓库 package.json 调整

当前 package.json 可以作为基础，但新仓库 root 需要自带 devDependencies。

建议：

```json
{
  "name": "@codex-provider/core",
  "version": "0.1.0-alpha.0",
  "private": true,
  "type": "module",
  "description": "Provider compatibility SDK that lets non-OpenAI models participate in the Codex native tool-call loop.",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "bin": {
    "codex-provider-server": "./dist/cli.js",
    "codex-provider-relay-server": "./dist/cli.js",
    "codex-gateway-server": "./dist/cli.js"
  },
  "files": [
    "dist",
    "README.md",
    "docs",
    "examples"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "serve": "node ./dist/cli.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "tsx --test test/*.test.ts",
    "check-boundary": "node scripts/check-boundary.mjs",
    "check": "pnpm test && pnpm typecheck && pnpm build && pnpm check-boundary"
  },
  "engines": {
    "node": ">=24"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3"
  }
}
```

保持：

```json
"private": true
```

直到 live smoke 和 external consumer validation 完成。

---

## 边界检查脚本调整

当前脚本来自：

```text
scripts/check-codex-provider-relay-boundary.mjs
```

新仓库中改成：

```text
scripts/check-boundary.mjs
```

需要修改：

```js
const repoRoot = process.cwd();
const packageRoot = repoRoot;
const sourceRoot = path.join(packageRoot, 'src');
```

删除或改写所有 monorepo 路径假设：

```text
packages/codex-provider-relay
packages/codex-native-api
packages/mission-control
apps
src/platforms
src/store
```

在独立仓库中，检查重点变成：

- `src/` 不 import 外部非 Node built-in 模块，除非 package.json 明确声明。
- `src/` 不引用 CodexBridge / CodexNext / WeChat / Telegram / host app 路径。
- `src/` 不读取 `.env` 或硬编码 secrets。
- examples 可以 import package root 或 local `../src/index.ts` 视测试策略而定，但 src 不能依赖 examples。

---

## 必须复制的文件

从当前包复制：

```text
packages/codex-provider-relay/src
packages/codex-provider-relay/test
packages/codex-provider-relay/docs
packages/codex-provider-relay/examples
packages/codex-provider-relay/README.md
packages/codex-provider-relay/package.json
packages/codex-provider-relay/tsconfig.json
```

从根复制/改造：

```text
scripts/check-codex-provider-relay-boundary.mjs -> scripts/check-boundary.mjs
```

新增：

```text
LICENSE
CHANGELOG.md
.gitignore
.github/workflows/ci.yml
```

---

## 独立仓库 README 首段

确保 README 不是 CodexBridge 视角。

建议：

```md
# CodexProvider

`@codex-provider/core` is a provider compatibility SDK for Codex app-server integrations. It lets non-OpenAI models participate in the Codex native tool-call loop by exposing a Responses-compatible surface over provider-specific Chat Completions APIs.

Historical names such as `CodexProviderRelay*` and `CodexGateway*` remain as deprecated aliases during the stabilization cycle.

This project is not affiliated with OpenAI.
```

加一句：

```text
CodexBridge and CodexNext are consumers, not owners of this package.
```

---

## CI

新增：

```text
.github/workflows/ci.yml
```

内容建议：

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm check-boundary
      - run: pnpm pack --dry-run
```

---

## 独立仓库验收命令

在新仓库根目录：

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check-boundary
pnpm pack --dry-run
git diff --check
```

如果没有 pnpm lockfile，先生成：

```bash
pnpm install
```

然后提交 `pnpm-lock.yaml`。

---

## External consumer validation

独立仓库建好后，再做 consumer validation。

### 推荐方式：standalone consumer harness

新增到新仓库：

```text
examples/standalone-consumer-harness.ts
```

这个文件只允许通过 package root import：

```ts
import {
  CodexProviderRuntime,
  createCodexProviderFileSearchExecutor,
  createCodexProviderMemoryFileSearchSource,
} from "@codex-provider/core";
```

在新仓库本地测试时，如果还没 publish，可以通过 package self-reference 或 tsconfig path。

测试目标：

- 可以 import root entrypoint。
- 可以 new `CodexProviderRuntime`。
- 可以 register relay-emulated `file_search` executor。
- 可以 start / stop runtime。
- 不需要 CodexBridge。
- 不需要 CodexNext。
- 不需要 WeChat / Telegram / web app state。

### CodexNext consumer validation

第二阶段再把 CodexNext 接上。

在 CodexNext 中使用：

```json
"@codex-provider/core": "file:../CodexProvider"
```

或 packed tarball：

```bash
cd CodexProvider
pnpm pack
cd ../CodexNext
pnpm add ../CodexProvider/codex-provider-core-0.1.0-alpha.0.tgz
```

然后只通过 root entrypoint import。

---

## 关于 live smoke

不要在独立仓库创建前继续做旧仓库路径下的 live smoke。
独立仓库创建后再执行，并记录到：

```text
docs/LIVE_SMOKE_RESULTS.md
```

因为现在 live smoke 应该验证：

```text
@codex-provider/core
CodexProviderRuntime
codex-provider-server
```

而不是旧的：

```text
@codexbridge/codex-provider-relay
CodexProviderRelayRuntime
codex-provider-relay-server
```

---

## 独立仓库后是否还保留 CodexBridge 中的包

短期建议保留，但变成镜像/开发副本之一。

推荐：

1. 新仓库 `CodexProvider` 成为主开发位置。
2. CodexBridge 里后续通过 dependency 依赖 `@codex-provider/core`。
3. 在稳定前可以使用 git submodule / workspace link / packed tarball。
4. 不要长期维护两份不同源码。

最终 CodexBridge 应该删除或冻结：

```text
packages/codex-provider-relay
```

并改为依赖：

```json
"@codex-provider/core": "workspace:*" or git/tarball/npm
```

---

## 推荐 PR / commit 顺序

### Commit 1

```text
chore: create standalone CodexProvider package skeleton
```

内容：

- copy src/test/docs/examples
- package.json root
- tsconfig
- README
- LICENSE
- CHANGELOG
- .gitignore

### Commit 2

```text
chore: add standalone CI and boundary check
```

内容：

- scripts/check-boundary.mjs
- .github/workflows/ci.yml
- package scripts

### Commit 3

```text
test: add standalone consumer harness
```

内容：

- examples/standalone-consumer-harness.ts
- optional test that validates root imports

### Commit 4

```text
docs: document extraction source and release gates
```

内容：

- docs/EXTRACTION.md
- docs/LIVE_SMOKE_RESULTS.md template
- update RELEASE_READINESS

---

## 给 AI 的执行 prompt

请把当前 CodexBridge 中的 `packages/codex-provider-relay` 抽成一个独立私有项目 `CodexProvider`。
注意：当前包已经改名为 `@codex-provider/core`，产品名是 `CodexProvider`，但仍然 `private: true`。本任务不是发布 npm，而是创建独立仓库结构并验证它能脱离 CodexBridge 构建和测试。

执行要求：

1. 不要发布 npm。
2. 不要删除 `CodexProviderRelay*` / `CodexGateway*` deprecated aliases。
3. 不要引入新 runtime dependency。
4. 不要复制 CodexBridge 的 WeChat/Telegram/Web UI/session/store/codex-native-api。
5. 不要新增外部 vector DB adapter。
6. 不要默认启用 computer/code_interpreter/shell。
7. 新仓库根目录就是 package root，不要再嵌套 `packages/core`，除非明确要变成多包 monorepo。

操作：

- 从 `packages/codex-provider-relay` 复制 `src/test/docs/examples/README.md/package.json/tsconfig.json`。
- 从根复制并改造 `scripts/check-codex-provider-relay-boundary.mjs` 为 `scripts/check-boundary.mjs`。
- 新增 `LICENSE`、`CHANGELOG.md`、`.gitignore`、`.github/workflows/ci.yml`。
- 修改 package scripts，确保独立仓库可运行：
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm check-boundary`
  - `pnpm pack --dry-run`
- 新增或保留 docs，说明这是从 CodexBridge 孵化出来的独立包，但 CodexBridge/CodexNext 只是 consumers。
- 添加 standalone consumer harness，证明只通过 `@codex-provider/core` root entrypoint 使用。

验收：

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check-boundary
pnpm pack --dry-run
git diff --check
```

最后输出：

- 新仓库文件结构
- 修改点
- 测试结果
- 是否仍有 CodexBridge 路径依赖
- 下一步是否可以让 CodexNext 通过 tarball/file dependency 消费
- 仍未完成的 release gates
