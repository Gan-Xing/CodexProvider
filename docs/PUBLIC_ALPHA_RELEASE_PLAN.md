# Public Alpha Release Plan

`@codex-provider/core` remains an internal alpha package. This plan defines the path to a public alpha without publishing automatically.

## Current Decision

- Keep `private: true`.
- Keep version `0.1.0-alpha.0`.
- Keep package exports limited to `.` and `./package.json`.
- Keep publishing manual. Do not add npm auto-publish workflows.
- Keep `@codex-provider` as the intended npm scope, pending account and scope ownership confirmation.

## Readiness Audit

| Area | Current status | Public-alpha action |
| --- | --- | --- |
| `README.md` | Explains package goal, non-affiliation with OpenAI, profile modes, hosted tool boundaries, and key docs. | Add provider matrix links as provider evidence expands. |
| `CHANGELOG.md` | Has `0.1.0-alpha.0` with added/changed/validation notes. | Add a `0.1.0-alpha.1` section before any public alpha publish. |
| `docs/RELEASE_READINESS.md` | Records manual release posture, pre-publish gate, and latest dry-run snapshot. | Refresh after every release-affecting doc/code change. |
| `docs/INDEPENDENT_PACKAGE_CHECKLIST.md` | Package boundary and release checklist is largely complete while `private: true` remains. | Keep private until scope ownership and provider evidence are reviewed. |
| Package surface | `pnpm check-package-surface` scans docs/examples/package metadata and dry-run tarball contents. | Must pass before any publish decision. |

## `private:true` Exit Criteria

Do not set `private:false` until all items below are complete:

- npm account ownership for the `@codex-provider` scope is confirmed.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm consumer:harness`, `pnpm check-boundary`, `pnpm check-package-surface`, and `pnpm pack:dry-run` pass on the release commit.
- At least one OpenAI-compatible provider path has current live smoke evidence for normal response, forced custom tool, `file_search`, non-streaming `web_search`, and streaming `web_search`.
- API-backed web search evidence is recorded for Brave, Serper, or Tavily, or the missing credentials are explicitly documented as a release exception.
- `docs/PROVIDER_COMPATIBILITY_MATRIX.md` has current evidence status for OpenRouter, DeepSeek official, DashScope/Qwen, SiliconFlow, MiniMax, Moonshot/Kimi, and OpenAI direct Responses.
- `docs/OBSERVABILITY_AND_ERROR_POLICY.md` documents trace redaction, request validation, security violations, recoverable provider failures, fatal hosted tool failures, and loop-exceeded behavior.
- The release owner has reviewed the packed file list for secrets, host-app imports, private paths, generated caches, and binary artifacts.

## Alpha Version Policy

- `0.1.0-alpha.0` is the current internal alpha.
- `0.1.0-alpha.1` should be prepared only after the exit criteria above are satisfied and the changelog is updated.
- Do not skip from `0.1.0-alpha.0` to a stable version while provider behavior records are incomplete.
- Any breaking root API change before public alpha should remain within the `0.1.0-alpha.x` line and be called out in `CHANGELOG.md`.

## npm Scope Confirmation

Before changing `private:true`:

1. Confirm the npm organization or user owns the `@codex-provider` scope.
2. Confirm package name availability for `@codex-provider/core`.
3. Confirm two-factor requirements for the publishing account.
4. Confirm who can publish and who can deprecate an accidental release.
5. Record the decision in `docs/RELEASE_READINESS.md`.

## Manual Publish Steps

These steps are for a future release owner. They are not authorized by this cycle.

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm consumer:harness
pnpm check-boundary
pnpm check-package-surface
pnpm pack:dry-run
```

If credentials are available:

```bash
pnpm smoke:web-search
pnpm smoke:host
```

Then, after release approval:

```bash
npm publish --access public
```

## No Auto-Publish Policy

CI may run validation and package hygiene checks, but npm publishing stays manual until the project has a reviewed release owner, provider evidence is current, and the public alpha decision has been made explicitly.

