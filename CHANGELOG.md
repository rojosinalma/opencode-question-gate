# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `docs/configuration.md`, `docs/SDD.md`, `docs/troubleshooting.md`, `CONTRIBUTING.md`.
- `run-tests.yml` workflow running `bun test` on push and pull request.

## [0.1.0]

### Added
- Three-layer gate for the `question` tool: requirement appended to the tool description, one
  nudge per turn, premise recovered from the reasoning tail and injected into the form.
- Options `tools`, `min_chars`, `max_rejections_per_turn`, `turn_window_ms`, `premise_max_chars`,
  `premise_min_chars`, `inject_premise`, `describe_tool`, `context_retries`, `context_retry_ms`,
  `debug`.
- `bun test` suite for the pure helpers.
