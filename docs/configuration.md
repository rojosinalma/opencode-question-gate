# Configuration

All options are passed through the `options` object of the plugin's `plugins[]` entry in
`opencode.jsonc`. Every key is optional; the defaults below are what the plugin runs with when
it is only auto-discovered from the plugins directory.

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/question-gate",
      "options": {
        "tools": ["question"],
        "min_chars": 40,
        "max_rejections_per_turn": 1,
        "turn_window_ms": 1800000,
        "premise_max_chars": 700,
        "premise_min_chars": 80,
        "inject_premise": true,
        "describe_tool": true,
        "context_retries": 4,
        "context_retry_ms": 500,
        "debug": false
      }
    }
  ]
}
```

| key | default | meaning |
|---|---|---|
| `tools` | `["question"]` | tool names the gate applies to |
| `min_chars` | `40` | visible reply characters required in the turn before the call |
| `max_rejections_per_turn` | `1` | nudges per turn; `0` disables the nudge layer entirely |
| `turn_window_ms` | `1800000` | how long a turn's rejection count is remembered (30 min) |
| `premise_max_chars` | `700` | cap on the premise injected into the form |
| `premise_min_chars` | `80` | minimum reasoning text to count as a premise |
| `inject_premise` | `true` | layer 3 (premise injection) on/off |
| `describe_tool` | `true` | layer 1 (tool description) on/off |
| `context_retries` | `4` | re-reads of the session context while the text part streams in |
| `context_retry_ms` | `500` | delay between those re-reads, in milliseconds |
| `debug` | `false` | verbose logging (`[question-gate] …` lines on stderr) |

## Tuning notes

- `min_chars` is the length of the trimmed visible text in the whole turn (every assistant step
  since the last user message), not just the current step. Raise it if a model gets by with a
  one-liner; lower it if short confirmations are legitimately being nudged.
- `max_rejections_per_turn: 0` turns the plugin into description + injection only: no call is ever
  rejected, bare calls get the recovered premise straight away.
- `context_retries` × `context_retry_ms` bounds how long a first-step question may wait for its
  text part to be persisted (2 s by default). Increase both on a slow database; decrease them if
  the pause before a question is noticeable.
- `inject_premise: false` keeps layers 1 and 2 and lets a bare call through untouched after the
  nudge budget is spent.
- Options are read once at plugin setup; changing them takes effect for locations that boot
  afterwards.
