# Troubleshooting

## The plugin does not seem to be loaded

Plugins are loaded when an OpenCode location boots; a location that was already running keeps the
plugin set it started with. Restart the OpenCode server (or open the project in a fresh server) and
check for `[question-gate]` lines on its stderr. With `debug: true` the setup logs
`tool description: question=extended` once the registry is built.

## The `question` tool description does not carry the requirement

- `describe_tool` is `false` in the options.
- The tool is not registered for that agent (`question=absent` in the debug log). The gate only
  edits tools that exist in the registry at transform time.
- The description already contains "REQUIRED before calling this tool" (`already-carries-it`):
  that is the steady state after the transform has replayed, not an error.

## Legitimate questions are being nudged

- The visible text in the turn is shorter than `min_chars` (40 by default). Lower it, or accept
  that the model will add a sentence.
- The text part had not been persisted when the hook fired. The gate re-reads the context
  `context_retries` times with `context_retry_ms` between attempts; raise them on a slow database.
- Check the logged step parts: `step parts: reasoning,tool` means the premise really is only in a
  reasoning block.

## A bare question still reached the user

The gate never rejects more than `max_rejections_per_turn` times per turn, so a model that ignores
the nudge gets through on the next call. Layer 3 then injects a premise from the reasoning tail;
the log says `injected a N-char premise` on success or `no premise injected (… premise
unavailable|unusable input shape)` when the reasoning had nothing usable or the input did not have
the expected `questions[]` shape.

## A question was asked twice

The nudge rejects the first call with an error the model is told to treat as a retry with the same
arguments. If the model instead rephrases, the user may see two forms. Setting
`max_rejections_per_turn: 0` keeps only the description and injection layers and removes rejections
entirely.

## Tool error "Attempted to assign to readonly property"

The hook event's `input` is frozen; the plugin replaces it with a new object rather than mutating it.
Seeing this error means a modified copy of `withPremise` or the hook mutates the input in place.

## Reading the logs

All lines are prefixed `[question-gate]`:

| line | meaning |
|---|---|
| `nudged <tool> in <session>/<message>: N chars < M (step parts: …, nudge i/n)` | layer 2 rejected the call once |
| `let <tool> through … and injected a N-char premise from the reasoning` | layer 3 passed the call with a recovered premise |
| `let <tool> through … with no premise injected (…)` | layer 3 passed the call unchanged |
| `internal failure, letting <tool> through: …` | an exception inside the gate; the call was allowed |
| `context lookup failed for <session>, letting <tool> through` | `ctx.session.context` threw; the call was allowed |
