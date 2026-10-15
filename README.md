# opencode-question-gate

An [OpenCode](https://opencode.ai) plugin that guarantees the `question` tool is never shown to the
user without a visible premise. Thinking models tend to draft the explanation inside a reasoning
block — which the user never reads — and then pop a bare question. The gate works in three layers,
never loops, and never blocks a question terminally:

1. **prevention** — the requirement is appended to the `question` tool's own description, so the model reads it while deciding to call.
2. **nudge** — a call with under `min_chars` of visible reply text in the turn is rejected at most once per turn, so the model writes the paragraph and retries.
3. **guarantee** — if it still arrives bare, the call goes through with a premise recovered from the reasoning tail injected into the form.

## Install

Clone into the global plugins directory; it is auto-discovered and runs on its defaults:

```sh
git clone https://github.com/rojosinalma/opencode-question-gate ~/.config/opencode/plugins/question-gate
```

Reference the same path from `opencode.jsonc` only to change options:

```jsonc
{
  "plugins": [
    { "package": "./plugins/question-gate", "options": { "min_chars": 40, "max_rejections_per_turn": 1 } }
  ]
}
```

No runtime dependencies (`@opencode/plugin` is imported as types only).

## Options

| key | default | meaning |
|---|---|---|
| `tools` | `["question"]` | tool names the gate applies to |
| `min_chars` | `40` | visible reply characters required in the turn |
| `max_rejections_per_turn` | `1` | nudges per turn; `0` disables the nudge layer |
| `turn_window_ms` | `1800000` | how long a turn's rejection count is remembered |
| `premise_max_chars` | `700` | cap on the injected premise |
| `premise_min_chars` | `80` | minimum reasoning text to count as a premise |
| `inject_premise` | `true` | layer 3 on/off |
| `describe_tool` | `true` | layer 1 on/off |
| `context_retries` | `4` | re-reads of the session context while the text part streams in |
| `context_retry_ms` | `500` | delay between those re-reads |
| `debug` | `false` | verbose logging |

## How it works

1. `tool.transform` appends the requirement to the tool description.
2. `tool.hook("execute.before")` reads `ctx.session.context`, counts visible text in the current turn (reasoning never counts), and either rejects once or injects a premise by *replacing* the frozen input object.
3. Log lines: `[question-gate] nudged|let … through` with the step's part types.

## Tests

```sh
bun test
```

## Caveats

- Loaded per location boot; running locations keep the plugin set they started with.
