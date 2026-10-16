# opencode-question-gate

[![run-tests](https://github.com/rojosinalma/opencode-question-gate/actions/workflows/run-tests.yml/badge.svg)](https://github.com/rojosinalma/opencode-question-gate/actions/workflows/run-tests.yml)
[![release](https://img.shields.io/github/v/release/rojosinalma/opencode-question-gate)](https://github.com/rojosinalma/opencode-question-gate/releases)
[![license](https://img.shields.io/github/license/rojosinalma/opencode-question-gate)](LICENSE)

An [OpenCode](https://opencode.ai) plugin that guarantees the `question` tool is never shown to the
user without a visible premise. Thinking models tend to draft the explanation inside a reasoning
block — which the user never reads — and then pop a bare question. The gate works in three layers,
never loops, and never blocks a question terminally:

1. **prevention** — the requirement is appended to the `question` tool's own description, so the model reads it while deciding to call.
2. **nudge** — a call with under `min_chars` of visible reply text in the turn is rejected at most once per turn, so the model writes the paragraph and retries.
3. **guarantee** — if it still arrives bare, the call goes through with a premise recovered from the reasoning tail injected into the form.

Configuration, design and troubleshooting are documented in `docs/`.

## Requirements

- [OpenCode](https://opencode.ai) ≥ 2.0
- [Bun](https://bun.sh) ≥ 1.4 (the runtime OpenCode loads plugins with)
- The `question` tool present in the agent's toolset (the gate applies to the tools listed in its `tools` option; a missing tool is logged and skipped)

No runtime dependencies: `@opencode/plugin` is imported as types only.

## Installation

Clone into the global plugins directory; it is auto-discovered and runs on its defaults:

```sh
git clone https://github.com/rojosinalma/opencode-question-gate ~/.config/opencode/plugins/question-gate
```

Reference the same path from `opencode.jsonc` only to change options (see `docs/configuration.md`):

```jsonc
{
  "plugins": [
    { "package": "./plugins/question-gate", "options": { "min_chars": 40, "max_rejections_per_turn": 1 } }
  ]
}
```

Plugins are loaded when a location boots; restart the OpenCode server for an already-running location to pick it up.

## Usage

Nothing to operate: once loaded, every `question` call made by a model without a visible paragraph
before it is nudged once, and a call that still arrives bare goes through with the premise recovered
from the model's reasoning shown in the form. Decisions are logged as `[question-gate] nudged|let …
through` on the server's stderr; set `"debug": true` in the options to see every evaluation. The one
option worth tuning is `min_chars` — the number of visible reply characters that counts as a premise
(default `40`); `max_rejections_per_turn: 0` turns the nudge layer off and keeps layers 1 and 3.

## Development

```sh
bun install --frozen-lockfile
bun test
```

The tests cover the pure helpers and need no OpenCode server. See [CONTRIBUTING.md](CONTRIBUTING.md)
for layout, style and the release procedure.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Copyright (C) 2026 rojosinalma.
