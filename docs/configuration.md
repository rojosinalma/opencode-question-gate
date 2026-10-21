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
        "max_calls_per_turn": 1,
        "stop_on_question_back": true,
        "remember_dismissed": true,
        "stop_after_dismissal": true,
        "match_header": true,
        "dismissed_pattern": "dismissed",
        "block_parallelism": true,
        "parallelism_pattern": "\\b(parallel\\w*|sub-?agents?)\\b",
        "min_chars": 40,
        "inject_premise": true,
        "premise_max_chars": 700,
        "premise_min_chars": 80,
        "describe_tool": true,
        "context_retries": 4,
        "context_retry_ms": 500,
        "turn_window_ms": 1800000,
        "dismissal_window_ms": 86400000,
        "max_turns": 500,
        "max_sessions": 200,
        "max_dismissed_per_session": 50,
        "debug": false
      }
    }
  ]
}
```

| key | default | meaning |
|---|---|---|
| `tools` | `["question"]` | tool names the gate applies to |
| `max_calls_per_turn` | `1` | question calls allowed per turn, open ones included; `0` removes the limit |
| `stop_on_question_back` | `true` | reject every question after the user answered with a question |
| `remember_dismissed` | `true` | reject a question that repeats a dismissed one in the same session |
| `stop_after_dismissal` | `true` | reject every question after a dismissal in the same turn |
| `match_header` | `true` | a repeated header alone counts as a repeat (otherwise only the question text) |
| `dismissed_pattern` | `"dismissed"` | case-insensitive regex the tool error must match to count as a dismissal |
| `block_parallelism` | `true` | reject questions about parallel work or subagents |
| `parallelism_pattern` | see above | case-insensitive regex checked against header, question and option labels |
| `min_chars` | `40` | visible reply characters in the turn below which a premise is injected; `0` disables injection |
| `inject_premise` | `true` | premise injection on/off |
| `premise_max_chars` | `700` | cap on the injected premise |
| `premise_min_chars` | `80` | reasoning text collected before the premise stops growing |
| `describe_tool` | `true` | append the rules to the tool description |
| `context_retries` | `4` | re-reads of the session context while the text part streams in |
| `context_retry_ms` | `500` | delay between those re-reads, in milliseconds |
| `turn_window_ms` | `1800000` | how long per-turn state is kept (30 min) |
| `dismissal_window_ms` | `86400000` | how long a session's dismissed questions are remembered (24 h) |
| `max_turns` | `500` | turns tracked at once; the oldest is dropped first |
| `max_sessions` | `200` | sessions with dismissal memory at once; the oldest is dropped first |
| `max_dismissed_per_session` | `50` | dismissed headers and question texts kept per session |
| `debug` | `false` | also log calls that pass and the tool-description outcome |

An invalid regex or a negative number falls back to the default.

## Tuning notes

- A turn is everything between two user messages. `max_calls_per_turn: 1` means a dependent
  question waits until the user has answered the first and sent the next message.
- An answer counts as a question back when it is not one of the offered option labels and contains
  `?`. Option labels with a `?` in them never trigger it.
- Dismissed questions are compared after normalisation: lowercase, accents and punctuation
  removed, `(Recommended)` dropped, whitespace collapsed. Headers and questions shorter than three
  characters are ignored. Set `match_header: false` when generic headers ("Next step") cause false
  repeats.
- A rejected parallelism question does not use up the turn's call.
- `context_retries` × `context_retry_ms` bounds how long a question may wait for its text part to
  be persisted before a premise is injected (2 s by default). The wait only happens when the
  visible text is below `min_chars`.
- Options are read once at plugin setup; changing them takes effect for locations that boot
  afterwards.
