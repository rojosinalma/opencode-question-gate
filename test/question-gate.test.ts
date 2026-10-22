import { expect, test } from "bun:test"
import {
  Bounded,
  INJECTED_MARKER,
  MESSAGES,
  PREFIX,
  RULES_MARKER,
  answeredWithQuestion,
  isDismissal,
  latestUserText,
  matchesDismissed,
  mentionsParallelism,
  normalise,
  premiseFromReasoning,
  questionKeys,
  raisedByUser,
  reasoningInTurn,
  recordDismissed,
  resolveOptions,
  setupGate,
  textBefore,
  textInTurn,
  turnKeyOf,
  withPremise,
} from "../index.ts"

const opts = resolveOptions()
const user = (id: string) => ({ id, type: "user", content: [] })
const assistant = (id: string, content: any[]) => ({ id, type: "assistant", content })
const text = (t: string) => ({ type: "text", text: t })
const reasoning = (t: string) => ({ type: "reasoning", text: t })
const call = (id: string) => ({ type: "tool", id })
const para = (n: number) => "x".repeat(n)
const ask = (header: string, question: string, labels = ["Yes (Recommended)", "No"]) => ({
  questions: [{ header, question, options: labels.map((label) => ({ label, description: "d" })) }],
})
const answered = (...answers: string[][]) => ({ metadata: { answers, truncated: false }, content: [] })
const dismissedError = { type: "aborted", message: "The user dismissed this question" }

// ---------------------------------------------------------------------------------------------
// Options

test("defaults", () => {
  expect(opts.maxCallsPerTurn).toBe(1)
  expect(opts.minChars).toBe(40)
  expect(opts.stopOnQuestionBack).toBe(true)
  expect(opts.rememberDismissed).toBe(true)
  expect(opts.blockParallelism).toBe(true)
  expect(opts.injectPremise).toBe(true)
  expect(opts.describeTool).toBe(true)
  expect([...opts.tools]).toEqual(["question"])
})

test("options are configurable and bad values fall back", () => {
  const o = resolveOptions({ max_calls_per_turn: 3, tools: ["ask"], block_parallelism: false, parallelism_pattern: "(", max_turns: -5 })
  expect(o.maxCallsPerTurn).toBe(3)
  expect([...o.tools]).toEqual(["ask"])
  expect(o.blockParallelism).toBe(false)
  expect(o.parallelismPattern.test("parallel")).toBe(true)
  expect(o.maxTurns).toBe(500)
  expect(resolveOptions({ max_calls_per_turn: 0 }).maxCallsPerTurn).toBe(0)
})

// ---------------------------------------------------------------------------------------------
// Pure helpers

test("normalise folds case, accents, punctuation and (Recommended)", () => {
  expect(normalise("  Fix  Scope?! ")).toBe("fix scope")
  expect(normalise("Café (Recommended)")).toBe("cafe")
  expect(normalise(undefined)).toBe("")
})

test("questionKeys ignores an injected premise and short keys", () => {
  const input = { questions: [{ header: "Go", question: `premise\n\n${INJECTED_MARKER}\n\nDo I delete the cache?` }] }
  expect(questionKeys(input)).toEqual({ headers: [], questions: ["do i delete the cache"] })
})

test("dismissed questions match by question or header", () => {
  const d = recordDismissed(undefined, ask("Fix scope", "How far should the fix go?"), 50)
  expect(matchesDismissed(ask("Fix scope", "Something else?"), d, true)).toBe(true)
  expect(matchesDismissed(ask("fix  scope!", "Something else?"), d, true)).toBe(true)
  expect(matchesDismissed(ask("Other", "how far should the fix go"), d, true)).toBe(true)
  expect(matchesDismissed(ask("Fix scope", "Something else?"), d, false)).toBe(false)
  expect(matchesDismissed(ask("Other", "Unrelated?"), d, true)).toBe(false)
  expect(matchesDismissed(ask("Other", "Unrelated?"), undefined, true)).toBe(false)
})

test("recordDismissed is capped and keeps the newest", () => {
  let d = undefined as ReturnType<typeof recordDismissed> | undefined
  for (let i = 0; i < 10; i++) d = recordDismissed(d, ask(`header ${i}`, `question ${i}`), 3)
  expect(d!.headers).toEqual(["header 7", "header 8", "header 9"])
  expect(d!.questions.length).toBe(3)
})

test("mentionsParallelism checks header, question and option labels", () => {
  const p = opts.parallelismPattern
  expect(mentionsParallelism(ask("Parallelism", "How do I run it?"), p)).toBe(true)
  expect(mentionsParallelism(ask("Run", "Do I run it in parallel?"), p)).toBe(true)
  expect(mentionsParallelism(ask("Run", "How?", ["Subagents (Recommended)", "Sequential"]), p)).toBe(true)
  expect(mentionsParallelism(ask("Run", "How?", ["Sub-agent", "Inline"]), p)).toBe(true)
  expect(mentionsParallelism(ask("Bin size", "Which size?", ["A", "B"]), p)).toBe(false)
  expect(mentionsParallelism({ questions: "not an array" }, p)).toBe(false)
})

test("answeredWithQuestion finds free text with a question mark only", () => {
  const input = { questions: [ask("Fix", "How far?").questions[0], ask("Mode", "Which?", ["Is it safe?", "No"]).questions[0]] }
  expect(answeredWithQuestion(input, answered(["Are both on the same cluster?"], ["No"]))).toBe(true)
  expect(answeredWithQuestion(input, answered(["Yes (Recommended)"], ["No"]))).toBe(false)
  // an option label that happens to contain "?" is not a question back
  expect(answeredWithQuestion(input, answered(["Yes (Recommended)"], ["Is it safe?"]))).toBe(false)
  // free text without "?" is not a question back
  expect(answeredWithQuestion(input, answered(["do the first one"], ["No"]))).toBe(false)
  expect(answeredWithQuestion(input, { content: [] })).toBe(false)
  expect(answeredWithQuestion(input, undefined)).toBe(false)
})

test("isDismissal matches the dismissal error and never the gate's own rejection", () => {
  expect(isDismissal(dismissedError, opts.dismissedPattern)).toBe(true)
  expect(isDismissal({ type: "aborted", message: "Tool execution interrupted" }, opts.dismissedPattern)).toBe(false)
  expect(isDismissal({ message: `${PREFIX} ${MESSAGES.dismissedRepeat}` }, opts.dismissedPattern)).toBe(false)
  expect(isDismissal(undefined, opts.dismissedPattern)).toBe(false)
})

test("Bounded caps size, evicts the oldest and expires by window", () => {
  const b = new Bounded<number>(2, 100)
  b.set("a", 1, 0)
  b.set("b", 2, 0)
  b.set("c", 3, 0)
  expect(b.size).toBe(2)
  expect(b.get("a", 0)).toBeUndefined()
  expect(b.get("c", 50)).toBe(3)
  expect(b.get("c", 201)).toBeUndefined()
  expect(b.upsert("d", 0, () => 9)).toBe(9)
})

test("textBefore and textInTurn count visible text only, back to the user message", () => {
  const m = assistant("m1", [text("abc"), call("t1"), text("after"), call("t2")])
  expect(textBefore(m, "t1")).toBe(3)
  expect(textBefore(m, "t2")).toBe(8)
  const messages = [user("u0"), assistant("a0", [text("older turn")]), user("u1"), assistant("a1", [text(para(100))]), assistant("a2", [reasoning(para(500)), call("t1")])]
  expect(textInTurn(messages, "a2", "t1")).toBe(100)
  expect(textInTurn(messages, "missing", "t1")).toBe(-1)
})

test("turnKeyOf keys on the opening user message", () => {
  const messages = [user("u1"), assistant("a1", [call("t1")]), user("u2"), assistant("a2", [call("t2")])]
  expect(turnKeyOf(messages, "a1", "s")).toBe("s:u1")
  expect(turnKeyOf(messages, "a2", "s")).toBe("s:u2")
  expect(turnKeyOf(messages, "not-yet-persisted", "s")).toBe("s:u2")
  expect(turnKeyOf([assistant("a1", [])], "a1", "s")).toBe("s:head")
  expect(turnKeyOf([], "a1", "s")).toBeUndefined()
})

test("reasoningInTurn and premiseFromReasoning recover the drafted paragraph", () => {
  const messages = [user("u1"), assistant("a1", [reasoning("I need the user's decision.\n\nYou can keep the cache or drop it; dropping it costs a rebuild of about ten minutes.")]), assistant("a2", [call("t1")])]
  const r = reasoningInTurn(messages, "a2")
  const premise = premiseFromReasoning(r, opts)!
  expect(premise).toContain("You can keep the cache")
  expect(premiseFromReasoning("Write the premise first, then call the tool.", opts)).toBeUndefined()
  expect(premiseFromReasoning("", opts)).toBeUndefined()
})

test("withPremise returns a new object and never mutates the frozen input", () => {
  const input = Object.freeze({ questions: Object.freeze([Object.freeze({ header: "H", question: "Q?" })]) })
  const out = withPremise(input, "premise") as any
  expect(out).not.toBe(input)
  expect(out.questions[0].question).toBe(`premise\n\n${INJECTED_MARKER}\n\nQ?`)
  expect(withPremise(out, "again")).toBeUndefined()
  expect(withPremise({ questions: [] }, "p")).toBeUndefined()
})

// ---------------------------------------------------------------------------------------------
// Hook flow with a fake ctx

type Hook = (event: any) => Promise<void>

function fakeCtx(options: Record<string, any> = {}, messages: any[] = []) {
  const hooks: Record<string, Hook> = {}
  const tools: Record<string, { description: string }> = { question: { description: "Ask the user." } }
  const logs: string[] = []
  let transform: ((editor: any) => void) | undefined
  const ctx = {
    options: { context_retries: 0, ...options },
    state: { messages, contextThrows: false },
    tool: {
      transform: async (cb: (editor: any) => void) => {
        transform = cb
        return {}
      },
      hook: async (name: string, cb: Hook) => {
        hooks[name] = cb
        return {}
      },
    },
    session: {
      context: async () => {
        if (ctx.state.contextThrows) throw new Error("boom")
        return ctx.state.messages
      },
    },
  }
  const editor = {
    get: (id: string) => (tools[id] ? { id, ...tools[id] } : undefined),
    update: (id: string, fn: (t: any) => void) => fn(tools[id]),
  }
  let n = 0
  const before = async (input: unknown, messageID = "a1", sessionID = "s1") => {
    const event = { tool: "question", sessionID, messageID, id: `call-${++n}`, input }
    try {
      await hooks["execute.before"](event)
      return { ok: true as const, event }
    } catch (error) {
      return { ok: false as const, event, message: (error as Error).message }
    }
  }
  const after = (event: any, outcome: { result?: unknown; error?: unknown }) =>
    hooks["execute.after"]({ ...event, status: outcome.error ? "error" : "completed", ...outcome })
  return {
    ctx,
    logs,
    tools,
    before,
    after,
    replayTransform: () => transform?.(editor),
    setup: () => setupGate(ctx as any, () => 1_000, (m) => logs.push(m)),
  }
}

const turnOf = (premise = para(60)) => [user("u1"), assistant("a1", [text(premise), call("x")])]

test("the tool description gains the rules once, also when replayed", async () => {
  const f = fakeCtx()
  await f.setup()
  f.replayTransform()
  f.replayTransform()
  const d = f.tools.question.description
  expect(d.startsWith("Ask the user.")).toBe(true)
  expect(d.split(RULES_MARKER).length).toBe(2)
  for (const s of ["one question call per turn", "visible paragraph", "answer is a question", "dismissed", "parallelism"]) expect(d).toContain(s)
})

test("one question call per turn, reset by the next user message", async () => {
  const f = fakeCtx({}, turnOf())
  await f.setup()
  const first = await f.before(ask("Cache", "Keep the cache?"))
  expect(first.ok).toBe(true)
  // a second call while the first is still open is rejected too
  const parallel = await f.before(ask("Other", "Something else?"))
  expect(parallel.ok).toBe(false)
  await f.after(first.event, { result: answered(["Yes (Recommended)"]) })
  const second = await f.before(ask("Other", "Something else?"))
  expect(second.ok).toBe(false)
  expect(second.message).toContain("maximum")
  f.ctx.state.messages = [...turnOf(), user("u2"), assistant("a2", [text(para(60))])]
  expect((await f.before(ask("Other", "Something else?"), "a2")).ok).toBe(true)
})

test("max_calls_per_turn 2 allows two, 0 disables the limit", async () => {
  const f = fakeCtx({ max_calls_per_turn: 2 }, turnOf())
  await f.setup()
  const a = await f.before(ask("One", "First?"))
  await f.after(a.event, { result: answered(["No"]) })
  const b = await f.before(ask("Two", "Second?"))
  expect(b.ok).toBe(true)
  await f.after(b.event, { result: answered(["No"]) })
  expect((await f.before(ask("Three", "Third?"))).ok).toBe(false)

  const g = fakeCtx({ max_calls_per_turn: 0 }, turnOf())
  await g.setup()
  for (let i = 0; i < 4; i++) {
    const r = await g.before(ask(`Q ${i}`, `Question ${i}?`))
    expect(r.ok).toBe(true)
    await g.after(r.event, { result: answered(["No"]) })
  }
})

test("a question back stops every further question in the turn", async () => {
  const f = fakeCtx({ max_calls_per_turn: 0 }, turnOf())
  await f.setup()
  const first = await f.before(ask("Fix scope", "How far should the fix go?"))
  await f.after(first.event, { result: answered(["Are both using the same cluster?"]) })
  const next = await f.before(ask("Cluster", "Which cluster?"))
  expect(next.ok).toBe(false)
  expect(next.message).toBe(`${PREFIX} ${MESSAGES.questionBack}`)
  expect(next.message).toContain("The user asked a question back. Answer it in plain reply text and end the turn. Do not ask anything else this turn.")
  // the following turn is free again
  f.ctx.state.messages = [...turnOf(), user("u2"), assistant("a2", [text(para(60))])]
  expect((await f.before(ask("Cluster", "Which cluster?"), "a2")).ok).toBe(true)
})

test("a dismissed question is never asked again in the session, and nothing else that turn", async () => {
  const f = fakeCtx({ max_calls_per_turn: 0 }, turnOf())
  await f.setup()
  const first = await f.before(ask("Bin size", "Which bin size do I print?"))
  await f.after(first.event, { error: dismissedError })
  const sameTurn = await f.before(ask("Colour", "Which colour?"))
  expect(sameTurn.ok).toBe(false)
  expect(sameTurn.message).toContain("dismissed a question this turn")

  f.ctx.state.messages = [...turnOf(), user("u2"), assistant("a2", [text(para(60))])]
  const again = await f.before(ask("bin size", "A reworded question?"), "a2")
  expect(again.ok).toBe(false)
  expect(again.message).toBe(`${PREFIX} The user dismissed this question already. Do not ask it again unless the user brings it up.`)
  const reworded = await f.before(ask("Print", "which bin size do I print"), "a2")
  expect(reworded.ok).toBe(false)
  expect((await f.before(ask("Colour", "Which colour?"), "a2")).ok).toBe(true)
  // other sessions are not affected
  expect((await f.before(ask("Bin size", "Which bin size do I print?"), "a2", "s2")).ok).toBe(true)
})

test("a dismissed question goes through again when the user brings it up", async () => {
  const f = fakeCtx({ max_calls_per_turn: 0 }, turnOf())
  await f.setup()
  const first = await f.before(ask("Bin size", "Which bin size do I print?"))
  await f.after(first.event, { error: dismissedError })
  f.ctx.state.messages = [...turnOf(), { id: "u2", type: "user", text: "Ok, ask me the bin size again.", content: [] }, assistant("a2", [text(para(60))])]
  expect((await f.before(ask("Bin size", "Which bin size do I print?"), "a2")).ok).toBe(true)
  f.ctx.state.messages = [...turnOf(), { id: "u3", type: "user", text: "Carry on.", content: [] }, assistant("a3", [text(para(60))])]
  expect((await f.before(ask("Bin size", "Which bin size do I print?"), "a3")).ok).toBe(true)
})

test("raisedByUser needs the header or question in the user's words", () => {
  const d = { headers: ["bin size"], questions: ["which bin size do i print"] }
  expect(raisedByUser("ask the Bin-Size question again", ask("Bin size", "Which bin size do I print?"), d)).toEqual({ headers: [], questions: [] })
  expect(raisedByUser("carry on", ask("Bin size", "Which bin size do I print?"), d)).toBeUndefined()
  expect(raisedByUser("binsizer", ask("Bin size", "x?"), d)).toBeUndefined()
  expect(latestUserText([user("u1"), { id: "u2", type: "user", text: "hello", content: [] }, assistant("a2", [])], "a2")).toBe("hello")
})

test("the gate's own rejection is not recorded as a dismissal", async () => {
  const f = fakeCtx({}, turnOf())
  await f.setup()
  const a = await f.before(ask("One", "First?"))
  await f.after(a.event, { result: answered(["No"]) })
  const b = await f.before(ask("Two", "Second?"))
  expect(b.ok).toBe(false)
  await f.after(b.event, { error: { type: "unknown", message: b.message } })
  f.ctx.state.messages = [...turnOf(), user("u2"), assistant("a2", [text(para(60))])]
  expect((await f.before(ask("Two", "Second?"), "a2")).ok).toBe(true)
})

test("questions about parallelism are rejected", async () => {
  const f = fakeCtx({}, turnOf())
  await f.setup()
  const r = await f.before(ask("Parallelism", "Should I build it in parallel subagents or sequentially?", ["Parallel (Recommended)", "Sequential"]))
  expect(r.ok).toBe(false)
  expect(r.message).toContain("The user's rule: never ask about parallelism or subagents. Decide it yourself")
  // it does not use up the turn's call
  expect((await f.before(ask("Cache", "Keep the cache?"))).ok).toBe(true)
  const off = fakeCtx({ block_parallelism: false }, turnOf())
  await off.setup()
  expect((await off.before(ask("Parallelism", "Parallel?"))).ok).toBe(true)
})

test("a bare call is never rejected: it gets a premise from the reasoning", async () => {
  const draft = "You decide whether the cache stays; dropping it costs a ten-minute rebuild, keeping it risks stale files."
  const f = fakeCtx({}, [user("u1"), assistant("a1", [reasoning(draft), call("x")])])
  await f.setup()
  const input = Object.freeze(ask("Cache", "Keep the cache?"))
  const r = await f.before(input)
  expect(r.ok).toBe(true)
  expect(r.event.input).not.toBe(input)
  expect((r.event.input as any).questions[0].question).toContain(draft)
  expect((r.event.input as any).questions[0].question).toContain(INJECTED_MARKER)
})

test("a bare call with no usable reasoning goes through unchanged", async () => {
  const f = fakeCtx({}, [user("u1"), assistant("a1", [call("x")])])
  await f.setup()
  const input = ask("Cache", "Keep the cache?")
  const r = await f.before(input)
  expect(r.ok).toBe(true)
  expect(r.event.input).toBe(input)
})

test("a dismissed question with an injected premise is still recognised", async () => {
  const draft = "You decide whether the cache stays; dropping it costs a ten-minute rebuild, keeping it risks stale files."
  const f = fakeCtx({}, [user("u1"), assistant("a1", [reasoning(draft), call("x")])])
  await f.setup()
  const r = await f.before(ask("Cache", "Keep the cache?"))
  await f.after(r.event, { error: dismissedError })
  f.ctx.state.messages = [user("u1"), assistant("a1", []), user("u2"), assistant("a2", [text(para(60))])]
  expect((await f.before(ask("Other header", "Keep the cache?"), "a2")).ok).toBe(false)
})

test("internal failures let the call through", async () => {
  const f = fakeCtx({}, turnOf())
  await f.setup()
  f.ctx.state.contextThrows = true
  expect((await f.before(ask("One", "First?"))).ok).toBe(true)
  expect((await f.before(ask("Two", "Second?"))).ok).toBe(true)
  expect(f.logs.some((l) => l.includes("context lookup failed"))).toBe(true)
  f.ctx.state.contextThrows = false
  f.ctx.state.messages = "not an array" as any
  expect((await f.before(ask("Three", "Third?"))).ok).toBe(true)
  // execute.after with garbage never throws
  await f.after({ tool: "question", sessionID: "s1", messageID: "a1", id: "zz", input: null }, { result: null })
})

test("other tools are ignored", async () => {
  const f = fakeCtx({}, turnOf())
  await f.setup()
  const hooks: any = {}
  const ctx = { ...f.ctx, tool: { ...f.ctx.tool, hook: async (n: string, cb: any) => (hooks[n] = cb) } }
  await setupGate(ctx as any, () => 0, () => {})
  await hooks["execute.before"]({ tool: "shell", sessionID: "s", messageID: "a1", id: "c", input: ask("Parallel", "parallel?") })
})
