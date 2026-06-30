# Release Readiness

This package is still internal-only.

```json
{
  "name": "@codex-provider/core",
  "version": "0.1.0-alpha.0",
  "private": true
}
```

## Current Publish Position

- Keep `private: true`.
- Current live provider evidence covers OpenRouter, DeepSeek official, DashScope/Qwen, and API-backed SerpApi web_search, but public alpha release approval and npm scope ownership are still pending.
- Current 2026-06-30 blocker audit: local npm is authenticated as `ganxing`, but authenticated registry checks still do not show `@codex-provider/core`, and `@codex-provider` scope ownership cannot be proven because `npm org ls @codex-provider --json` returns `E404 Scope not found`. The preferred third-provider smoke is satisfied by DeepSeek official evidence, and API-backed web-search evidence is satisfied by the SerpApi smoke.
- Search release exception status: not needed for the current audit because API-backed SerpApi web_search evidence is recorded.
- Keep root `exports` limited to `.` and `./package.json`.
- Active consumers must use the canonical `CodexProvider*`, `OpenAICompatible*`, and `createCodexProvider*` root exports.
- Historical Relay/Gateway compatibility aliases are removed from the active package surface and must not be reintroduced.
- Keep `examples` in the npm tarball for alpha consumers because they are host-neutral root-entrypoint integration references.
- Do not introduce subpath exports until the root API is stable.

## Release Workflow Decision

- npm package: `@codex-provider/core`.
- npm scope: intended scope is `@codex-provider`; create or obtain access to that npm organization/scope before removing `private: true`, or explicitly choose a different scope.
- Versioning: stay on `0.1.0-alpha.x` while the package is private and the root API is still changing.
- Changelog: keep `CHANGELOG.md` grouped by version with `Added`, `Changed`, `Fixed`, and `Validation` bullets.
- Release mode: manual release only for now. Do not add automatic npm publishing; OpenRouter, DeepSeek official, and DashScope/Qwen live evidence is recorded, but it still needs release-owner review before any public alpha decision.
- GitHub Actions: CI runs local verification and package hygiene checks, but publishing remains manual.
- Public alpha decision details are tracked in `docs/PUBLIC_ALPHA_RELEASE_PLAN.md`.

## Recommended Version Strategy

- Stay at `0.1.0-alpha.0` while `private: true`.
- Update `CHANGELOG.md` in the same PR/commit as release-affecting behavior.
- Keep package export audit tests updated for every stable root value export.
- Keep `examples/standalone-consumer-harness.ts` passing as the root entrypoint consumer validation.
- Keep live smoke evidence current. Current redacted full-host evidence covers OpenRouter, DeepSeek official, and DashScope/Qwen; additional provider-preset evidence remains credential-gated.
- Publish only after a release owner reviews the evidence and confirms npm scope ownership.
- Do not prepare `0.1.0-alpha.1` until the public alpha plan moves from `continue private` to a release-owner-approved alpha decision.

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

`pnpm public-alpha:audit` is expected to fail while the project remains private or externally blocked. Treat it as the final manual readiness audit after npm scope ownership, API-backed search evidence, or the search exception approval has been resolved.

When credentials are available, also run:

```bash
pnpm smoke:web-search
pnpm smoke:host
```

## Tarball Inspection

Before removing `private: true`, inspect the package contents:

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

- Package: `@codex-provider/core@0.1.0-alpha.0`
- Tarball: `codex-provider-core-0.1.0-alpha.0.tgz`
- Total files: 594
- Package size: 407.8 kB
- Unpacked size: 1.9 MB
- Top-level shipped entries: `dist`, `README.md`, `CHANGELOG.md`, `LICENSE`, `docs`, `examples`, `package.json`
- Examples are intentionally shipped for alpha host integration reference.
