// Type-only import: Bun resolves bare specifiers from the symlink's real path, where no node_modules exists.
import type { Plugin } from "@opencode/plugin"

// Rejects a `question` tool call whose assistant step carries no visible text before it.
// Reasoning (thinking) blocks do not count: the model habitually writes the description there,
// calls the tool straight away, and the user sees the question before any explanation.
// The rejection is returned to the model as a tool error, so it writes the text and retries.

export type Options = {
  tools: Set<string>
  minChars: number
  debug: boolean
}

type Content = { type: string; text?: string; id?: string }
type AssistantMessage = { id: string; type: "assistant"; content: Content[] }

export function resolveOptions(raw: Readonly<Record<string, any>> = {}): Options {
  return {
    tools: new Set((raw.tools as string[] | undefined) ?? ["question"]),
    minChars: Number(raw.min_chars ?? 40),
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

export function rejection(tool: string, minChars: number, chars: number): string {
  return [
    `[question-gate] \`${tool}\` rejected: this step has ${chars} visible characters of text before the call (minimum ${minChars}).`,
    "The thinking block is not shown to the user. Before calling the tool again, write the reply text in the same step:",
    "a short description of what is being asked and why, what each outcome leads to, and any commands as fenced blocks.",
    "Then call the tool with the same arguments.",
  ].join(" ")
}

const plugin: Plugin.Plugin = {
  id: "question-gate",
  async setup(ctx) {
    const opts = resolveOptions(ctx.options)
    const log = (msg: string) => console.error(`[question-gate] ${msg}`)
    const debug = (msg: string) => opts.debug && log(msg)

    await ctx.tool.hook("execute.before", async (event) => {
      if (!opts.tools.has(event.tool)) return
      let message: AssistantMessage | undefined
      try {
        const messages = (await ctx.session.context({ sessionID: event.sessionID })) as unknown as AssistantMessage[]
        message = messages.find((m) => m.type === "assistant" && m.id === event.messageID)
      } catch (error) {
        log(`context lookup failed for ${event.sessionID}, letting ${event.tool} through: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      if (!message) {
        debug(`message ${event.messageID} not found in session context, letting ${event.tool} through`)
        return
      }
      const chars = textBefore(message, event.id)
      debug(`${event.tool} in ${event.messageID}: ${chars} chars of text before the call (parts: ${message.content.map((p) => p.type).join(",")})`)
      if (chars >= opts.minChars) return
      log(`rejected ${event.tool} in ${event.sessionID}/${event.messageID}: ${chars} chars < ${opts.minChars}`)
      throw new Error(rejection(event.tool, opts.minChars, chars))
    })
  },
}

export default plugin
