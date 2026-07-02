# CodexProvider Native Gateway Mac Handoff

## 0. Current State

Repository:

```text
Gan-Xing/CodexProvider
```

Package already published:

```text
codex-provider@0.1.0-alpha.0
```

Current clean baseline before this handoff:

```text
main...origin/main
```

Recent completed work outside this repository:

```text
/home/ubuntu/dev/codexnext
- now consumes published codex-provider@0.1.0-alpha.0
- root and agent runtime require Node >=24
- typecheck and tests passed before push
```

The next work should be validated on macOS because the target user path is the real Codex App / Codex CLI environment:

```text
~/.codex/config.toml
~/.codex/auth.json
Codex App login state
Codex CLI/app-server model provider config
local gateway process
```

## 1. One-line Closed Goal

Build **Codex Native Gateway v1**:

```text
After installing codex-provider, a normal user can run setup/start/status/stop commands
to route Codex App/CLI model requests through a local codex-provider Responses gateway,
with optional self-hosted web_search and file_search enabled explicitly.
```

This is a user-facing gateway target, not a rewrite of the existing SDK.

## 2. Non-regression Boundary

Do not break existing behavior:

1. `codex-provider-server` with the current no-subcommand behavior must still start the existing standalone server from `CODEX_PROVIDER_*` env vars.
2. Add an explicit `serve` alias for the current standalone behavior, but keep old invocation compatible.
3. Do not change `CodexProviderRuntime` public behavior.
4. Do not change CodexNext/CodexBridge SDK integration paths.
5. Do not rename or remove existing root exports.
6. Do not silently enable hosted tools.
7. Do not write upstream provider API keys into the git repo or into `~/.codex/config.toml`.
8. Do not modify the Codex App bundle, `app.asar`, or official Codex installation files.
9. Do not set the user's global default model unless the command has an explicit `--set-default` flag.

The new gateway must be opt-in. Existing users should see no behavior change unless they use the new commands.

## 3. Why This Is Different From Codex++

Codex++ is mainly a desktop launcher / manager / CDP injection product. Its relay injection writes a provider config and routes model traffic, while official Codex login state still owns app account features and plugin entry.

CodexProvider should not copy the desktop injection layer. The stronger path is:

```text
Codex App / CLI
  -> local codex-provider gateway
  -> OpenAI-compatible upstream model
  -> optional adapter-emulated hosted tools
  -> Codex-compatible Responses result
```

Our advantage is the self-hosted tool executor layer:

```text
web_search: builtin metasearch, Brave, Serper, SerpApi, Tavily, SearXNG/OpenSERP endpoint adapters
file_search: explicit local roots, memory docs, SQLite FTS, vector/local-vector sources
```

Codex++ appears to convert tool shapes and relay protocol, but it does not appear to bundle the same self-hosted search/file executor runtime.

## 4. Current Code Facts To Confirm Before Editing

Start from these files:

```text
src/cli.ts
src/server/standalone_server.ts
src/server/responses-adapter-server/server.ts
src/hosted_tools.ts
src/hosted_tool_executors.ts
src/web_search_executor.ts
src/file_search_executor.ts
docs/RECIPES.md
docs/LIVE_SMOKE_RECIPES.md
```

Current important behavior:

1. `src/cli.ts` currently behaves like an internal standalone launcher.
2. `src/server/standalone_server.ts` requires one upstream model API key.
3. The standalone server currently builds a model protocol adapter from env vars.
4. The adapter server only executes adapter-emulated tools when hosted tool declarations and matching executors are registered.
5. Without tool executors, `web_search` / `file_search` must not pretend to work.

## 5. Target CLI Shape

Keep this compatible:

```bash
codex-provider-server
codex-provider-server --env-file .env
codex-provider-server --trace
```

Add this explicit old-behavior alias:

```bash
codex-provider-server serve
codex-provider-server serve --env-file .env --trace
```

Add Native Gateway commands:

```bash
codex-provider-server setup
codex-provider-server start
codex-provider-server status
codex-provider-server stop
```

Recommended v1 command options:

```bash
codex-provider-server setup \
  --provider openrouter \
  --model deepseek/deepseek-chat \
  --port 47321

codex-provider-server start \
  --provider openrouter \
  --model deepseek/deepseek-chat \
  --port 47321 \
  --enable-web-search

codex-provider-server start \
  --provider openrouter \
  --model deepseek/deepseek-chat \
  --port 47321 \
  --enable-web-search \
  --file-search-root "$PWD"

codex-provider-server status
codex-provider-server stop
```

Provider inputs should still work through existing env vars:

```bash
OPENROUTER_API_KEY=...
DEEPSEEK_API_KEY=...
DASHSCOPE_API_KEY=...
QWEN_API_KEY=...
MINIMAX_API_KEY=...
KIMI_API_KEY=...
CODEX_PROVIDER_API_KEY=...
CODEX_PROVIDER_BASE_URL=...
CODEX_PROVIDER_MODEL=...
```

Never commit real keys.

## 6. Config Management Contract

`setup` should update `~/.codex/config.toml` safely.

Requirements:

1. Create a timestamped backup before writing.
2. Replace only a managed CodexProvider block on repeat runs.
3. Preserve unrelated user config.
4. Do not remove official ChatGPT auth config.
5. Do not store upstream provider API keys in `config.toml`.
6. Codex should point at the local gateway base URL, not directly at OpenRouter/DeepSeek/Qwen.

Suggested managed block style:

```toml
# BEGIN codex-provider native-gateway
[model_providers.codex_provider_gateway]
name = "CodexProvider Gateway"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:47321/v1"
# END codex-provider native-gateway
```

Only write root defaults when explicitly requested:

```toml
model_provider = "codex_provider_gateway"
model = "deepseek/deepseek-chat"
```

This should require:

```bash
--set-default
```

## 7. Gateway State Contract

Use a state directory outside the repo:

```text
~/.codex-provider/
```

Suggested files:

```text
~/.codex-provider/native-gateway.json
~/.codex-provider/native-gateway.pid
~/.codex-provider/native-gateway.log
```

`status` should report:

```text
running: true/false
pid: <pid or none>
base_url: http://127.0.0.1:47321/v1
provider: openrouter/deepseek/qwen/etc
model: <model>
upstream_base_url: <redacted origin only>
web_search: disabled/enabled, provider=<builtin-metasearch/brave/serper/...>
file_search: disabled/enabled, roots=<count>
last_error: <short message if any>
```

Redact secrets in all logs and status output.

## 8. Tool Wiring Contract

`start` should support two layers:

1. Model-only gateway:

```text
No hosted tools declared.
No executor registered.
Only protocol conversion and upstream model routing.
```

2. Explicit self-hosted tools:

```text
hostedTools: [{ name: "web_search", mode: "adapter-emulated" }]
hostedToolExecutors.web_search = createCodexProviderWebSearchExecutor(...)
```

For file search:

```text
hostedTools: [{ name: "file_search", mode: "adapter-emulated" }]
hostedToolExecutors.file_search = createCodexProviderFileSearchExecutor(...)
```

Rules:

1. `web_search` can default to no-key builtin metasearch when `--enable-web-search` is present.
2. API search keys are optional and selected only when configured.
3. `file_search` must require at least one explicit `--file-search-root`.
4. Never scan the process cwd implicitly.
5. Unsafe tools stay disabled by default:

```text
code_interpreter
computer
shell
local_shell
apply_patch execution
```

## 9. Observability Requirement

The user needs to know whether Codex is using local gateway or official quota.

Add a practical answer through local status and logs:

1. Every `/v1/responses` request should emit a redacted trace line when gateway trace is enabled.
2. Trace should include:

```text
route=responses
provider=<provider>
model=<model>
upstream=<origin/path without key>
tools=<none/web_search/file_search>
request_id=<local id>
```

3. `status` should show last request time and last upstream provider.
4. Do not log prompts by default.
5. Provide `--trace` for debug-level stderr/file logs.

This is more useful than trying to prove quota usage from the outside.

## 10. Mac Development Setup

On Mac:

```bash
nvm install 24
nvm use 24
corepack enable
```

Then:

```bash
git clone https://github.com/Gan-Xing/CodexProvider.git
cd CodexProvider
pnpm install
pnpm build
pnpm test
```

Local package test:

```bash
pnpm pack
npm i -g ./codex-provider-*.tgz
codex-provider-server --help
```

If testing without global install:

```bash
node dist/cli.js --help
```

## 11. Mac E2E Validation After Implementation

Use a real upstream key in the shell only:

```bash
export OPENROUTER_API_KEY="..."
```

Example flow:

```bash
codex-provider-server setup \
  --provider openrouter \
  --model deepseek/deepseek-chat \
  --port 47321

codex-provider-server start \
  --provider openrouter \
  --model deepseek/deepseek-chat \
  --port 47321 \
  --enable-web-search \
  --trace

codex-provider-server status
```

Then open Codex App / CLI and verify:

1. A normal model answer works.
2. Gateway logs show a `/v1/responses` request.
3. Upstream provider in status is the configured non-OpenAI provider.
4. Web search request emits hosted tool execution traces when enabled.
5. File search only works when explicit roots are provided.

Stop:

```bash
codex-provider-server stop
codex-provider-server status
```

## 12. Automated Test Checklist

Add tests before shipping:

1. CLI parser keeps old no-subcommand `serve` behavior.
2. `serve` alias uses the same standalone server path.
3. `setup` writes only the managed block.
4. `setup` preserves unrelated TOML content.
5. `setup --set-default` writes root provider/model defaults.
6. `setup` without `--set-default` does not change root defaults.
7. `start` model-only mode registers no hosted tool declarations.
8. `start --enable-web-search` registers `web_search` declaration and executor.
9. `start --file-search-root <path>` registers `file_search` declaration and executor.
10. `file_search` rejects missing explicit roots.
11. `status` redacts secrets.
12. `stop` removes stale pid state when process is gone.

Run at minimum:

```bash
pnpm build
pnpm typecheck
pnpm test
git diff --check
```

## 13. Release Path

After Mac E2E passes:

1. Update README quickstart.
2. Update `docs/RECIPES.md`.
3. Update `docs/LIVE_SMOKE_RECIPES.md`.
4. Add live smoke result summary with secrets redacted.
5. Bump package version from `0.1.0-alpha.0` to the next alpha.
6. Run `npm pack --dry-run`.
7. Publish only after the tarball and Mac E2E are both verified.

## 14. Definition Of Done

This goal is done only when all are true:

1. A clean Mac can install/build the package.
2. `codex-provider-server setup/start/status/stop` works.
3. Codex App/CLI can route through local gateway.
4. Status/logs make it obvious that the local gateway was used.
5. `web_search` can run through self-hosted executor when enabled.
6. `file_search` can run against an explicit local root when enabled.
7. Old standalone server behavior still works.
8. Existing SDK/runtime tests still pass.
9. No upstream API key is committed or written into managed Codex config.
