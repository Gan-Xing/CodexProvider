# Release Readiness

This package is prepared for a manual public alpha publish.

```json
{
  "name": "codex-provider",
  "version": "0.1.0-alpha.0",
  "private": false
}
```

## Current Publish Position

- Set `private: false`.
- Current live provider evidence covers OpenRouter, DeepSeek official, DashScope/Qwen, and API-backed SerpApi web_search. The package now uses the unscoped npm name `codex-provider`, so no npm organization is required.
- Current 2026-06-30 package-name audit: local npm is authenticated as `ganxing`, and `npm view codex-provider --json` returns `E404 Not found`, so the unscoped name is available for first publish.
- Search release exception status: not needed for the current audit because API-backed SerpApi web_search evidence is recorded.
- Keep root `exports` limited to `.` and `./package.json`.
- Active consumers must use the canonical `CodexProvider*`, `OpenAICompatible*`, and `createCodexProvider*` root exports.
- Historical Relay/Gateway compatibility aliases are removed from the active package surface and must not be reintroduced.
- Keep `examples` in the npm tarball for alpha consumers because they are host-neutral root-entrypoint integration references.
- Do not introduce subpath exports until the root API is stable.

## Release Workflow Decision

- npm package: `codex-provider`.
- npm scope: none. The package uses the unscoped name `codex-provider`.
- Versioning: stay on `0.1.0-alpha.x` while the root API is still changing.
- Changelog: keep `CHANGELOG.md` grouped by version with `Added`, `Changed`, `Fixed`, and `Validation` bullets.
- Release mode: manual release only for now. Do not add automatic npm publishing; OpenRouter, DeepSeek official, and DashScope/Qwen live evidence is recorded, but it still needs release-owner review before any public alpha decision.
- GitHub Actions: CI runs local verification and package hygiene checks, but publishing remains manual.
- Public alpha decision details are tracked in `docs/PUBLIC_ALPHA_RELEASE_PLAN.md`.

## Recommended Version Strategy

- Stay at `0.1.0-alpha.0` for the first public alpha publish.
- Update `CHANGELOG.md` in the same PR/commit as release-affecting behavior.
- Keep package export audit tests updated for every stable root value export.
- Keep `examples/standalone-consumer-harness.ts` passing as the root entrypoint consumer validation.
- Keep live smoke evidence current. Current redacted full-host evidence covers OpenRouter, DeepSeek official, and DashScope/Qwen; additional provider-preset evidence remains credential-gated.
- Publish only after the command gate passes and `npm view codex-provider --json` still returns `E404 Not found`.
- Do not prepare `0.1.0-alpha.1` until after the first public alpha publish needs a follow-up.

## Pre-Publish Command Gate

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

If the package directory does not have its own `node_modules`, use the workspace root scripts or ensure the workspace bin directory is on `PATH`.

Also run from the repository root:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
pnpm check-package-surface
pnpm pack:dry-run
pnpm public-alpha:audit
git diff --check
```

`pnpm public-alpha:audit` is expected to pass before the first manual public alpha publish. Treat it as the final readiness audit after package-name availability and API-backed search evidence are confirmed.

When credentials are available, also run:

```bash
pnpm smoke:web-search
pnpm smoke:host
```

## Tarball Inspection

Before publishing, inspect the package contents:

```bash
pnpm pack:dry-run
```

The tarball must include only:

- `dist`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `docs`
- `examples`
- `package.json`

It must not include secrets, `.env` files, local indexes, generated caches, Telegram/WeChat artifacts, host app source, host app hard dependencies, private workspace paths, large artifacts, or binary artifacts. `pnpm check-package-surface` scans the public package surface and the actual `npm pack --dry-run --json` file list for these release blockers.

## Last Dry-Run Snapshot

Recorded on 2026-06-30 with `npm pack --dry-run --json`:

- Package: `codex-provider@0.1.0-alpha.0`
- Tarball: `codex-provider-0.1.0-alpha.0.tgz`
- Total files: 594
- Package size: 407.6 kB
- Unpacked size: 1.9 MB
- Top-level shipped entries: `dist`, `README.md`, `CHANGELOG.md`, `LICENSE`, `docs`, `examples`, `package.json`
- Examples are intentionally shipped for alpha host integration reference.
