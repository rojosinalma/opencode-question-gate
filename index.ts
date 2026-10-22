// Type-only import: the plugin directory may have no node_modules of its own at runtime.
import type { Plugin } from "@opencode/plugin"

// Keeps the `question` tool from turning into a nag. Five rules, all enforced in `execute.before`:
//
//   1. question back  — once the user answers a question with a question of their own (free text
//                       containing "?"), no further question is sent in that turn.
//   2. dismissals     — a dismissed question is remembered per session; the same header or question
//                       text is rejected for the rest of the session, and nothing else is asked in
//                       the turn it was dismissed in.
//   3. one per turn   — at most `max_calls_per_turn` question calls per turn, so the user can answer
//                       (or reject) one before the next, dependent one appears.
//   4. parallelism    — a question about parallel work or subagents is rejected: the agent
//                       decides that itself, so it is never worth asking.
//   5. premise        — never a rejection. A call with too little visible reply text in front of it
//                       goes through with a premise recovered from the reasoning tail.
//
// The tool description carries the same rules so the model reads them before it calls. Anything
// unexpected inside the gate lets the call through: a question that never reaches the user is
// worse than one that breaks a rule.

export type Options = {
  tools: Set<string>
  maxCallsPerTurn: number
  stopOnQuestionBack: boolean
  rememberDismissed: boolean
  stopAfterDismissal: boolean
  matchHeader: boolean
  dismissedPattern: RegExp
  blockParallelism: boolean
  parallelismPattern: RegExp
  minChars: number
  injectPremise: boolean
  premiseMaxChars: number
  premiseMinChars: number
  describeTool: boolean
  contextRetries: number
  contextRetryMs: number
  turnWindowMs: number
  dismissalWindowMs: number
  maxTurns: number
  maxSessions: number
  maxDismissedPerSession: number
  debug: boolean
}

type Content = { type: string; text?: string; id?: string }
type Message = { id: string; type: string; text?: string; content?: Content[] }
type QuestionItem = { header?: string; question?: string; options?: { label?: string }[] }
type QuestionInput = { questions?: QuestionItem[] }

export const PREFIX = "[question-gate]"
export const INJECTED_MARKER = "_(context recovered from the agent's reasoning — it asked without writing a premise)_"
export const RULES_MARKER = "Rules for this tool:"

export const TOOL_RULES = [
  RULES_MARKER,
  "(1) Make at most one question call per turn; the user answers it before the next one.",
  "(2) Write a short visible paragraph first: what you ask, why now, what each answer leads to. A thinking block does not count.",
  "(3) If the user's answer is a question, answer it in plain reply text and end the turn.",
  "(4) Never ask again a question the user dismissed.",
  "(5) Never ask about parallelism or subagents; decide it yourself.",
].join(" ")

export const MESSAGES = {
  questionBack:
    "The user asked a question back. Answer it in plain reply text and end the turn. Do not ask anything else this turn.",
  dismissedRepeat: "The user dismissed this question already. Do not ask it again unless the user brings it up.",
  dismissedTurn:
    "The user dismissed a question this turn. Do not ask anything else this turn. Continue without that answer or end the turn with a plain reply.",
  limit: (max: number) =>
    `This turn already has ${max} question call${max === 1 ? "" : "s"}, the maximum. State any further decision in plain reply text and end the turn; ask it next turn if it is still open.`,
  parallelism: "The user's rule: never ask about parallelism or subagents. Decide it yourself and do the work without asking.",
}

export function rejectionText(message: string): string {
  return `${PREFIX} ${message}`
}

function regex(raw: unknown, fallback: string): RegExp {
  try {
    return new RegExp(typeof raw === "string" && raw.length > 0 ? raw : fallback, "i")
  } catch {
    return new RegExp(fallback, "i")
  }
}

function num(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function resolveOptions(raw: Readonly<Record<string, any>> = {}): Options {
  return {
    tools: new Set(Array.isArray(raw.tools) ? (raw.tools as string[]) : ["question"]),
    maxCallsPerTurn: num(raw.max_calls_per_turn, 1),
    stopOnQuestionBack: raw.stop_on_question_back !== false,
    rememberDismissed: raw.remember_dismissed !== false,
    stopAfterDismissal: raw.stop_after_dismissal !== false,
    matchHeader: raw.match_header !== false,
    dismissedPattern: regex(raw.dismissed_pattern, "dismissed"),
    blockParallelism: raw.block_parallelism !== false,
    parallelismPattern: regex(raw.parallelism_pattern, "\\b(parallel\\w*|sub-?agents?)\\b"),
    minChars: num(raw.min_chars, 40),
    injectPremise: raw.inject_premise !== false,
    premiseMaxChars: num(raw.premise_max_chars, 700),
    premiseMinChars: num(raw.premise_min_chars, 80),
    describeTool: raw.describe_tool !== false,
    contextRetries: num(raw.context_retries, 4),
    contextRetryMs: num(raw.context_retry_ms, 500),
    turnWindowMs: num(raw.turn_window_ms, 30 * 60 * 1000),
    dismissalWindowMs: num(raw.dismissal_window_ms, 24 * 60 * 60 * 1000),
    maxTurns: Math.max(1, num(raw.max_turns, 500)),
    maxSessions: Math.max(1, num(raw.max_sessions, 200)),
    maxDismissedPerSession: Math.max(1, num(raw.max_dismissed_per_session, 50)),
    debug: raw.debug === true,
  }
}

// ---------------------------------------------------------------------------------------------
// Bounded state

// Insertion-ordered map with a size cap and a time window. A touched entry moves to the end, the
// oldest falls off when the cap is reached, and an entry older than the window reads as absent.
export class Bounded<V> {
  private entries = new Map<string, { value: V; at: number }>()
  constructor(
    readonly cap: number,
    readonly windowMs: number,
  ) {}

  get(key: string, now: number): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return
    if (now - entry.at > this.windowMs) {
      this.entries.delete(key)
      return
    }
    return entry.value
  }

  set(key: string, value: V, now: number): V {
    this.entries.delete(key)
    this.entries.set(key, { value, at: now })
    while (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return value
  }

  // Read and refresh, creating the entry when absent or expired.
  upsert(key: string, now: number, create: () => V): V {
    return this.set(key, this.get(key, now) ?? create(), now)
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  get size(): number {
    return this.entries.size
  }
}

export type TurnState = {
  completed: number
  inFlight: Set<string>
  questionBack: boolean
  dismissed: boolean
}

export function newTurn(): TurnState {
  return { completed: 0, inFlight: new Set(), questionBack: false, dismissed: false }
}

export type Dismissed = { headers: string[]; questions: string[] }

// ---------------------------------------------------------------------------------------------
// Pure helpers

function questionsOf(input: unknown): QuestionItem[] {
  const questions = (input as QuestionInput | undefined)?.questions
  return Array.isArray(questions) ? questions.filter((q) => q && typeof q === "object") : []
}

// Lowercase, accents folded, "(Recommended)" and punctuation dropped, whitespace collapsed.
export function normalise(text: unknown): string {
  if (typeof text !== "string") return ""
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(recommended\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

// The question text the model wrote, without a premise this gate injected in front of it.
export function ownQuestion(text: unknown): string {
  if (typeof text !== "string") return ""
  const at = text.indexOf(INJECTED_MARKER)
  return at < 0 ? text : text.slice(at + INJECTED_MARKER.length)
}

// Normalised header and question of every question in a call; empty and very short ones dropped
// so a one-word header cannot match half the session.
export function questionKeys(input: unknown): Dismissed {
  const headers: string[] = []
  const questions: string[] = []
  for (const q of questionsOf(input)) {
    const h = normalise(q.header)
    const t = normalise(ownQuestion(q.question))
    if (h.length >= 3) headers.push(h)
    if (t.length >= 3) questions.push(t)
  }
  return { headers, questions }
}

export function matchesDismissed(input: unknown, dismissed: Dismissed | undefined, matchHeader: boolean): boolean {
  if (!dismissed) return false
  const keys = questionKeys(input)
  if (keys.questions.some((q) => dismissed.questions.includes(q))) return true
  return matchHeader && keys.headers.some((h) => dismissed.headers.includes(h))
}

export function recordDismissed(previous: Dismissed | undefined, input: unknown, cap: number): Dismissed {
  const keys = questionKeys(input)
  const merge = (old: string[], add: string[]) => {
    const out = old.filter((k) => !add.includes(k)).concat([...new Set(add)])
    return out.slice(Math.max(0, out.length - cap))
  }
  return {
    headers: merge(previous?.headers ?? [], keys.headers),
    questions: merge(previous?.questions ?? [], keys.questions),
  }
}

// Text of the user message that opened the turn (user messages carry `text`, not content parts).
export function latestUserText(messages: Message[], messageID: string): string {
  const idx = messages.findIndex((m) => m.id === messageID)
  for (let i = idx < 0 ? messages.length - 1 : idx; i >= 0; i--) {
    const m = messages[i]
    if (m.type !== "user") continue
    const parts = (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "")
    return [m.text ?? "", ...parts].join(" ")
  }
  return ""
}

// The user brings a dismissed question back up when the turn's prompt names its header or contains
// its question text. Returns the dismissal list without the keys of this call, or undefined when
// the user did not raise it.
export function raisedByUser(userText: string, input: unknown, dismissed: Dismissed | undefined): Dismissed | undefined {
  if (!dismissed) return
  const said = ` ${normalise(userText)} `
  const keys = questionKeys(input)
  const hit = [...keys.headers, ...keys.questions].some((k) => said.includes(` ${k} `))
  if (!hit) return
  return {
    headers: dismissed.headers.filter((h) => !keys.headers.includes(h)),
    questions: dismissed.questions.filter((q) => !keys.questions.includes(q)),
  }
}

export function mentionsParallelism(input: unknown, pattern: RegExp): boolean {
  for (const q of questionsOf(input)) {
    const texts = [q.header, ownQuestion(q.question), ...(Array.isArray(q.options) ? q.options.map((o) => o?.label) : [])]
    if (texts.some((t) => typeof t === "string" && pattern.test(t))) return true
  }
  return false
}

// A free-text answer is one that is not an option label of its question. The question tool
// reports answers as `metadata.answers: string[][]`, one array per question, in order.
export function answeredWithQuestion(input: unknown, result: unknown): boolean {
  const answers = (result as { metadata?: { answers?: unknown } } | undefined)?.metadata?.answers
  if (!Array.isArray(answers)) return false
  const questions = questionsOf(input)
  return answers.some((list, i) => {
    if (!Array.isArray(list)) return false
    const labels = new Set(
      (Array.isArray(questions[i]?.options) ? questions[i].options! : [])
        .map((o) => (typeof o?.label === "string" ? o.label.trim() : ""))
        .filter((l) => l.length > 0),
    )
    return list.some((a) => typeof a === "string" && !labels.has(a.trim()) && a.includes("?"))
  })
}

export function isDismissal(error: unknown, pattern: RegExp): boolean {
  const message = (error as { message?: unknown } | undefined)?.message
  return typeof message === "string" && !message.startsWith(PREFIX) && pattern.test(message)
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

// Visible text in the whole turn before the call: this step's text plus every assistant step back
// to the last user message (the current step's text part may not be persisted yet when the hook
// fires). Returns -1 when the message is not in the context at all.
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

// A turn is identified by the user message that opened it, so per-turn state resets on the next
// prompt. The current step may not be persisted yet; then the latest user message opens the turn.
// Returns undefined when the context holds no user message at all.
export function turnKeyOf(messages: Message[], messageID: string, sessionID: string): string | undefined {
  const idx = messages.findIndex((m) => m.id === messageID)
  if (idx < 0 && !messages.some((m) => m.type === "user")) return
  for (let i = idx < 0 ? messages.length - 1 : idx; i >= 0; i--) {
    if (messages[i].type === "user") return `${sessionID}:${messages[i].id}`
  }
  return `${sessionID}:head`
}

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

// Reasoning paragraphs that talk about the asking machinery itself are self-talk, never a premise.
const META = /(question-gate|visible paragraph|a premise|the premise|the question tool|before asking|call the tool|gate (should|now|check|plugin|rejection|error))/i
// A drafted premise addresses the user.
const ADDRESSES_USER = /\b(you|your|you're|you'd|you'll)\b/i

// Thinking models draft the user-facing paragraph at the end of the reasoning block, so its tail
// is the premise they meant to send. Keep whole trailing paragraphs.
export function premiseFromReasoning(reasoning: string, opts: Pick<Options, "premiseMaxChars" | "premiseMinChars">): string | undefined {
  if (reasoning.trim().length === 0) return
  const paragraphs = reasoning
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !META.test(p))
  if (paragraphs.length === 0) return
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

// Prepend the premise to the first question's text. The hook event's `input` is frozen, so this
// returns a NEW input object. Returns undefined when the shape is not usable or the premise is
// already there; the call is then left exactly as it was.
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

// ---------------------------------------------------------------------------------------------
// Plugin

type BeforeEvent = { tool: string; sessionID: string; messageID: string; id: string; input: unknown }
type AfterEvent = {
  tool: string
  sessionID: string
  messageID: string
  id: string
  input: unknown
  status: "completed" | "error"
  result?: unknown
  error?: unknown
}

export type GateContext = {
  options?: Readonly<Record<string, any>>
  tool: {
    transform: (callback: (editor: any) => void) => Promise<unknown>
    hook: (name: any, callback: (event: any) => Promise<void> | void) => Promise<unknown>
  }
  session: { context: (input: { sessionID: string }) => Promise<unknown> }
}

const errorText = (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error))

export async function setupGate(ctx: GateContext, now: () => number = Date.now, log = (msg: string) => console.error(`${PREFIX} ${msg}`)) {
  const opts = resolveOptions(ctx.options ?? {})
  const debug = (msg: string) => opts.debug && log(msg)
  const turns = new Bounded<TurnState>(opts.maxTurns, opts.turnWindowMs)
  const dismissed = new Bounded<Dismissed>(opts.maxSessions, opts.dismissalWindowMs)
  // Call id → turn key, so execute.after updates the turn its call was admitted in.
  const callTurn = new Bounded<string>(opts.maxTurns * 4, opts.turnWindowMs)
  // Calls this gate rejected; their execute.after (if any) is not a user action.
  const rejected = new Bounded<true>(opts.maxTurns * 4, opts.turnWindowMs)

  if (opts.describeTool) {
    try {
      // Replayed on every registry rebuild: it logs from inside and treats its own earlier edit as
      // the steady state.
      await ctx.tool.transform((editor) => {
        const outcome: string[] = []
        for (const id of opts.tools) {
          const tool = editor.get(id)
          if (!tool) {
            outcome.push(`${id}=absent`)
            continue
          }
          if (typeof tool.description === "string" && tool.description.includes(RULES_MARKER)) {
            outcome.push(`${id}=already-carries-it`)
            continue
          }
          editor.update(id, (t: { description?: string }) => {
            t.description = `${t.description ?? ""}\n\n${TOOL_RULES}`.trim()
          })
          outcome.push(`${id}=extended`)
        }
        debug(`tool description: ${outcome.join(" ")}`)
      })
    } catch (error) {
      log(`could not extend the tool description: ${errorText(error)}`)
    }
  }

  async function readContext(sessionID: string): Promise<Message[] | undefined> {
    try {
      const messages = await ctx.session.context({ sessionID })
      return Array.isArray(messages) ? (messages as Message[]) : undefined
    } catch (error) {
      log(`context lookup failed for ${sessionID}: ${errorText(error)}`)
      return
    }
  }

  // Returns the rejection reason, or undefined to let the call through (possibly with a new input).
  async function decide(event: BeforeEvent): Promise<string | undefined> {
    const at = now()
    const where = `${event.sessionID}/${event.messageID}`

    if (opts.blockParallelism && mentionsParallelism(event.input, opts.parallelismPattern)) {
      log(`rejected ${event.tool} in ${where}: asks about parallelism`)
      return MESSAGES.parallelism
    }
    let messages = await readContext(event.sessionID)
    const past = dismissed.get(event.sessionID, at)
    if (opts.rememberDismissed && matchesDismissed(event.input, past, opts.matchHeader)) {
      const cleared = messages ? raisedByUser(latestUserText(messages, event.messageID), event.input, past) : undefined
      if (!cleared) {
        log(`rejected ${event.tool} in ${where}: repeats a dismissed question`)
        return MESSAGES.dismissedRepeat
      }
      dismissed.set(event.sessionID, cleared, at)
      log(`let a dismissed question through in ${where}: the user brought it up`)
    }

    const key = messages ? turnKeyOf(messages, event.messageID, event.sessionID) : undefined
    if (!key) {
      debug(`no turn for ${where}, per-turn rules skipped`)
      return
    }
    const turn = turns.upsert(key, at, newTurn)

    if (opts.stopOnQuestionBack && turn.questionBack) {
      log(`rejected ${event.tool} in ${where}: the user asked a question back this turn`)
      return MESSAGES.questionBack
    }
    if (opts.stopAfterDismissal && turn.dismissed) {
      log(`rejected ${event.tool} in ${where}: the user dismissed a question this turn`)
      return MESSAGES.dismissedTurn
    }
    if (opts.maxCallsPerTurn > 0 && turn.completed + turn.inFlight.size >= opts.maxCallsPerTurn) {
      log(`rejected ${event.tool} in ${where}: ${turn.completed} answered + ${turn.inFlight.size} open of ${opts.maxCallsPerTurn} per turn`)
      return MESSAGES.limit(opts.maxCallsPerTurn)
    }

    turn.inFlight.add(event.id)
    callTurn.set(event.id, key, at)

    if (opts.injectPremise && opts.minChars > 0) {
      // The step's text part streams in parallel with the tool call; re-read before judging.
      let chars = textInTurn(messages!, event.messageID, event.id)
      for (let attempt = 1; chars >= 0 && chars < opts.minChars && attempt <= opts.contextRetries; attempt++) {
        await new Promise((r) => setTimeout(r, opts.contextRetryMs))
        messages = (await readContext(event.sessionID)) ?? messages
        chars = textInTurn(messages!, event.messageID, event.id)
      }
      if (chars >= 0 && chars < opts.minChars) {
        const premise = premiseFromReasoning(reasoningInTurn(messages!, event.messageID), opts)
        const replacement = premise ? withPremise(event.input, premise) : undefined
        if (replacement) {
          event.input = replacement
          log(`let ${event.tool} through in ${where} with a ${premise!.length}-char premise from the reasoning (${chars} visible chars)`)
        } else {
          log(`let ${event.tool} through in ${where} without a premise (${chars} visible chars, premise ${premise ? "unusable input shape" : "unavailable"})`)
        }
        return
      }
    }
    debug(`let ${event.tool} through in ${where}`)
  }

  async function observe(event: AfterEvent): Promise<void> {
    const at = now()
    if (rejected.get(event.id, at)) {
      rejected.delete(event.id)
      return
    }
    const where = `${event.sessionID}/${event.messageID}`
    let key = callTurn.get(event.id, at)
    if (!key) {
      const messages = await readContext(event.sessionID)
      key = messages ? turnKeyOf(messages, event.messageID, event.sessionID) : undefined
    }
    const turn = key ? turns.upsert(key, at, newTurn) : undefined
    turn?.inFlight.delete(event.id)
    callTurn.delete(event.id)

    if (event.status === "completed") {
      if (turn) turn.completed++
      if (answeredWithQuestion(event.input, event.result)) {
        if (turn) turn.questionBack = true
        log(`the user asked a question back in ${where}; no more questions this turn`)
      }
      return
    }
    if (isDismissal(event.error, opts.dismissedPattern)) {
      if (turn) turn.dismissed = true
      if (opts.rememberDismissed) {
        dismissed.set(event.sessionID, recordDismissed(dismissed.get(event.sessionID, at), event.input, opts.maxDismissedPerSession), at)
      }
      log(`the user dismissed ${event.tool} in ${where}; remembered for the session`)
    }
  }

  await ctx.tool.hook("execute.before", async (event: BeforeEvent) => {
    if (!opts.tools.has(event.tool)) return
    let reason: string | undefined
    try {
      reason = await decide(event)
    } catch (error) {
      log(`internal failure, letting ${event.tool} through: ${errorText(error)}`)
      return
    }
    if (reason) {
      rejected.set(event.id, true, now())
      throw new Error(rejectionText(reason))
    }
  })

  await ctx.tool.hook("execute.after", async (event: AfterEvent) => {
    if (!opts.tools.has(event.tool)) return
    try {
      await observe(event)
    } catch (error) {
      log(`internal failure while recording ${event.tool}: ${errorText(error)}`)
    }
  })

  return { opts, turns, dismissed }
}

const plugin: Plugin.Plugin = {
  id: "question-gate",
  async setup(ctx) {
    await setupGate(ctx as unknown as GateContext)
  },
}

export default plugin
