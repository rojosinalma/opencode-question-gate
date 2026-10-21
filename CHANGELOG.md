# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-22

### Added
- Question back: after a free-text answer that contains `?`, every further question in the turn is rejected.
- Dismissal memory: a dismissed question (same header or question text, normalised) is rejected for
  the rest of the session, and no other question is sent in the turn it was dismissed in.
- At most `max_calls_per_turn` question calls per turn (default 1), open calls included.
- Questions about parallelism or subagents are rejected.
- `execute.after` hook that reads answers (`metadata.answers`) and dismissals.
- Hook-flow tests against a fake plugin context.
- Options `max_calls_per_turn`, `stop_on_question_back`, `remember_dismissed`,
  `stop_after_dismissal`, `match_header`, `dismissed_pattern`, `block_parallelism`,
  `parallelism_pattern`, `dismissal_window_ms`, `max_turns`, `max_sessions`,
  `max_dismissed_per_session`.

### Changed
- The tool description now carries the five rules instead of the premise requirement only.
- A call without a visible premise is never rejected; it goes through with a premise recovered
  from the reasoning (the former layer 3) straight away.

### Removed
- The nudge layer and `max_rejections_per_turn`.

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

[Unreleased]: https://github.com/rojosinalma/opencode-question-gate/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rojosinalma/opencode-question-gate/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/rojosinalma/opencode-question-gate/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rojosinalma/opencode-question-gate/releases/tag/v0.1.0
