# CodexProvider Native Gateway + Skill Bootstrap Handoff

## 0. Current State

Repository:

```text
Gan-Xing/CodexProvider
```

Published package:

```text
codex-provider@0.1.0-alpha.0
```

Current branch expectation:

```text
main...origin/main
```

Recent completed downstream work:

```text
<downstream-codexnext-checkout>
- consumes published codex-provider@0.1.0-alpha.0
- requires Node >=24
- pushed clean after typecheck and tests
```

This handoff supersedes the earlier "manual gateway with --enable-web-search" target. The current product target is:

```text
CodexProvider should be installable by one curl command,
discoverable by Codex through a Skill,
and usable by Codex App/CLI through a local Native Gateway.
```

## 1. Final Closed Goal

Build **CodexProvider Native Gateway + Skill Bootstrap v1**.

End-user flow:

```bash
curl -fsSL https://raw.githubusercontent.com/Gan-Xing/CodexProvider/main/install.sh | bash
```

Then the user can talk to Codex:

```text
Use the codex-provider skill. Connect Codex to OpenRouter with model deepseek/deepseek-chat.
```

Codex should then know how to run:

```bash
codex-provider-server setup --provider openrouter --model deepseek/deepseek-chat
codex-provider-server start
codex-provider-server status
```

The closed outcome:

```text
Codex App/CLI routes model requests through the local codex-provider gateway,
third-party OpenAI-compatible models work,
implemented hosted tools are adapted by default,
and status/logs clearly show whether local gateway was used.
```

## 2. Product Shape

The v1 product has three layers:

1. `install.sh`
   Installs or updates the `codex-provider` CLI and installs the Codex Skill.

2. `skills/codex-provider/SKILL.md`
   Teaches Codex how to configure, start, inspect, and roll back the gateway.

3. `codex-provider-server`
   Runs the local Responses gateway, writes managed Codex config, adapts tools, and reports status.

Do not treat a raw handoff URL as the final user experience. The handoff is for development. The real user entrypoint is:

```text
curl bootstrap -> Codex Skill -> Native Gateway
```

## 3. Non-regression Boundary

Do not break existing behavior:

1. `codex-provider-server` with no subcommand must keep current standalone server behavior.
2. Add `codex-provider-server serve` as an explicit alias for current standalone behavior.
3. Keep `CodexProviderRuntime` public behavior stable.
4. Keep CodexNext/CodexBridge SDK integrations stable.
5. Do not rename or remove existing root exports.
6. Do not modify Codex App bundle files, `app.asar`, or official Codex installation files.
7. Do not commit or persist real upstream API keys in git or `~/.codex/config.toml`.
8. Do not replace Codex's permission model with a second CodexProvider permission system.
9. Do not silently claim a hosted tool is executable when required dependencies are missing.

The new behavior is additive. Existing SDK consumers and current standalone server users should not see behavior changes unless they use the new bootstrap/gateway flow.

## 4. Core Principle

Codex is the permission source. CodexProvider is the compatibility adapter.

Correct behavior:

```text
Codex owns approvals, workspace scope, shell/apply_patch execution, MCP, and local tool orchestration.
CodexProvider owns protocol compatibility, hosted-tool adaptation, model routing, and provider-side hosted tool execution only when needed.
```

Do not add `--enable-web-search`, `--enable-file-search`, or similar flags as the main product model.

Instead:

```text
Gateway exposes implemented capabilities by default.
Gateway delegates Codex-local tools back to Codex.
Gateway executes provider-side hosted tools only within Codex request/config constraints.
Gateway reports missing dependencies as unavailable.
```

## 5. Why This Is Not Codex++

Codex++ is primarily a desktop launcher / manager / CDP injection and relay management product.

CodexProvider should not copy that layer. The stronger route is:

```text
Codex App / CLI
  -> local codex-provider gateway
  -> OpenAI-compatible upstream provider
  -> protocol/tool adaptation
  -> Codex-compatible Responses result
```

CodexProvider's differentiator is the reusable hosted-tool adapter/executor layer:

```text
web_search
file_search
tool_search
image_generation
code_interpreter
computer
Codex-local apply_patch/shell/MCP conversion
```

## 6. CLI Target

Keep old behavior:

```bash
codex-provider-server
codex-provider-server --env-file .env
codex-provider-server --trace
```

Add explicit old-behavior alias:

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

Primary user path:

```bash
codex-provider-server setup --provider openrouter --model deepseek/deepseek-chat
codex-provider-server start
codex-provider-server status
```

Optional flags should tune configuration, not turn the product into a list of manual tool toggles:

```bash
--provider <preset>
--model <model>
--port <port>
--set-default
--env-file <path>
--trace
--workspace <path>
--file-search-root <path>
--image-provider <provider>
--code-sandbox <adapter>
--computer-adapter <adapter>
```

Provider credentials remain env-driven:

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

Never log or persist secrets in plaintext status output.

## 7. Bootstrap Target

Create:

```text
install.sh
skills/codex-provider/SKILL.md
```

`install.sh` responsibilities:

1. Detect Node >=24.
2. Enable Corepack when useful.
3. Install or update `codex-provider` CLI.
4. Install or update the skill at:

```text
~/.codex/skills/codex-provider/SKILL.md
```

5. Print the next user prompt:

```text
Use the codex-provider skill. Connect Codex to <provider> with model <model>.
```

`install.sh` must not:

1. Modify `~/.codex/config.toml` automatically.
2. Ask for or store API keys.
3. Start the gateway automatically.
4. Break if npm is unavailable before explaining the local/tarball fallback.

The Skill is the Agent-facing product surface. It must tell Codex:

1. How to check installed CLI version.
2. How to run setup/start/status/stop.
3. How to choose provider presets and env vars.
4. How to verify local gateway usage.
5. How to roll back safely.
6. Which tools are delegated to Codex and which are provider-side.
7. Never to commit secrets.

## 8. Config Management Contract

`setup` updates `~/.codex/config.toml` safely.

Requirements:

1. Create a timestamped backup before writing.
2. Replace only the managed CodexProvider block on repeat runs.
3. Preserve unrelated user config.
4. Preserve official ChatGPT login/auth state.
5. Do not write upstream provider API keys into `config.toml`.
6. Point Codex at the local gateway, not directly at OpenRouter/DeepSeek/Qwen.
7. Write root defaults only with `--set-default`.

Suggested managed block:

```toml
# BEGIN codex-provider native-gateway
[model_providers.codex_provider_gateway]
name = "CodexProvider Gateway"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:47321/v1"
# END codex-provider native-gateway
```

Only with `--set-default`:

```toml
model_provider = "codex_provider_gateway"
model = "deepseek/deepseek-chat"
```

## 9. Gateway State Contract

Use:

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
upstream_base_url: <redacted origin/path>
last_request_at: <timestamp or none>
last_upstream_provider: <provider or none>
tools:
  web_search: ready/unavailable/delegated
  file_search: ready/unavailable/delegated
  tool_search: ready/unavailable
  image_generation: ready/unavailable
  code_interpreter: ready/unavailable/delegated
  computer: ready/unavailable/delegated
  apply_patch: delegated-to-codex
  shell: delegated-to-codex
```

Keep status human-readable. Add `--json` later if useful.

## 10. Hosted Tool Strategy

Default stance:

```text
Declare and adapt all implemented hosted tool capabilities by default.
Do not require users to remember --enable-* flags.
Do not execute unavailable tools.
Delegate Codex-local high-permission tools to Codex.
```

Tool behavior target:

```text
web_search:
  default ready through codex-provider metasearch when network access is available.
  Use Brave/Serper/SerpApi/Tavily/SearXNG/OpenSERP only when configured.
  Respect request filters, external_web_access, user_location, and result limits.

file_search:
  default available when Codex/workspace/root scope is known.
  Use Codex workspace/config/request roots, never whole disk.
  If no safe root/scope is available, status says unavailable with reason.

tool_search:
  default ready when executor is present.
  May return deferred function tools/namespaces.

image_generation:
  capability exposed as unavailable until an image provider is configured.
  Ready only when provider/key/runtime contract exists.

code_interpreter:
  capability exposed as unavailable/delegated unless a sandbox adapter is configured.
  Never run arbitrary code in the gateway process.

computer:
  capability exposed as unavailable/delegated unless a computer adapter is configured.
  Do not bypass Codex approval UI.

apply_patch:
  delegated-to-codex.
  CodexProvider keeps conversion/proxy semantics only.

shell/local_shell:
  delegated-to-codex.
  CodexProvider keeps conversion semantics only.

MCP/connectors/skills:
  Codex-local or host-deferred unless explicit future adapter is added.
```

## 11. Observability Requirement

The user needs to know whether they are using local gateway or official Codex quota.

Add practical verification:

1. Every `/v1/responses` request emits a redacted trace when tracing is enabled.
2. `status` shows last request time and last upstream provider.
3. No prompt text is logged by default.
4. Secrets are redacted.
5. Tool executions are visible as summaries.

Trace fields:

```text
route=responses
provider=<provider>
model=<model>
upstream=<redacted origin/path>
tools=<none/web_search/file_search/...>
request_id=<local id>
```

This solves the real problem better than trying to infer billing from outside.

## 12. Mac Development Setup

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

Bootstrap test after implementation:

```bash
curl -fsSL https://raw.githubusercontent.com/Gan-Xing/CodexProvider/main/install.sh | bash
```

## 13. Mac E2E Validation

Use real upstream keys only in the shell:

```bash
export OPENROUTER_API_KEY="..."
```

Run:

```bash
codex-provider-server setup --provider openrouter --model deepseek/deepseek-chat
codex-provider-server start --trace
codex-provider-server status
```

Then verify in Codex App/CLI:

1. Normal model answer works.
2. Gateway logs show `/v1/responses`.
3. Status shows the configured upstream provider/model.
4. Hosted tool capability status is visible.
5. `web_search` executes through gateway when requested by the model and allowed by request/config.
6. `file_search` uses only safe workspace/root scope.
7. `apply_patch` and shell remain Codex-delegated.

Stop:

```bash
codex-provider-server stop
codex-provider-server status
```

## 14. Automated Test Checklist

Add tests before shipping:

1. Existing no-subcommand `codex-provider-server` behavior is unchanged.
2. `serve` alias uses the same standalone path.
3. `setup` writes only the managed config block.
4. `setup` preserves unrelated TOML content.
5. `setup --set-default` writes root provider/model defaults.
6. `setup` without `--set-default` does not change root defaults.
7. `start` declares/adapts implemented tools by default.
8. Missing dependencies produce `unavailable`, not fake success.
9. Delegated tools are marked delegated-to-codex.
10. `web_search` respects request/config constraints.
11. `file_search` never scans whole disk and requires a safe scope.
12. `status` redacts secrets.
13. `stop` removes stale pid state when process is gone.
14. `install.sh` installs the skill without changing Codex config.
15. The skill instructions do not include secrets and do not ask Codex to modify app bundles.

Run:

```bash
pnpm build
pnpm typecheck
pnpm test
git diff --check
```

## 15. Release Path

After Mac E2E passes:

1. Update README quickstart.
2. Update `docs/RECIPES.md`.
3. Update `docs/LIVE_SMOKE_RECIPES.md`.
4. Add or update redacted live smoke results.
5. Bump package version from `0.1.0-alpha.0` to the next alpha.
6. Run `npm pack --dry-run`.
7. Publish only after tarball verification and Mac E2E both pass.

## 16. Definition Of Done

This target is complete only when all are true:

1. A clean Mac can run the curl bootstrap.
2. The bootstrap installs/updates the CLI and Codex Skill.
3. Codex can read the skill and operate the gateway through natural language.
4. `setup/start/status/stop` work.
5. Codex App/CLI can route through the local gateway.
6. Status/logs make local gateway usage obvious.
7. Implemented hosted tools are declared/adapted by default.
8. Unavailable tools are reported honestly.
9. Codex-local privileged tools remain delegated to Codex.
10. Old standalone server behavior still works.
11. Existing SDK/runtime tests still pass.
12. No upstream API key is committed or written into managed Codex config.
