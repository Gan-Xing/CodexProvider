# CodexProvider Recursive Quality Loop Handoff

## 0. 本文目标

本 handoff 用于驱动 CodexProvider 进入“质量递归循环”：

```text
审计当前项目
  -> 生成完整 backlog
  -> 完成整个 backlog
  -> 跑完整验证
  -> 记录结果并计数 +1
  -> 再审计生成下一版 backlog
  -> 重复，直到达到循环次数或截止时间
```

重点：**不是完成一个子任务就计数**。只有当前 cycle 的完整 backlog 被完成或被明确标记为外部阻塞，并且完整 gate 通过，才算完成一次 cycle。

本轮目标不包含 CodexNext / Codex app-server 产品级接入验证。其余目标都纳入递归循环。

---

## 1. 当前项目状态

从当前仓库文档看，CodexProvider 已经完成大部分基础硬化：

- Phase 0-9 已完成，Phase 10 Public alpha release decision 尚未开始。
- `web_search` / `file_search` 的 100% parity tracker 已经记录 request-config binding、DNS SSRF、真实 fast mode、扩展验证、web_search 输出策略、file_search cursor pagination、质量 fixture、package hygiene、live smoke evidence 等工作完成。
- `docs/INDEPENDENT_PACKAGE_CHECKLIST.md` 已基本全部勾选，但仍建议保留 `private: true` 直到明确发布决策。
- `docs/LIVE_SMOKE_RESULTS.md` 已有 OpenRouter-compatible + builtin no-key metasearch 的 live evidence。
- 当前仍未纳入今晚目标的是真实 CodexNext / Codex app-server 产品级接入验证。

下一步不是继续补同一批底层 parity，而是进入更大目标的持续审计与递归改进。

---

## 2. 本次循环覆盖的 5 个大方向

### A. Public Alpha Release Readiness

目标：让 `@codex-provider/core` 从 internal alpha 逐步具备 public alpha 发布条件，但不自动发布。

需要持续审计：

- `private:true` 是否仍应保留。
- npm scope `@codex-provider` 是否已确认。
- `CHANGELOG.md` 是否足够可发布。
- `README.md` 是否准确说明能力、边界、非 OpenAI affiliation。
- `docs/RELEASE_READINESS.md` 是否有最新 tarball snapshot。
- `pnpm pack:dry-run` 的内容是否仍干净。
- examples/docs 是否没有 secrets、private paths、host-app imports。
- 是否需要 `0.1.0-alpha.1` 版本准备文档。

### B. Provider Compatibility Matrix & Presets

目标：把项目从“OpenRouter + DeepSeek 通过 smoke”扩展成多 provider 可验证 SDK。

Provider matrix 建议覆盖：

- OpenRouter
- DeepSeek official
- DashScope / Qwen OpenAI-compatible
- SiliconFlow
- MiniMax
- Moonshot / Kimi
- OpenAI direct Responses
- 未来 Claude-compatible adapter

每个 provider 应记录：

- normal response
- forced custom tool
- adapter-emulated `file_search`
- adapter-emulated `web_search`
- streaming `web_search`
- reasoning behavior
- tool call quirks
- recommended profile mode
- required env vars

Presets 应逐步形成：

```ts
createCodexProviderOpenRouterProfile()
createCodexProviderDeepSeekProfile()
createCodexProviderDashScopeQwenProfile()
createCodexProviderSiliconFlowProfile()
createCodexProviderMiniMaxProfile()
createCodexProviderKimiProfile()
```

### C. Web Search Productization

目标：不只“能跑”，还要让 web_search 更适合真实使用。

重点 backlog 来源：

- API-key-backed Brave / Serper / Tavily live evidence。
- provider-backed search 与 no-key metasearch 的结果质量差异记录。
- search engine health / latency / failure observability。
- search source priority / fallback strategy docs。
- web_search result/result-source UI guidance。
- domain policy profiles。
- search quality regression suite 继续扩展。
- parser fixture maintenance workflow 继续强化。

### D. Deep Search / Research Tool

目标：把 heuristic deep search 逐步发展成独立 opt-in research tool，而不是污染默认 `web_search`。

潜在方向：

- `createCodexProviderDeepWebSearchExecutor` 的 planner 接口。
- query decomposition。
- sub-question graph。
- parallel search nodes。
- reference merge。
- answer synthesis contract。
- budget/citation controls。
- tests for graph execution and reference dedupe。
- docs clearly state deep search is opt-in and not default `web_search` path.

### E. Observability + Error/Security Policy

目标：让这个 SDK 在真实 host 中可 debug、可审计、可维护。

需要持续强化：

- structured trace events
- hosted tool execution lifecycle
- search engine latency/failure stats
- retrieval cache hit/miss
- citation placeholder counts
- local index hit/miss
- tool loop iteration records
- typed error policy
- fatal vs recoverable hosted tool errors
- request validation vs security violation vs provider transient failure
- unsafe tool no-default-executor policy

---

## 3. Cycle 计数规则

一次 cycle 完成必须满足：

1. 执行 AI 先审计当前代码与文档。
2. 为当前 cycle 生成完整 backlog，写入 `docs/handoff/CODEX_PROVIDER_RECURSIVE_QUALITY_BACKLOG.md`。
3. 完成该 backlog 中所有 `- [ ]` 项。
4. 如果某项需要外部凭证或人工决策，可标记为 `- [!]`，并写明原因；这种状态算“本 cycle 已处理”，但不会假装完成。
5. 跑完整本地 gate：
   ```bash
   pnpm test
   pnpm typecheck
   pnpm build
   pnpm consumer:harness
   pnpm check-boundary
   pnpm check-package-surface
   pnpm pack:dry-run
   ```
6. 如 credentials 存在，可以跑：
   ```bash
   pnpm smoke:web-search
   pnpm smoke:host
   ```
   没有 credentials 不允许伪造结果。
7. 更新 tracker / backlog / docs。
8. commit + push。
9. 运行计数脚本完成 cycle，计数 +1。
10. 再开始下一轮审计，生成新的 backlog。

---

## 4. 截止条件

循环必须在任一条件满足时停止：

- 已完成 20 个 cycle。
- 当前时间达到或超过伦敦时间 2026-06-11 05:30。
- 因为 2026-06-11 伦敦为 BST，脚本默认 UTC 截止时间为：
  ```text
  2026-06-11T04:30:00.000Z
  ```
- 发生 Stop Condition：
  - 缺少必要 secret / token / 账号权限；
  - 需要用户做产品决策；
  - 测试环境完全无法启动；
  - 出现无法安全解决的 merge conflict；
  - 继续执行会破坏大量无关功能。

---

## 5. 建议脚本

把下载的脚本放入：

```text
scripts/recursive-quality-cycle.mjs
```

建议加执行权限：

```bash
chmod +x scripts/recursive-quality-cycle.mjs
```

可选 package scripts：

```json
{
  "quality:init": "node scripts/recursive-quality-cycle.mjs init",
  "quality:status": "node scripts/recursive-quality-cycle.mjs status",
  "quality:guard": "node scripts/recursive-quality-cycle.mjs guard",
  "quality:scan": "node scripts/recursive-quality-cycle.mjs scan",
  "quality:gate": "node scripts/recursive-quality-cycle.mjs gate",
  "quality:complete-cycle": "node scripts/recursive-quality-cycle.mjs complete-cycle"
}
```

脚本默认写入：

```text
docs/handoff/CODEX_PROVIDER_RECURSIVE_QUALITY_STATE.json
docs/handoff/CODEX_PROVIDER_RECURSIVE_QUALITY_BACKLOG.md
docs/handoff/CODEX_PROVIDER_RECURSIVE_QUALITY_AUDIT_REPORT.md
```

---

## 6. Cycle 1 Seed Backlog

执行 AI 第一次循环不要空泛“继续优化”，应至少覆盖以下 backlog。执行前仍要重新审计当前仓库，并可根据实际情况细化或调整。

### C1-A Release Readiness

- [ ] 审计 `README.md`、`CHANGELOG.md`、`docs/RELEASE_READINESS.md`、`docs/INDEPENDENT_PACKAGE_CHECKLIST.md` 是否已经适合 public alpha。
- [ ] 新增或更新 `docs/PUBLIC_ALPHA_RELEASE_PLAN.md`，明确：
  - 是否继续 `private:true`；
  - 什么时候可以切 `private:false`；
  - 版本从 `0.1.0-alpha.0` 到 `0.1.0-alpha.1` 的条件；
  - npm scope `@codex-provider` 的确认步骤；
  - 手动发布步骤；
  - 不自动 publish 的原则。
- [ ] 确认 `pnpm pack:dry-run` 结果在 release docs 中仍准确。
- [ ] 确认 package surface 没有新增 host-app dependency。

### C1-B Provider Matrix

- [ ] 新增或更新 `docs/PROVIDER_COMPATIBILITY_MATRIX.md`。
- [ ] 至少列出：
  - OpenRouter
  - DeepSeek official
  - DashScope/Qwen
  - SiliconFlow
  - MiniMax
  - Moonshot/Kimi
  - OpenAI direct Responses
- [ ] 每个 provider 至少有字段：
  - base URL env
  - model env
  - supported protocol
  - recommended profile mode
  - supports tools
  - supports streaming
  - forced tool call behavior
  - file_search status
  - web_search status
  - known quirks
  - evidence status
- [ ] 将已有 OpenRouter smoke evidence 链接进矩阵。
- [ ] 没有 credentials 的 provider 标成 `Pending credentials`，不要伪造。

### C1-C Provider Presets

- [ ] 审计当前 profile / runtime API，判断 provider presets 应放在哪个模块。
- [ ] 设计并实现最小 provider preset API，至少覆盖 OpenRouter 和 DeepSeek official，若时间允许再加 DashScope/Qwen。
- [ ] 预设应返回现有 profile/config 能消费的结构，不要引入新 runtime dependency。
- [ ] 添加 root export。
- [ ] 添加 unit tests，确认 preset 的 base URL、profile mode、capabilities、env naming 不破坏现有行为。
- [ ] 更新 README 或 RECIPES 展示 preset 用法。

### C1-D Web Search Productization

- [ ] 审计 `examples/live-web-search-smoke.ts` 是否能显式选择 API-backed Brave/Serper/Tavily。
- [ ] 若已有能力，更新 docs 明确如何运行 API-backed web_search smoke。
- [ ] 若没有，新增 env-driven 选择：
  - `CODEX_PROVIDER_WEB_SEARCH_PROVIDER=brave|serper|tavily|builtin-metasearch`
  - 对应 API key env。
- [ ] 增加 docs 说明：
  - no-key metasearch 适合默认/开发；
  - Brave/Serper/Tavily API 适合生产；
  - no-key HTML engines 不保证稳定。
- [ ] 若凭证存在，运行并记录 API-backed smoke；否则标记为 `[!] Pending credentials`。

### C1-E Deep Search / Observability / Error Policy

- [ ] 审计 `src/web-search/deep/`，写明目前是 heuristic/opt-in 还是已可推荐。
- [ ] 新增或更新 `docs/DEEP_WEB_SEARCH_ROADMAP.md`，明确：
  - 不进入默认 `web_search`；
  - planner interface；
  - graph execution；
  - reference merge；
  - synthesis contract；
  - tests needed。
- [ ] 新增或更新 `docs/OBSERVABILITY_AND_ERROR_POLICY.md`，定义：
  - request validation error；
  - security violation；
  - recoverable hosted tool provider error；
  - fatal hosted tool error；
  - tool loop exceeded；
  - trace redaction policy。
- [ ] 如当前代码缺 typed fatal tool error，列为下一 cycle backlog，不强行一次做完。
- [ ] 确认现有 trace 不泄露 secrets 或完整文档内容；若发现问题，必须修。

### C1-F Validation + Counter

- [ ] 运行 `node scripts/recursive-quality-cycle.mjs scan` 并检查报告。
- [ ] 跑完整 gate。
- [ ] 更新 recursive backlog，所有项变为 `[x]` 或 `[!]`。
- [ ] commit + push。
- [ ] 运行：
  ```bash
  node scripts/recursive-quality-cycle.mjs complete-cycle
  ```
- [ ] 如果计数成功，脚本会生成下一 cycle 模板；下一轮从新 backlog 审计开始。

---

## 7. Definition of Done for One Cycle

- 当前 cycle backlog 无 `- [ ]`。
- 所有新增代码有测试。
- 所有新增 public API 有 root export 测试或文档。
- 完整 gate 通过。
- smoke 不伪造。
- docs 更新。
- commit + push 完成。
- script complete-cycle 成功，计数 +1。

---

## 8. 推荐 commit 规范

示例：

```text
docs(release): 补齐公共Alpha发布计划 / add public alpha release plan
docs(provider): 建立供应商兼容矩阵 / add provider compatibility matrix
feat(presets): 添加供应商配置预设 / add provider profile presets
docs(search): 补充API搜索烟测说明 / document API-backed search smoke
docs(observability): 定义错误与观测策略 / define error and observability policy
chore(quality): 完成递归质量循环计数 / complete recursive quality cycle
```

---

## 9. 给 Codex 的循环原则

执行 AI 不应把一个小任务当作一轮。它必须：

1. 审计。
2. 写完整 backlog。
3. 完成完整 backlog。
4. 验证。
5. commit/push。
6. complete-cycle 计数。
7. 再审计生成下一轮 backlog。
8. 直到计数达到 20 或截止时间到达。

如果某 cycle 发现上轮 AI 写得不够完整，就把不足写进新 backlog 并修掉。这就是本机制的目的。
