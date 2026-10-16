# Software design document

## Purpose

OpenCode's `question` tool shows the user a form in the middle of a turn. A question only makes
sense when the user has already read why it is being asked and what each answer leads to. Thinking
models frequently write that explanation inside their reasoning block — which the user never
sees — and then call the tool with nothing visible in front of it. This plugin guarantees that a
gated tool call is always preceded (or, as a last resort, accompanied) by a visible premise,
without ever looping an agent on rejections or blocking a question for good.

## Architecture

The whole plugin is one file, `index.ts`. It exports a `Plugin.Plugin` with `id: "question-gate"`
whose `setup(ctx)` registers two OpenCode hooks:

| Hook | Layer | What it does |
|---|---|---|
| `ctx.tool.transform(editor)` | 1 — prevention | Appends `TOOL_REQUIREMENT` to the description of every tool named in `tools`. The callback is replayed on every tool-registry rebuild, so it logs its outcome from inside and treats an already-extended description as the steady state. |
| `ctx.tool.hook("execute.before")` | 2 — nudge, 3 — guarantee | For a gated tool, reads the session context, counts visible text in the turn and either rejects once (throws), lets the call through, or lets it through with a premise injected into the input. |

Everything that can fail inside `execute.before` is wrapped: `decide()` runs in a `try` and any
internal fault is logged and the call is allowed. Only the deliberate nudge throws. A question
that never reaches the user is treated as worse than one without a premise.

The pure helpers (`premiseFromReasoning`, `textBefore`, `textInTurn`, `turnKeyOf`,
`reasoningInTurn`, `withPremise`, `rejection`, `recordRejection`, `rejectionsSoFar`,
`resolveOptions`) are exported so `test/question-gate.test.ts` covers them without an OpenCode
server.

## Data model / storage

There is no persistent storage. The only state is an in-memory `Map<string, TurnState>` keyed by
turn (`<sessionID>:<id of the user message that opened the turn>`) holding
`{ rejected: number, at: number }`. It is bounded two ways: entries older than `turn_window_ms`
are swept on every write, and the map is capped at 500 turns (`MAX_TRACKED_TURNS`), evicting the
oldest entry when full. A passing call deletes its turn's entry.

## Key flows

### Layer 1 — tool description

At setup, if `describe_tool` is on, the transform looks up each gated tool, skips it when absent or
when the description already contains the requirement marker, and otherwise appends
`TOOL_REQUIREMENT`: the same assistant step must already contain visible reply text; reasoning does
not count; end the thinking, write the paragraph, then call the tool.

### Layer 2 — nudge (once per turn)

On `execute.before` for a gated tool:

1. Read `ctx.session.context({sessionID})`. The current step's text part streams in parallel with
   the tool call and may not be persisted yet, so the read is repeated up to `context_retries`
   times with `context_retry_ms` between attempts until the visible text reaches `min_chars`.
2. `textInTurn` counts trimmed `text` parts in the current step before the call (`textBefore`) plus
   every assistant step back to the last user message. `reasoning` parts never count. If the
   message is not in the context at all (`-1`), the call passes.
3. If the count is ≥ `min_chars`: pass, and forget the turn's rejection count.
4. Otherwise, if the turn has been rejected fewer than `max_rejections_per_turn` times: record the
   rejection and throw the `rejection()` text. It tells the model how many characters it has and
   needs, that reasoning is invisible, to write the premise as reply text and call again with the
   same arguments, that this is the only retry, and never to mention the check or replace the form
   with plain-text options.

The turn key is derived from the opening user message so the budget resets on the next prompt and
cannot keep nagging inside one long turn.

### Layer 3 — guarantee

When the nudge budget is spent and the call is still bare:

1. `reasoningInTurn` joins every `reasoning` part of the turn (the retry step often has none of its
   own; the draft sits in the step that was nudged).
2. `premiseFromReasoning` splits it into paragraphs, drops paragraphs that talk about the gate
   itself (the `META` pattern), prefers the trailing run of paragraphs that address the user
   (`ADDRESSES_USER`), and keeps whole paragraphs from the tail until `premise_min_chars` is
   reached, capped at `premise_max_chars`.
3. `withPremise` builds a **new** input object with the premise, `INJECTED_MARKER` and the original
   question text prepended to the first question. The hook's `input` is frozen, so it is replaced
   via `event.input = …` rather than mutated; mutating in place throws and surfaces as a tool error.
4. The call passes. If the premise is unavailable or the input shape is not usable, the call passes
   unchanged and the log says why.

## Configuration surface

See `docs/configuration.md`. Options arrive as `ctx.options` and are normalised once by
`resolveOptions()`; the plugin never re-reads them.

## Decisions and rationale

- **Three layers instead of a hard reject.** A rejection alone makes some models retry the bare
  call repeatedly, and a provider-side error right after a rejection can kill the turn. Prevention
  reduces the number of rejections; the once-per-turn cap removes the loop; injection makes sure
  the user still sees a premise when the model ignores both.
- **Reasoning never counts as visible text.** That is the failure mode being fixed: the premise
  exists, but in a block the user cannot read.
- **Count the whole turn, not the step.** The current step's text part is often not persisted when
  the hook fires, and a premise written one step earlier in the same reply is still visible.
- **Turn-scoped rejection counter.** A session-wide counter either let a bare question through hours
  later or kept nudging inside one long turn; keying on the opening user message gives exactly one
  nudge per prompt.
- **Replace, don't mutate, the input.** The event's input object is frozen by OpenCode.
- **Fail open.** Any internal exception, context lookup failure or unknown message lets the call
  through and logs it.
- **Type-only import of `@opencode/plugin`.** The plugin directory may have no `node_modules` of its
  own when installed by cloning, so nothing from the package may be needed at runtime.

## Current scope and non-goals

The gate judges the *presence* of visible text, not its quality: it checks character counts and
recovers a premise heuristically from the reasoning tail. It applies to whichever tools are listed
in `tools` (the `question` tool by default) and does not alter the form after the user answers.

## Operations

- **Logs.** Every decision writes one `[question-gate] …` line to stderr (the OpenCode server log):
  `nudged <tool> in <session>/<message>: <n> chars < <min> (step parts: …, nudge i/n)`,
  `let <tool> through … and injected a N-char premise …`, `let <tool> through … with no premise
  injected …`, `internal failure, letting <tool> through: …`. `debug: true` adds the passing calls
  and the tool-description outcome (`question=extended|already-carries-it|absent`).
- **Health.** No endpoint; a healthy plugin is silent except for nudge/pass-through lines. A tool
  description containing "REQUIRED before calling this tool" shows layer 1 is active.
- **Upgrade.** `git pull` in the plugin directory, then restart the OpenCode server: plugins are
  loaded per location boot. Run `bun test` before deploying a change.
