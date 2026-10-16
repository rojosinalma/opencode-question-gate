# opencode-question-gate

An [OpenCode](https://opencode.ai) plugin that guarantees the `question` tool is never shown to the
user without a visible premise. Thinking models tend to draft the explanation inside a reasoning
block — which the user never reads — and then pop a bare question. The gate works in three layers,
never loops, and never blocks a question terminally:

1. **prevention** — the requirement is appended to the `question` tool's own description, so the model reads it while deciding to call.
2. **nudge** — a call with under `min_chars` of visible reply text in the turn is rejected at most once per turn, so the model writes the paragraph and retries.
3. **guarantee** — if it still arrives bare, the call goes through with a premise recovered from the reasoning tail injected into the form.

Configuration, design and troubleshooting are documented in `docs/`.

## Requirements

- OpenCode 2.x running on Bun.
- The `question` tool present in the agent's toolset (the gate applies to the tools listed in its `tools` option; a missing tool is logged and skipped).

No runtime dependencies: `@opencode/plugin` is imported as types only.

## Setup

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

## License

MIT — see [LICENSE](LICENSE).
