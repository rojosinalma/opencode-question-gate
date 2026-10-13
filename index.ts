// Type-only import: Bun resolves bare specifiers from the symlink's real path, where no node_modules exists.
import type { Plugin } from "@opencode/plugin"

// Nudges a `question` tool call to carry a visible premise: when the turn has no reply text
// before the call, the call is rejected once or twice so the model writes the description and
// retries. Reasoning (thinking) blocks do not count: the model habitually writes the premise
// there, and the user then sees a bare question with no explanation.
//
// The gate is a nudge, never a wall (user rule, 2026-10-13): after `maxRejections` rejections
// in one session within `rejectionWindowMs`, the next call passes regardless, so a question is
// never terminally blocked by its own guard.

export type Options = {
  tools: Set<string>
  minChars: number
  maxRejections: number
  rejectionWindowMs: number
  debug: boolean
}

type Content = { type: string; text?: string; id?: string }
type AssistantMessage = { id: string; type: string; content: Content[] }

export function resolveOptions(raw: Readonly<Record<string, any>> = {}): Options {
  return {
    tools: new Set((raw.tools as string[] | undefined) ?? ["question"]),
    minChars: Number(raw.min_chars ?? 40),
    maxRejections: Number(raw.max_rejections ?? 2),
    rejectionWindowMs: Number(raw.rejection_window_ms ?? 5 * 60 * 1000),
    debug: raw.debug === true,
  }
}

// Visible text in the step up to (and excluding) the gated tool call, whitespace-trimmed.
export function textBefore(message: AssistantMessage, callID: string): number {
  let chars = 0
  for (const part of message.content) {
    if (part.type === "tool" && part.id === callID) break
    if (part.type === "text") chars += (part.text ?? "").trim().length
  }
  return chars
}

// Visible text in the whole turn before the call: the current step's text plus every
// assistant step since the last user message. The current step's text part is often not
// yet persisted when execute.before fires (it streams in parallel), so counting only the
// current message rejected calls whose description sat one step earlier in the same reply.
export function textInTurn(messages: AssistantMessage[], messageID: string, callID: string): number {
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

export function rejection(tool: string, minChars: number, chars: number): string {
  return [
    `[question-gate] \`${tool}\` not sent yet: this turn has ${chars} visible characters of reply text before the call (minimum ${minChars}).`,
    "Reasoning/thinking blocks are not visible to the user. First write the premise as normal reply text —",
    "what is being asked and why, what each outcome leads to, any commands as fenced code blocks —",
    "then call the tool again with the same arguments; it will be accepted.",
    "Never mention this check or the rejection in your reply, and never replace the question with plain-text options.",
  ].join(" ")
}

// Rejections per session inside the window; bounded, lazily swept.
const MAX_TRACKED_SESSIONS = 500

export function shouldLetThrough(
  rejections: Map<string, { count: number; at: number }>,
  sessionID: string,
  now: number,
  opts: Pick<Options, "maxRejections" | "rejectionWindowMs">,
): boolean {
  const entry = rejections.get(sessionID)
  if (!entry || now - entry.at > opts.rejectionWindowMs) return false
  return entry.count >= opts.maxRejections
}

export function recordRejection(
  rejections: Map<string, { count: number; at: number }>,
  sessionID: string,
  now: number,
  windowMs: number,
): void {
  for (const [key, value] of rejections) {
    if (now - value.at > windowMs) rejections.delete(key)
  }
  if (rejections.size >= MAX_TRACKED_SESSIONS && !rejections.has(sessionID)) {
    const oldest = [...rejections.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) rejections.delete(oldest[0])
  }
  const entry = rejections.get(sessionID)
  if (!entry || now - entry.at > windowMs) rejections.set(sessionID, { count: 1, at: now })
  else rejections.set(sessionID, { count: entry.count + 1, at: now })
}

const plugin: Plugin.Plugin = {
  id: "question-gate",
  async setup(ctx) {
    const opts = resolveOptions(ctx.options)
    const log = (msg: string) => console.error(`[question-gate] ${msg}`)
    const debug = (msg: string) => opts.debug && log(msg)
    const rejections = new Map<string, { count: number; at: number }>()

    await ctx.tool.hook("execute.before", async (event) => {
      if (!opts.tools.has(event.tool)) return
      const now = Date.now()
      if (shouldLetThrough(rejections, event.sessionID, now, opts)) {
        rejections.delete(event.sessionID)
        log(`letting ${event.tool} through in ${event.sessionID} after ${opts.maxRejections} rejections (nudge, not wall)`)
        return
      }
      // The current step's text part streams in parallel and is often not yet persisted
      // when this hook fires, so a first-step question would always count 0. Retry a few
      // times before rejecting.
      let chars = -1
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500))
        let messages: AssistantMessage[]
        try {
          messages = (await ctx.session.context({ sessionID: event.sessionID })) as unknown as AssistantMessage[]
        } catch (error) {
          log(`context lookup failed for ${event.sessionID}, letting ${event.tool} through: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        chars = textInTurn(messages, event.messageID, event.id)
        if (chars < 0) {
          debug(`message ${event.messageID} not found in session context, letting ${event.tool} through`)
          return
        }
        if (chars >= opts.minChars) break
      }
      debug(`${event.tool} in ${event.messageID}: ${chars} chars of text in the turn before the call`)
      if (chars >= opts.minChars) {
        rejections.delete(event.sessionID)
        return
      }
      recordRejection(rejections, event.sessionID, now, opts.rejectionWindowMs)
      log(`rejected ${event.tool} in ${event.sessionID}/${event.messageID}: ${chars} chars < ${opts.minChars}`)
      throw new Error(rejection(event.tool, opts.minChars, chars))
    })
  },
}

export default plugin
