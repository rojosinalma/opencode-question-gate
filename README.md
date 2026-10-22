# opencode-question-gate

[![run-tests](https://github.com/rojosinalma/opencode-question-gate/actions/workflows/run-tests.yml/badge.svg)](https://github.com/rojosinalma/opencode-question-gate/actions/workflows/run-tests.yml)
[![release](https://img.shields.io/github/v/release/rojosinalma/opencode-question-gate)](https://github.com/rojosinalma/opencode-question-gate/releases)
[![license](https://img.shields.io/github/license/rojosinalma/opencode-question-gate)](LICENSE)

An [OpenCode](https://opencode.ai) plugin that keeps the `question` tool from turning into a nag.
It enforces five rules on every `question` call, and never loops an agent on a rejection:

1. **question back** — when the user answers with a question of their own, nothing else is asked that turn.
2. **dismissals** — a dismissed question is never asked again in the session unless the user brings it up (their next message names its header or question), and nothing else is asked in the turn it was dismissed in.
3. **one per turn** — at most `max_calls_per_turn` (default 1) question calls per turn.
4. **parallelism** — questions about parallel work or subagents are rejected; the answer is always "parallelize".
5. **premise** — never a rejection: a call with no visible paragraph in front of it goes through with a premise recovered from the model's reasoning.

The same rules are appended to the `question` tool's description, so the model reads them before it
calls. Configuration, design and troubleshooting are documented in `docs/`.

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
    { "package": "./plugins/question-gate", "options": { "max_calls_per_turn": 1 } }
  ]
}
```

Plugins are loaded when a location boots; restart the OpenCode server for an already-running location to pick it up.

## Usage

Nothing to operate. A rejected call returns a tool error that starts with `[question-gate]` and
tells the model what to do instead (answer in plain text, continue without asking, or ask next
turn). Every decision is logged as one `[question-gate] …` line on the server's stderr; set
`"debug": true` to see the calls that pass as well. The option most worth tuning is
`max_calls_per_turn` (default `1`, `0` removes the limit).

## Development

```sh
bun install --frozen-lockfile
bun test
```

The tests cover the pure helpers and the hook flow against a fake plugin context; they need no OpenCode server. See [CONTRIBUTING.md](CONTRIBUTING.md)
for layout, style and the release procedure.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Copyright (C) 2026 rojosinalma.
