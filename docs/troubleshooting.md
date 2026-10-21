# Troubleshooting

## The plugin does not seem to be loaded

Plugins are loaded when an OpenCode location boots; a location that was already running keeps the
plugin set it started with. Reload the location and check for `[question-gate]` lines on the
server's stderr. With `debug: true` the setup logs `tool description: question=extended` once the
registry is built.

## The `question` tool description does not carry the rules

- `describe_tool` is `false` in the options.
- The tool is not registered for that agent (`question=absent` in the debug log).
- The description already contains "Rules for this tool:" (`already-carries-it`): that is the
  steady state after the transform has replayed, not an error.

## A legitimate question was rejected

| message | cause | fix |
|---|---|---|
| `This turn already has 1 question call, the maximum.` | a second call in the same turn, or a parallel call in the same step | raise `max_calls_per_turn`, or `0` to remove the limit |
| `The user dismissed this question already.` | same normalised header or question text as a dismissed one in the session | set `match_header: false` if a generic header caused it |
| `The user dismissed a question this turn.` | a dismissal earlier in the turn | `stop_after_dismissal: false` |
| `The user asked a question back.` | an earlier answer in the turn was free text with `?` | `stop_on_question_back: false` |
| `The user's rule: never ask about parallelism` | header, question or an option label matches `parallelism_pattern` | narrow the pattern or `block_parallelism: false` |

## A dismissed question came back

- The server restarted: dismissal memory is in memory only.
- More than `dismissal_window_ms` passed, or the session's list exceeded `max_dismissed_per_session`.
- The model changed both the header and the question text. Repeats are matched by exact normalised
  text, not by meaning.
- The dismissal error did not match `dismissed_pattern`. The log line `the user dismissed …`
  confirms it was recorded.

## A bare question reached the user

The gate never rejects a call for a missing premise. It injects one from the reasoning tail; the log
says `with a N-char premise` on success, or `without a premise (… premise unavailable|unusable input
shape)` when the reasoning had nothing usable or the input did not have the expected `questions[]`
shape.

## Tool error "Attempted to assign to readonly property"

The hook event's `input` is frozen; the plugin replaces it with a new object rather than mutating it.
Seeing this error means a modified copy of `withPremise` or the hook mutates the input in place.

## Reading the logs

All lines are prefixed `[question-gate]`:

| line | meaning |
|---|---|
| `rejected <tool> in <session>/<message>: <reason>` | a rule rejected the call |
| `the user asked a question back in …` | further questions this turn are rejected |
| `the user dismissed <tool> in …; remembered for the session` | the question is recorded as dismissed |
| `let <tool> through … with a N-char premise from the reasoning` | passed with a recovered premise |
| `let <tool> through … without a premise (…)` | passed unchanged with too little visible text |
| `internal failure, letting <tool> through: …` | an exception inside the gate; the call was allowed |
| `context lookup failed for <session>: …` | `ctx.session.context` threw; per-turn rules were skipped |
