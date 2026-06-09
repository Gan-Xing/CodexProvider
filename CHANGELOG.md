# Changelog

## 0.1.0-alpha.0

### Added

- Extracted CodexProvider into a standalone private package repository.
- Added root-entrypoint runtime, profile, converter, hosted-tool, web_search, file_search, image generation, code interpreter, computer, and tool_search surfaces.
- Added standalone consumer, web_search live smoke, and host integration smoke harnesses that validate root package consumption without host-app internals.

### Changed

- Kept `private: true` while provider live smoke evidence remains incomplete.
- Kept root `exports` limited to `.` and `./package.json`; no subpath exports are published.
- Removed historical Relay/Gateway compatibility aliases from the active package surface.

### Validation

- Package tarball dry-run is documented in `docs/RELEASE_READINESS.md`.
- Release workflow is manual until provider live smoke evidence is recorded.
