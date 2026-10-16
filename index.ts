// Type-only import: the plugin directory may have no node_modules of its own at runtime.
import type { Plugin } from "@opencode/plugin"

// Guarantees that a `question` tool call carries a visible premise, in three layers:
//
//   1. prevention  — the requirement is appended to the `question` tool's own description, so the
//                    model reads it while deciding to call, not after.
//   2. nudge       — a call with no visible reply text in the turn is rejected AT MOST ONCE PER TURN
//                    (`max_rejections_per_turn`, 0 disables), so the model writes the premise as
//                    reply text and retries. In practice the retry carries the text.
//   3. guarantee   — if it still arrives bare, the call is LET THROUGH and the premise is injected
//                    into the form from the step's reasoning tail (where thinking models reliably
//                    draft the user-facing paragraph). The user always sees a description; the
//                    agent never loops on an error.
//
// Reasoning (thinking) blocks never count as visible text: the user sees a bare question when the
// premise lives there. The once-per-turn cap exists because repeated rejections make some models
// loop on the bare call, and a provider error right after a rejection can end the turn.

export type Options = {
  tools: Set<string>
  minChars: number
  maxRejectionsPerTurn: number
  turnWindowMs: number
  premiseMaxChars: number
  premiseMinChars: number
  injectPremise: boolean
  describeTool: boolean
  contextRetries: number
  contextRetryMs: number
  debug: boolean
}

type Content = { type: string; text?: string; id?: string }
type Message = { id: string; type: string; content?: Content[] }
type QuestionInput = { questions?: { header?: string; question?: string }[] }

export const INJECTED_MARKER = "_(context recovered from the agent's reasoning — it asked without writing a premise)_"

// Reasoning paragraphs that talk about the asking machinery itself are self-talk, never a premise.
const META = /(question-gate|visible paragraph|a premise|the premise|the question tool|before asking|call the tool|gate (should|now|check|plugin|rejection|error))/i
// A drafted premise addresses the user.
const ADDRESSES_USER = /\b(you|your|you're|you'd|you'll)\b/i

export function premiseFromReasoning(reasoning: string, opts: Pick<Options, "premiseMaxChars" | "premiseMinChars">): string | undefined {
  if (reasoning.trim().length === 0) return
  const paragraphs = reasoning
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !META.test(p))
  if (paragraphs.length === 0) return
  // Prefer the trailing run of paragraphs that address the user: that is the draft the model meant
  // to send. Fall back to the plain tail when nothing does.
  const lastAddressed = paragraphs.reduce((acc, p, i) => (ADDRESSES_USER.test(p) ? i : acc), -1)
  const end = lastAddressed >= 0 ? lastAddressed : paragraphs.length - 1
  const kept: string[] = []
  let total = 0
  for (let i = end; i >= 0; i--) {
    const p = paragraphs[i]
    if (kept.length > 0 && total + p.length > opts.premiseMaxChars) break
    kept.unshift(p)
    total += p.length
    if (total >= opts.premiseMinChars) break
  }
  const premise = kept.join("\n\n").slice(-opts.premiseMaxChars).trim()
  return premise.length > 0 ? premise : undefined
}

export const TOOL_REQUIREMENT = [
  "REQUIRED before calling this tool: the same assistant step must already contain visible reply text",
  "(a short paragraph: what is being asked, why it is needed now, what each outcome leads to, plus any",
  "commands as fenced code blocks). A thinking/reasoning block does NOT count — the user never reads it.",
  "End the thinking, write that paragraph as normal output, then call this tool.",
].join(" ")

export function resolveOptions(raw: Readonly<Record<string, any>> = {}): Options {
  return {
    tools: new Set((raw.tools as string[] | undefined) ?? ["question"]),
    minChars: Number(raw.min_chars ?? 40),
    maxRejectionsPerTurn: Number(raw.max_rejections_per_turn ?? 1),
    turnWindowMs: Number(raw.turn_window_ms ?? 30 * 60 * 1000),
    premiseMaxChars: Number(raw.premise_max_chars ?? 700),
    premiseMinChars: Number(raw.premise_min_chars ?? 80),
    injectPremise: raw.inject_premise !== false,
    describeTool: raw.describe_tool !== false,
    contextRetries: Number(raw.context_retries ?? 4),
    contextRetryMs: Number(raw.context_retry_ms ?? 500),
    debug: raw.debug === true,
  }
}

// Visible text in one step up to (and excluding) the gated tool call.
export function textBefore(message: Message, callID: string): number {
  let chars = 0
  for (const part of message.content ?? []) {
    if (part.type === "tool" && part.id === callID) break
    if (part.type === "text") chars += (part.text ?? "").trim().length
  }
  return chars
}

// Visible text in the whole turn before the call: this step's text plus every assistant step back to
// the last user message. The current step's text part is often not yet persisted when execute.before
// fires (it streams in parallel), so counting only the current step rejects calls whose premise sits
// one step earlier in the same reply. Returns -1 when the message is not in the context at all.
export function textInTurn(messages: Message[], messageID: string, callID: string): number {
  const idx = messages.findIndex((m) => m.id === messageID)
  if (idx < 0) return -1
  let chars = textBefore(messages[idx], callID)
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type === "user") break
    if (m.type !== "assistant") continue
    for (const part of m.content ?? []) {
      if (part.type === "text") chars += (part.text ?? "").trim().length
    }
  }
  return chars
}

// The turn is identified by the user message that opened it, so "once per turn" resets on the next
// prompt instead of leaking into later questions (a session-wide counter let a bare question through
// hours later, and kept nudging inside one long turn).
export function turnKeyOf(messages: Message[], messageID: string, sessionID: string): string {
  const idx = messages.findIndex((m) => m.id === messageID)
  for (let i = idx < 0 ? messages.length - 1 : idx; i >= 0; i--) {
    if (messages[i].type === "user") return `${sessionID}:${messages[i].id}`
  }
  return `${sessionID}:head`
}

// Thinking models draft the user-facing paragraph at the end of the reasoning block, so its tail is
// the premise they meant to send. Collect the turn's reasoning (the retry step often has none of its
// own — the draft sits in the step that was nudged) and keep whole trailing paragraphs.
export function reasoningInTurn(messages: Message[], messageID: string): string {
  const idx = messages.findIndex((m) => m.id === messageID)
  if (idx < 0) return ""
  let start = 0
  for (let i = idx; i >= 0; i--) {
    if (messages[i].type === "user") {
      start = i + 1
      break
    }
  }
  const chunks: string[] = []
  for (let i = start; i <= idx; i++) {
    const m = messages[i]
    if (m.type !== "assistant") continue
    for (const part of m.content ?? []) {
      if (part.type !== "reasoning") continue
      const t = (part.text ?? "").trim()
      if (t.length > 0) chunks.push(t)
    }
  }
  return chunks.join("\n\n")
}


// Prepend the premise to the first question's text. The hook event's `input` is frozen, so this
// returns a NEW input object (mutating in place throws "Attempted to assign to readonly property"
// and surfaces as a tool error). Returns undefined when the shape is not
// usable or the premise is already there, in which case the call is left exactly as it was.
export function withPremise(input: unknown, premise: string): unknown | undefined {
  const questions = (input as QuestionInput | undefined)?.questions
  if (!Array.isArray(questions) || questions.length === 0) return
  const first = questions[0]
  if (!first || typeof first !== "object") return
  const existing = typeof first.question === "string" ? first.question : ""
  if (existing.includes(INJECTED_MARKER)) return
  const question = `${premise}\n\n${INJECTED_MARKER}\n\n${existing}`.trim()
  return { ...(input as Record<string, unknown>), questions: [{ ...first, question }, ...questions.slice(1)] }
}

export function rejection(tool: string, minChars: number, chars: number, reasoningOnly: boolean): string {
  return [
    `[question-gate] \`${tool}\` not sent yet: this turn has ${chars} visible characters of reply text before the call (minimum ${minChars}).`,
    reasoningOnly
      ? "This step holds only a thinking block and the tool call, so the premise you wrote is inside the thinking block, which the user never sees."
      : "Reasoning/thinking blocks are not visible to the user.",
    "End the thinking, write the premise as normal reply text —",
    "what is being asked and why, what each outcome leads to, any commands as fenced code blocks —",
    "then call the tool again with the same arguments; it will be accepted.",
    "This is the only retry: the next call goes through either way.",
    "Never mention this check in your reply, and never replace the question with plain-text options.",
  ].join(" ")
}

export function partTypes(message: Message | undefined): string {
  return (message?.content ?? []).map((p) => p.type).join(",") || "-"
}

// Bounded, lazily swept: one entry per gated turn.
const MAX_TRACKED_TURNS = 500

export type TurnState = { rejected: number; at: number }

export function recordRejection(turns: Map<string, TurnState>, key: string, now: number, windowMs: number): number {
  for (const [k, v] of turns) if (now - v.at > windowMs) turns.delete(k)
  if (turns.size >= MAX_TRACKED_TURNS && !turns.has(key)) {
    const oldest = [...turns.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) turns.delete(oldest[0])
  }
  const entry = turns.get(key)
  const next = { rejected: (entry?.rejected ?? 0) + 1, at: now }
  turns.set(key, next)
  return next.rejected
}

export function rejectionsSoFar(turns: Map<string, TurnState>, key: string, now: number, windowMs: number): number {
  const entry = turns.get(key)
  if (!entry || now - entry.at > windowMs) return 0
  return entry.rejected
}

const plugin: Plugin.Plugin = {
  id: "question-gate",
  async setup(ctx) {
    const opts = resolveOptions(ctx.options)
    const log = (msg: string) => console.error(`[question-gate] ${msg}`)
    const debug = (msg: string) => opts.debug && log(msg)
    const turns = new Map<string, TurnState>()

    // Layer 1: prevention. State the requirement where the model decides to call the tool.
    // The callback is replayed on every registry rebuild, so it logs from inside (it has not run
    // yet when `transform()` returns) and treats finding its own earlier edit as the steady state.
    if (opts.describeTool) {
      try {
        await ctx.tool.transform((editor) => {
          const outcome: string[] = []
          for (const id of opts.tools) {
            const tool = editor.get(id)
            if (!tool) {
              outcome.push(`${id}=absent`)
              continue
            }
            if (typeof tool.description === "string" && tool.description.includes("REQUIRED before calling this tool")) {
              outcome.push(`${id}=already-carries-it`)
              continue
            }
            editor.update(id, (t) => {
              t.description = `${t.description ?? ""}\n\n${TOOL_REQUIREMENT}`.trim()
            })
            outcome.push(`${id}=extended`)
          }
          debug(`tool description: ${outcome.join(" ")}`)
        })
      } catch (error) {
        log(`could not extend the tool description: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await ctx.tool.hook("execute.before", async (event) => {
      if (!opts.tools.has(event.tool)) return
      // Anything unexpected in here must let the call through: a question that never reaches the
      // user is worse than one without a premise. Only the deliberate nudge below throws.
      let nudge: string | undefined
      try {
        nudge = await decide(event)
      } catch (error) {
        log(`internal failure, letting ${event.tool} through: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
        return
      }
      if (nudge) throw new Error(nudge)
    })

    async function decide(event: {
      tool: string
      sessionID: string
      messageID: string
      id: string
      input: unknown
    }): Promise<string | undefined> {
      const now = Date.now()
      let chars = -1
      let current: Message | undefined
      let turnMessages: Message[] = []
      let key = `${event.sessionID}:head`
      // The step's text part streams in parallel with the tool call, so a first-step question can
      // read as 0 chars for a moment. Re-read before judging.
      for (let attempt = 0; attempt <= opts.contextRetries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, opts.contextRetryMs))
        try {
          turnMessages = (await ctx.session.context({ sessionID: event.sessionID })) as unknown as Message[]
        } catch (error) {
          log(`context lookup failed for ${event.sessionID}, letting ${event.tool} through: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        current = turnMessages.find((m) => m.id === event.messageID)
        key = turnKeyOf(turnMessages, event.messageID, event.sessionID)
        chars = textInTurn(turnMessages, event.messageID, event.id)
        if (chars < 0) {
          debug(`message ${event.messageID} not found in session context, letting ${event.tool} through`)
          return
        }
        if (chars >= opts.minChars) break
      }

      if (chars >= opts.minChars) {
        debug(`${event.tool} in ${event.messageID}: ${chars} chars of visible text in the turn, passing`)
        turns.delete(key)
        return
      }

      const types = partTypes(current)
      const already = rejectionsSoFar(turns, key, now, opts.turnWindowMs)

      // Layer 2: nudge, at most `maxRejectionsPerTurn` times for this turn.
      if (already < opts.maxRejectionsPerTurn) {
        const n = recordRejection(turns, key, now, opts.turnWindowMs)
        log(`nudged ${event.tool} in ${event.sessionID}/${event.messageID}: ${chars} chars < ${opts.minChars} (step parts: ${types}, nudge ${n}/${opts.maxRejectionsPerTurn})`)
        return rejection(event.tool, opts.minChars, chars, types.includes("reasoning") && !types.includes("text"))
      }

      // Layer 3: guarantee. Never block twice — let it through, but carry a premise into the form.
      const premise = opts.injectPremise ? premiseFromReasoning(reasoningInTurn(turnMessages, event.messageID), opts) : undefined
      const replacement = premise ? withPremise(event.input, premise) : undefined
      if (replacement) {
        event.input = replacement
        log(`let ${event.tool} through in ${event.sessionID}/${event.messageID} after ${already} nudge(s) and injected a ${premise!.length}-char premise from the reasoning (step parts: ${types})`)
        return
      }
      log(`let ${event.tool} through in ${event.sessionID}/${event.messageID} after ${already} nudge(s) with no premise injected (step parts: ${types}, ${chars} chars, premise ${premise ? "unusable input shape" : "unavailable"})`)
    }
  },
}

export default plugin
