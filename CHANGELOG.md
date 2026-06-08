# Changelog

## 0.1.0-alpha.0

- Extracted CodexProvider into a standalone private package repository.
- Kept `private: true` while live smoke and external consumer validation remain open.
- Kept deprecated `CodexProvider*` and `CodexProvider*` aliases for the stabilization cycle.
- Added a standalone consumer harness that validates root entrypoint usage without CodexBridge internals.
