# Software design document

## Purpose

OpenCode's `question` tool shows the user a form in the middle of a turn. Used badly, it turns
into a nag: a second question before the first is settled, the same question again after the user
dismissed it, a new form after the user answered with a question of their own, questions whose
answer is always the same, and bare forms whose explanation sits in a reasoning block the user
never reads. This plugin enforces rules against each of those, and never loops an agent on
rejections.

## Architecture

The whole plugin is one file, `index.ts`. It exports a `Plugin.Plugin` with `id: "question-gate"`
whose `setup(ctx)` calls `setupGate(ctx)`, which registers:

| Hook | What it does |
|---|---|
| `ctx.tool.transform(editor)` | Appends `TOOL_RULES` to the description of every tool named in `tools`. The callback is replayed on every tool-registry rebuild, so it logs from inside and treats an already-extended description (`RULES_MARKER`) as the steady state. |
| `ctx.tool.hook("execute.before")` | Decides whether a gated call is rejected (throws) or let through, possibly with a premise injected into a new input object. |
| `ctx.tool.hook("execute.after")` | Records what the user did with an admitted call: answered (`completed`, `result.metadata.answers`) or dismissed (`error`, message matching `dismissed_pattern`). |

`setupGate` takes the clock and the logger as parameters so the tests drive the hooks with a fake
context. The pure helpers are exported for the same reason.

## Result shapes

Read from stored sessions of the `question` tool:

- answered: `status: "completed"`, `result.metadata.answers: string[][]` (one list per question,
  in order; free text appears as its own string), `result.content` a text summary.
- dismissed: `status: "error"`, `error.message: "The user dismissed this question"`
  (`error.type: "aborted"` in storage).
- interrupted: `error.message: "Tool execution interrupted"`, which does not count as a dismissal.

## Data model / storage

No persistent storage. In-memory state, all in `Bounded` maps (insertion-ordered, size cap,
time window; an expired entry reads as absent, the oldest entry is dropped at the cap):

| map | key | value | cap / window |
|---|---|---|---|
| turns | `<sessionID>:<id of the user message that opened the turn>` | `{ completed, inFlight, questionBack, dismissed }` | `max_turns` / `turn_window_ms` |
| dismissed | `sessionID` | `{ headers[], questions[] }` normalised, newest last | `max_sessions` / `dismissal_window_ms`; lists capped at `max_dismissed_per_session` |
| callTurn | tool call id | turn key the call was admitted in | `4 × max_turns` / `turn_window_ms` |
| rejected | tool call id | `true` for calls the gate rejected | `4 × max_turns` / `turn_window_ms` |

## Key flows

### execute.before

For a call to a gated tool, in order (the first match rejects):

1. **parallelism** — header, question or an option label matches `parallelism_pattern`.
2. **dismissed repeat** — a normalised header (when `match_header`) or question text equals one
   recorded for the session. A premise this gate injected is stripped before comparing.
3. Read `ctx.session.context({sessionID})` and derive the turn key. No context or no user message:
   the per-turn rules are skipped and the call passes.
4. **question back** — the turn already saw a question back.
5. **dismissed this turn** — the turn already saw a dismissal.
6. **call limit** — answered plus open calls in the turn reach `max_calls_per_turn`.
7. The call is admitted: marked open in the turn. If the visible text in the turn is below
   `min_chars` (re-read up to `context_retries` times, since the text part streams in parallel),
   a premise is recovered from the turn's reasoning (`premiseFromReasoning`) and `withPremise`
   returns a **new** input with it in front of the first question. The event's `input` is frozen,
   so it is replaced, never mutated.

A rejection throws `Error("[question-gate] <message>")`; the call id goes into `rejected`.

### execute.after

1. A call in `rejected` is skipped: its error is the gate's own, not a user action.
2. The call leaves the turn's open set. `completed` increments the turn's count; a free-text answer
   with `?` (an answer that is not an option label of its question) sets `questionBack`.
3. An `error` that matches `dismissed_pattern` and does not start with `[question-gate]` sets the
   turn's `dismissed` flag and adds the call's normalised headers and questions to the session's
   dismissal list.

## Configuration surface

See `docs/configuration.md`. Options arrive as `ctx.options` and are normalised once by
`resolveOptions()`; invalid numbers and regexes fall back to the defaults.

## Decisions and rationale

- **Rejection messages tell the model what to do instead.** Each one names the rule and the
  alternative (plain reply, continue, next turn), so the model does not rephrase and retry.
- **Never reject for a missing premise.** v0.1 rejected a bare call once per turn. Models retried
  in loops or lost the turn to a provider error after the rejection. A recovered premise reaches the
  user without a retry.
- **Open calls count toward the limit.** Several question calls in one step run in parallel; the
  second must be rejected before the first is answered.
- **A rejected parallelism question does not count toward the limit.** It never reached the user.
- **Dismissals match header or question.** A model that rewords the question usually keeps the
  header, and vice versa. `match_header: false` narrows it when headers are generic.
- **Question back means free text with `?`.** Option labels are the model's text, not the user's,
  so a label with `?` never counts.
- **Turn key from the opening user message.** Per-turn state resets on the next prompt. When the
  current step is not persisted yet, the latest user message in the context opens the turn.
- **Bounded state.** Every map has a size cap and a time window, so a long-running server does not
  grow without limit.
- **Fail open.** Any internal exception, failed context lookup or unexpected shape lets the call
  through and logs it.
- **Type-only import of `@opencode/plugin`.** The plugin directory may have no `node_modules` of its
  own when installed by cloning, so nothing from the package may be needed at runtime.

## Current scope and non-goals

Dismissal memory lives in the server process: a server restart forgets it. Repeats are detected by
exact normalised text, not by meaning. A question back is detected by `?` only. The gate does not
alter the form after the user answers.

## Operations

- **Logs.** Every decision writes one `[question-gate] …` line to stderr (the OpenCode server log):
  `rejected <tool> in <session>/<message>: <reason>`, `the user asked a question back in …`,
  `the user dismissed <tool> in …; remembered for the session`, `let <tool> through … with a
  N-char premise …`, `let <tool> through … without a premise (…)`, `internal failure, …`,
  `context lookup failed for <session>: …`. `debug: true` adds the passing calls and the
  tool-description outcome (`question=extended|already-carries-it|absent`).
- **Health.** No endpoint. A tool description containing "Rules for this tool:" shows the
  transform is active.
- **Upgrade.** `git pull` in the plugin directory, then reload the location: plugins are loaded per
  location boot. Run `bun test` before deploying a change.
