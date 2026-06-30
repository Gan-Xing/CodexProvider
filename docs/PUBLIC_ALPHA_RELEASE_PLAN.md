# Public Alpha Release Plan

`@codex-provider/core` remains an internal alpha package. This plan defines the path to a public alpha without publishing automatically.

## Current Decision

- Keep `private: true`.
- Keep version `0.1.0-alpha.0`.
- Keep package exports limited to `.` and `./package.json`.
- Keep publishing manual. Do not add npm auto-publish workflows.
- Keep `@codex-provider` as the intended npm scope, pending account and scope ownership confirmation.
- Treat current OpenRouter, DeepSeek official, and DashScope/Qwen live evidence as necessary but not sufficient for public alpha; release-owner review is still required.
- Current conclusion on 2026-06-30: continue private. Do not prepare `0.1.0-alpha.1` yet and do not enter manual publish approval until the blockers below are resolved or explicitly accepted by the release owner.

## Current Blockers

- npm scope ownership is not confirmed. `npm whoami` fails with `ENEEDAUTH`, `npm org ls @codex-provider --json` returns `E404 Scope not found`, and `npm view @codex-provider/core --json` returns `E404 Not found`.

## Search Release Exception Request

- Status: not needed for the current audit.
- Request: allow built-in no-key metasearch evidence to serve as the `0.1.0-alpha.1` search baseline when supported API-backed credentials are unavailable.
- Current decision: a release exception is not required because `SERPAPI_API_KEY` is configured and a passing SerpApi API-backed web_search smoke is recorded.

## Recently Resolved

- Third provider live evidence is now recorded. DeepSeek official with `deepseek-chat` passed the full host smoke on `2026-06-30T16:29:29.940Z`, covering normal response, forced custom tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- API-backed web_search evidence is now recorded. DeepSeek official with `deepseek-chat` plus SerpApi passed `pnpm smoke:web-search` on `2026-06-30T17:06:48.247Z`, covering offline local-index, non-streaming adapter-emulated `web_search`, and streaming adapter-emulated `web_search`.

## Readiness Audit

| Area | Current status | Public-alpha action |
| --- | --- | --- |
| `README.md` | Explains package goal, non-affiliation with OpenAI, profile modes, hosted tool boundaries, current three-provider evidence, and key docs. | Keep provider evidence summary aligned with the matrix. |
| `CHANGELOG.md` | Has `0.1.0-alpha.0` with added/changed/validation notes and unreleased live-evidence updates. | Add a `0.1.0-alpha.1` section before any public alpha publish. |
| `docs/RELEASE_READINESS.md` | Records manual release posture, pre-publish gate, and latest dry-run snapshot. | Refresh after every release-affecting doc/code change. |
| `docs/INDEPENDENT_PACKAGE_CHECKLIST.md` | Package boundary and release checklist is largely complete while `private: true` remains. | Keep private until scope ownership, provider evidence, and search evidence gaps are reviewed. |
| Package surface | `pnpm check-package-surface` scans docs/examples/package metadata and dry-run tarball contents. | Must pass before any publish decision. |

## Current Live Evidence

As of 2026-06-30:

- Passed: OpenRouter with `deepseek/deepseek-chat` for normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- Passed: DeepSeek official with `deepseek-chat` for normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- Passed: DashScope/Qwen with `qwen-plus` for normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- Passed: API-backed SerpApi web_search with DeepSeek official `deepseek-chat`.
- Pending credentials: SiliconFlow, MiniMax, Moonshot/Kimi, OpenAI direct Responses, and additional API-backed Brave/Serper/Tavily search records.
- npm registry visibility check: `@codex-provider/core` is not published publicly, and the local environment cannot prove `@codex-provider` scope ownership without npm authentication.

## `private:true` Exit Criteria

Do not set `private:false` until all items below are complete:

- npm account ownership for the `@codex-provider` scope is confirmed.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm consumer:harness`, `pnpm check-boundary`, `pnpm check-package-surface`, and `pnpm pack:dry-run` pass on the release commit.
- At least two OpenAI-compatible provider paths have current live smoke evidence for normal response, forced custom tool, `file_search`, non-streaming `web_search`, and streaming `web_search`. Current evidence satisfies this for OpenRouter, DeepSeek official, and DashScope/Qwen.
- API-backed web search evidence is recorded for Brave, SerpApi, Serper, or Tavily, or the release owner explicitly approves the search release exception request above.
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

1. Confirm the npm organization or user owns the `@codex-provider` scope. Current unauthenticated registry check returns `E404 Scope not found`; this is not proof of ownership.
2. Confirm package name availability for `@codex-provider/core`. Current unauthenticated registry check returns `E404 Not found`; this only proves the package is not publicly visible.
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
pnpm public-alpha:audit
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
