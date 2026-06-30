# Public Alpha Release Plan

`codex-provider` is the public alpha package name. This plan records the manual publish path without adding automatic npm release workflows.

## Current Decision

- Set `private: false`.
- Keep version `0.1.0-alpha.0`.
- Keep package exports limited to `.` and `./package.json`.
- Keep publishing manual. Do not add npm auto-publish workflows.
- Use the unscoped npm package name `codex-provider`; no npm organization is required.
- Treat current OpenRouter, DeepSeek official, DashScope/Qwen, and SerpApi live evidence as sufficient for the first manual public alpha gate.
- Current conclusion on 2026-06-30: public alpha `codex-provider@0.1.0-alpha.0` is published.

## Current Blockers

- None for the first public alpha publish. `npm whoami` passed as `ganxing`; `npm publish --tag alpha` completed after npm browser 2FA authorization.

## Published Artifact

- Package: `codex-provider@0.1.0-alpha.0`
- npm dist-tags: `alpha` and `latest` both resolve to `0.1.0-alpha.0` because this is the first published version.
- Tarball: `https://registry.npmjs.org/codex-provider/-/codex-provider-0.1.0-alpha.0.tgz`
- Source tag: `v0.1.0-alpha.0` at commit `6514cf0`.

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
| `CHANGELOG.md` | Has `0.1.0-alpha.0` with added/changed/validation notes and unreleased live-evidence updates. | Keep aligned with the first public alpha publish. |
| `docs/RELEASE_READINESS.md` | Records manual release posture, pre-publish gate, and latest dry-run snapshot. | Refresh after every release-affecting doc/code change. |
| `docs/INDEPENDENT_PACKAGE_CHECKLIST.md` | Package boundary and release checklist is complete for the unscoped public alpha path. | Keep aligned with package metadata and tarball checks. |
| Package surface | `pnpm check-package-surface` scans docs/examples/package metadata and dry-run tarball contents. | Must pass before any publish decision. |

## Current Live Evidence

As of 2026-06-30:

- Passed: OpenRouter with `deepseek/deepseek-chat` for normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- Passed: DeepSeek official with `deepseek-chat` for normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- Passed: DashScope/Qwen with `qwen-plus` for normal response, forced custom-tool continuation, adapter-emulated `file_search`, non-streaming `web_search`, and streaming `web_search`.
- Passed: API-backed SerpApi web_search with DeepSeek official `deepseek-chat`.
- Pending credentials: SiliconFlow, MiniMax, Moonshot/Kimi, OpenAI direct Responses, and additional API-backed Brave/Serper/Tavily search records.
- npm registry visibility check: `npm view codex-provider version dist-tags --json` returns `0.1.0-alpha.0` with the `alpha` dist-tag.

## `private:false` Exit Criteria

Keep `private:false` only while all items below remain true:

- The package uses the unscoped npm name `codex-provider`, so no organization scope confirmation is required.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm consumer:harness`, `pnpm check-boundary`, `pnpm check-package-surface`, and `pnpm pack:dry-run` pass on the release commit.
- At least two OpenAI-compatible provider paths have current live smoke evidence for normal response, forced custom tool, `file_search`, non-streaming `web_search`, and streaming `web_search`. Current evidence satisfies this for OpenRouter, DeepSeek official, and DashScope/Qwen.
- API-backed web search evidence is recorded for Brave, SerpApi, Serper, or Tavily, or the release owner explicitly approves the search release exception request above.
- `docs/PROVIDER_COMPATIBILITY_MATRIX.md` has current evidence status for OpenRouter, DeepSeek official, DashScope/Qwen, SiliconFlow, MiniMax, Moonshot/Kimi, and OpenAI direct Responses.
- `docs/OBSERVABILITY_AND_ERROR_POLICY.md` documents trace redaction, request validation, security violations, recoverable provider failures, fatal hosted tool failures, and loop-exceeded behavior.
- The release owner has reviewed the packed file list for secrets, host-app imports, private paths, generated caches, and binary artifacts.

## Alpha Version Policy

- `0.1.0-alpha.0` is the first published public alpha.
- `0.1.0-alpha.1` should be prepared only for a follow-up alpha.
- Do not skip from `0.1.0-alpha.0` to a stable version while provider behavior records are incomplete.
- Any breaking root API change before public alpha should remain within the `0.1.0-alpha.x` line and be called out in `CHANGELOG.md`.

## npm Package Name Confirmation

For the first publish:

1. Confirm `npm whoami` returns `ganxing`.
2. Confirm `npm view codex-provider --json` returns `E404 Not found` immediately before first publish.
3. Confirm two-factor requirements for the publishing account.
4. Confirm who can publish and who can deprecate an accidental release.
5. Record the decision in `docs/RELEASE_READINESS.md`.

## Manual Publish Steps

These steps were used for the manual first public alpha publish.

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

Then, after release approval and browser 2FA authorization:

```bash
npm publish --tag alpha
```

## No Auto-Publish Policy

CI may run validation and package hygiene checks, but npm publishing stays manual. No automatic npm publish workflow is added.
