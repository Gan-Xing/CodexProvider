# Independent Package Checklist

`@codex-provider/core` remains internal-only until this checklist is complete.

## Release Gate

- [x] `private: true` is retained while the API is still stabilizing.
- [x] Root `exports` exposes only the stable root entrypoint and `./package.json`.
- [x] Historical server/trace names are removed from the active package surface.
- [x] Canonical `CodexProvider*`, `OpenAICompatible*`, and `createCodexProvider*` APIs are exported from the root entrypoint.
- [x] Historical Relay/Gateway compatibility aliases are not part of the active package surface.
- [x] Package metadata uses `@codex-provider/core` and `0.1.0-alpha.0` while retaining `private: true`.
- [x] Root scripts use canonical `codex-provider:*` names only.
- [x] Built-in hosted tools require explicit declarations.
- [x] Adapter-emulated hosted tools require explicit executors.
- [x] Unsafe tools have no default executor.
- [x] No sqlite driver, vector database driver, browser controller, shell sandbox, or image provider dependency is bundled.
- [x] Examples live outside `src` and do not pull host-app session/UI logic into the package.
- [x] Live smoke recipe documentation exists for upstream, web search, file search, image generation, and unsafe-tool default checks.
- [x] Unsafe tool security notes exist for code interpreter, computer, shell, and apply-patch boundaries.
- [x] Draft release readiness policy exists.
- [x] Standalone consumer harness validates root entrypoint usage without CodexBridge internals.
- [x] Non-web OpenRouter live smoke results are recorded in `docs/LIVE_SMOKE_RESULTS.md`.
- [ ] Live smoke recipes are executed and recorded against real upstream providers.
- [x] Live consumer validation is completed through CodexNext or a standalone app-server harness.
- [x] Changelog policy and npm release workflow are decided.
- [x] Package tarball contents are inspected and recorded in `docs/RELEASE_READINESS.md`.

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

## Current Blocker

The public package name is now `@codex-provider/core`, but the package remains internal-only. Keep `private: true`, keep `version: "0.1.0-alpha.0"`, and avoid adding new public subpath exports until provider live smoke evidence is complete.
