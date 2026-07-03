# CodexProvider Skill

Use this skill when the user wants Codex App or Codex CLI to route model requests through CodexProvider's local native gateway.

## Operating Rules

- Do not modify Codex App bundles, `app.asar`, official app files, or ChatGPT login state.
- Do not ask the user to paste provider API keys into `~/.codex/config.toml`.
- Do not commit secrets. Provider credentials must stay in the shell environment or a user-owned env file.
- Codex owns approvals, shell, apply_patch, MCP, local computer control, and workspace permissions. CodexProvider only adapts protocol/tool calls and routes to the selected OpenAI-compatible provider.
- Use `codex-provider-server status` after setup/start before claiming the gateway is active.

## Check Installation

```bash
codex-provider-server --help
codex-provider-server status
```

If the command is missing, install or update:

```bash
curl -fsSL https://raw.githubusercontent.com/Gan-Xing/CodexProvider/main/install.sh | bash
```

## Provider Presets And Credentials

Supported preset examples:

- `openrouter`: set `OPENROUTER_API_KEY`
- `deepseek`: set `DEEPSEEK_API_KEY`
- `qwen`: set `QWEN_API_KEY` or `DASHSCOPE_API_KEY`
- `kimi`: set `KIMI_API_KEY`
- `minimax`: set `MINIMAX_API_KEY`
- `siliconflow`: set `SILICONFLOW_API_KEY`
- `gemini`: set `GEMINI_API_KEY`

Generic fallback:

```bash
export CODEX_PROVIDER_API_KEY="..."
export CODEX_PROVIDER_BASE_URL="https://provider.example/v1"
export CODEX_PROVIDER_MODEL="provider/model"
```

Do not persist those secrets in Codex config.

## Configure Gateway

Run setup with the requested provider/model:

```bash
codex-provider-server setup --provider openrouter --model deepseek/deepseek-chat
```

Use `--set-default` only when the user explicitly wants root Codex defaults changed:

```bash
codex-provider-server setup --provider openrouter --model deepseek/deepseek-chat --set-default
```

Safe optional tuning:

```bash
codex-provider-server setup --provider openrouter --model deepseek/deepseek-chat --port 47321
codex-provider-server setup --workspace "$PWD"
codex-provider-server setup --file-search-root "$PWD"
```

`setup` writes only the managed CodexProvider block in `~/.codex/config.toml`, creates a timestamped backup, and stores non-secret gateway state under `~/.codex-provider/`.

## Start, Inspect, Stop

Start:

```bash
codex-provider-server start
```

Start with traces:

```bash
codex-provider-server start --trace
```

Inspect:

```bash
codex-provider-server status
```

Status must show:

- `running: true`
- `base_url: http://127.0.0.1:<port>/v1`
- selected provider/model
- redacted upstream URL
- last request time after Codex uses the gateway
- tool readiness/delegation

Stop:

```bash
codex-provider-server stop
```

## Verify Gateway Usage

After asking Codex to use the configured provider, run:

```bash
codex-provider-server status
tail -n 50 ~/.codex-provider/native-gateway.log
```

The log/status should show `/v1/responses` activity through the local gateway. If no request appears, Codex is not using the configured gateway yet.

## Rollback

Stop the gateway:

```bash
codex-provider-server stop
```

Open `~/.codex/config.toml` and remove only:

```toml
# BEGIN codex-provider native-gateway
...
# END codex-provider native-gateway
```

If needed, restore the timestamped backup created next to `~/.codex/config.toml`.

## Tool Semantics

- `web_search`: adapter-emulated by CodexProvider when available.
- `file_search`: adapter-emulated only when a safe workspace/root is configured.
- `tool_search`: adapter-emulated deferred tool discovery.
- `image_generation`: unavailable until an explicit provider is configured.
- `code_interpreter`: delegated to Codex unless an explicit sandbox adapter is configured.
- `computer`: delegated to Codex unless an explicit adapter is configured.
- `apply_patch` and `shell`: always delegated to Codex.
