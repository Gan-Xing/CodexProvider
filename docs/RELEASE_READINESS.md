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
- Keep root `exports` limited to `.` and `./package.json`.
- Active consumers must use the canonical `CodexProvider*`, `OpenAICompatible*`, and `createCodexProvider*` root exports.
- Historical Relay/Gateway compatibility aliases are removed from the active package surface and must not be reintroduced.
- Keep `examples` in the npm tarball for alpha consumers because they are host-neutral root-entrypoint integration references.
- Do not introduce subpath exports until the root API is stable.

## Release Workflow Decision

- npm package: `@codex-provider/core`.
- npm scope: use `@codex-provider`; confirm account/scope ownership before removing `private: true`.
- Versioning: stay on `0.1.0-alpha.x` while the package is private and the root API is still changing.
- Changelog: keep `CHANGELOG.md` grouped by version with `Added`, `Changed`, `Fixed`, and `Validation` bullets.
- Release mode: manual release only for now. Do not add automatic npm publishing until live provider smoke evidence is recorded and reviewed.
- GitHub Actions: CI runs local verification and package hygiene checks, but publishing remains manual.
- Public alpha decision details are tracked in `docs/PUBLIC_ALPHA_RELEASE_PLAN.md`.

## Recommended Version Strategy

- Stay at `0.1.0-alpha.0` while `private: true`.
- Update `CHANGELOG.md` in the same PR/commit as release-affecting behavior.
- Keep package export audit tests updated for every stable root value export.
- Keep `examples/standalone-consumer-harness.ts` passing as the root entrypoint consumer validation.
- Run live smoke recipes and record redacted results.
- Publish only after at least one external host, such as CodexNext or a standalone app-server harness, consumes the package through the root entrypoint.

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
git diff --check
```

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

Recorded on 2026-06-11 with `npm pack --dry-run --json`:

- Package: `@codex-provider/core@0.1.0-alpha.0`
- Tarball: `codex-provider-core-0.1.0-alpha.0.tgz`
- Total files: 593
- Package size: 352.9 kB
- Unpacked size: 1.6 MB
- Top-level shipped entries: `dist`, `README.md`, `CHANGELOG.md`, `LICENSE`, `docs`, `examples`, `package.json`
- Examples are intentionally shipped for alpha host integration reference.
