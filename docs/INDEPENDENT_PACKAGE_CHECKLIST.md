# Independent Package Checklist

`codex-provider` has a manual public alpha published on npm.

## Release Gate

- [x] `private: false` is set for the first public alpha publish.
- [x] Root `exports` exposes only the stable root entrypoint and `./package.json`.
- [x] Historical server/trace names are removed from the active package surface.
- [x] Canonical `CodexProvider*`, `OpenAICompatible*`, and `createCodexProvider*` APIs are exported from the root entrypoint.
- [x] Historical Relay/Gateway compatibility aliases are not part of the active package surface.
- [x] Package metadata uses `codex-provider` and `0.1.0-alpha.0` for public alpha.
- [x] Root scripts use canonical `codex-provider:*` names only.
- [x] Built-in hosted tools require explicit declarations.
- [x] Adapter-emulated hosted tools require explicit executors.
- [x] Unsafe tools have no default executor.
- [x] No sqlite driver, vector database driver, browser controller, shell sandbox, or image provider dependency is bundled.
- [x] Examples live outside `src` and do not pull host-app session/UI logic into the package.
- [x] Live smoke recipe documentation exists for upstream, web search, file search, image generation, and unsafe-tool default checks.
- [x] Unsafe tool security notes exist for code interpreter, computer, shell, and apply-patch boundaries.
- [x] Draft release readiness policy exists.
- [x] Public alpha release plan exists while keeping publishing manual.
- [x] Standalone consumer harness validates root entrypoint usage without CodexBridge internals.
- [x] OpenRouter full host-integration live smoke results are recorded in `docs/LIVE_SMOKE_RESULTS.md`.
- [x] DeepSeek official full host-integration live smoke results are recorded in `docs/LIVE_SMOKE_RESULTS.md`.
- [x] DashScope/Qwen full host-integration live smoke results are recorded in `docs/LIVE_SMOKE_RESULTS.md`.
- [x] Live smoke recipes are executed and recorded against real upstream providers.
- [x] Live consumer validation is completed through CodexNext or a standalone app-server harness.
- [x] Changelog policy and npm release workflow are decided.
- [x] Package tarball contents are inspected and recorded in `docs/RELEASE_READINESS.md`.
- [x] `codex-provider@0.1.0-alpha.0` is published to npm with the `alpha` dist-tag.

## Consumer Boundary

The package owns:

- Codex provider profile construction.
- Responses-to-Chat and Chat-to-Responses protocol conversion.
- Local Responses adapter runtime.
- Explicit hosted tool declaration and executor registry.
- Built-in adapter-emulated executor contracts.
- Search, file-search, image-generation, code-interpreter, and computer-use adapter interfaces.

The package does not own:

- CodexBridge, CodexNext, or any host UI state.
- Chat session persistence.
- WeChat, Telegram, browser, desktop, or mobile transports.
- User approval UX.
- Host sandbox implementation.
- Secret storage.
- External index deployment.

## Public Surface Policy

Prefer adding new root exports over subpath exports until the package reaches a stable semver release. Internal folders can be refactored without breaking consumers as long as the root entrypoint remains compatible.

Deprecated Relay/Gateway names are not part of the active package surface.

## Current Status

The public package name is now `codex-provider`, and real upstream live smoke evidence for OpenRouter, DeepSeek official, DashScope/Qwen, and API-backed SerpApi web_search is recorded in `docs/LIVE_SMOKE_RESULTS.md`. Version `0.1.0-alpha.0` is published as the first public alpha.
