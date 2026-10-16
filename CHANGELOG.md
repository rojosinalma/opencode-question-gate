# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added
- `docs/configuration.md`, `docs/SDD.md`, `docs/troubleshooting.md`, `CONTRIBUTING.md`.
- `run-tests.yml` workflow running `bun test` on push and pull request.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull-request templates, Dependabot.
- `bun.lock` is tracked; CI installs with `--frozen-lockfile`.

### Changed
- Licence to AGPL-3.0.
- README restructured: requirements with versions, installation, usage, development.

## [0.1.0] - 2026-10-15

### Added
- Three-layer gate for the `question` tool: requirement appended to the tool description, one
  nudge per turn, premise recovered from the reasoning tail and injected into the form.
- Options `tools`, `min_chars`, `max_rejections_per_turn`, `turn_window_ms`, `premise_max_chars`,
  `premise_min_chars`, `inject_premise`, `describe_tool`, `context_retries`, `context_retry_ms`,
  `debug`.
- `bun test` suite for the pure helpers.

[Unreleased]: https://github.com/rojosinalma/opencode-question-gate/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/rojosinalma/opencode-question-gate/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rojosinalma/opencode-question-gate/releases/tag/v0.1.0
