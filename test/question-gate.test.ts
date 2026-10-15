import { expect, test } from "bun:test"
import {
  INJECTED_MARKER,
  withPremise,
  partTypes,
  premiseFromReasoning,
  reasoningInTurn,
  recordRejection,
  rejection,
  rejectionsSoFar,
  resolveOptions,
  textBefore,
  textInTurn,
  turnKeyOf,
  type TurnState,
} from "../index.ts"

const opts = resolveOptions()
const user = (id: string) => ({ id, type: "user", content: [] })
const assistant = (id: string, content: any[]) => ({ id, type: "assistant", content })
const text = (t: string) => ({ type: "text", text: t })
const reasoning = (t: string) => ({ type: "reasoning", text: t })
const call = (id: string) => ({ type: "tool", id })
const para = (n: number) => "x".repeat(n)

test("defaults", () => {
  expect(opts.minChars).toBe(40)
  expect(opts.maxRejectionsPerTurn).toBe(1)
  expect(opts.injectPremise).toBe(true)
  expect(opts.describeTool).toBe(true)
  expect(resolveOptions({ max_rejections_per_turn: 0 }).maxRejectionsPerTurn).toBe(0)
  expect(resolveOptions({ inject_premise: false }).injectPremise).toBe(false)
  expect([...resolveOptions({ tools: ["question", "ask"] }).tools]).toEqual(["question", "ask"])
})

test("textBefore counts only text before the gated call", () => {
  const m = assistant("m1", [text("abc"), call("t1"), text("ignored after"), call("t2")])
  expect(textBefore(m, "t1")).toBe(3)
  expect(textBefore(m, "t2")).toBe(3 + "ignored after".length)
  expect(textBefore(assistant("m", []), "t1")).toBe(0)
  expect(textBefore({ id: "m", type: "assistant" }, "t1")).toBe(0)
})

test("textInTurn spans the whole turn and stops at the user message", () => {
  const messages = [
    user("u0"),
    assistant("a0", [text("from an older turn, must not count")]),
    user("u1"),
    assistant("a1", [text(para(100)), call("t0")]),
    assistant("a2", [reasoning("thinking only"), call("t1")]),
  ]
  expect(textInTurn(messages, "a2", "t1")).toBe(100)
  expect(textInTurn(messages, "a1", "t0")).toBe(100)
  expect(textInTurn(messages, "missing", "t1")).toBe(-1)
})

test("textInTurn ignores reasoning entirely", () => {
  const messages = [user("u1"), assistant("a1", [reasoning(para(5000)), call("t1")])]
  expect(textInTurn(messages, "a1", "t1")).toBe(0)
})

test("turnKeyOf keys on the opening user message and resets per prompt", () => {
  const messages = [user("u1"), assistant("a1", [call("t1")]), user("u2"), assistant("a2", [call("t2")])]
  expect(turnKeyOf(messages, "a1", "s")).toBe("s:u1")
  expect(turnKeyOf(messages, "a2", "s")).toBe("s:u2")
  expect(turnKeyOf(messages, "a1", "s")).not.toBe(turnKeyOf(messages, "a2", "s"))
  expect(turnKeyOf([assistant("a1", [])], "a1", "s")).toBe("s:head")
  expect(turnKeyOf(messages, "unknown", "s")).toBe("s:u2")
})

test("reasoningInTurn gathers the turn's reasoning, newest last, and stops at the user message", () => {
  const messages = [
    user("u0"),
    assistant("a0", [reasoning("older turn, must not count")]),
    user("u1"),
    assistant("a1", [reasoning("first step draft"), call("t0")]),
    assistant("a2", [call("t1")]),
  ]
  // the retry step has no reasoning of its own: the draft must still be found
  expect(reasoningInTurn(messages, "a2")).toBe("first step draft")
  expect(reasoningInTurn(messages, "a1")).toBe("first step draft")
  expect(reasoningInTurn(messages, "missing")).toBe("")
  expect(reasoningInTurn([user("u1"), assistant("a1", [call("t")])], "a1")).toBe("")
})

test("premiseFromReasoning takes whole trailing paragraphs of the reasoning", () => {
  const r = "early planning noise\n\nI checked the files.\n\nThe landing page is just a sign-in box; tell me how far to take it before I start, since the scope varies a lot."
  const p = premiseFromReasoning(r, opts)!
  expect(p).toContain("tell me how far to take it")
  expect(p).not.toContain("early planning noise")
})

test("premiseFromReasoning grows until premise_min_chars and respects the cap", () => {
  const p = premiseFromReasoning([para(300), para(30), para(30)].join("\n\n"), opts)!
  expect(p.length).toBeGreaterThanOrEqual(opts.premiseMinChars)
  expect(p.length).toBeLessThanOrEqual(opts.premiseMaxChars)
  expect(premiseFromReasoning(para(5000), opts)!.length).toBe(opts.premiseMaxChars)
})

test("premiseFromReasoning returns undefined with no usable reasoning", () => {
  expect(premiseFromReasoning("", opts)).toBeUndefined()
  expect(premiseFromReasoning("   \n\n  ", opts)).toBeUndefined()
})

test("withPremise returns a new input and never mutates the frozen original", () => {
  const input = Object.freeze({
    questions: Object.freeze([
      Object.freeze({ header: "Scope", question: "How far?" }),
      Object.freeze({ header: "Other", question: "Second?" }),
    ]),
  })
  const out: any = withPremise(input, "Here is why I ask.")
  expect(out).toBeDefined()
  expect(out).not.toBe(input)
  expect((input as any).questions[0].question).toBe("How far?")
  expect(out.questions[0].question).toStartWith("Here is why I ask.")
  expect(out.questions[0].question).toContain(INJECTED_MARKER)
  expect(out.questions[0].question).toEndWith("How far?")
  expect(out.questions[1]).toEqual({ header: "Other", question: "Second?" })
  expect(out.questions[0].header).toBe("Scope")
})

test("withPremise is idempotent and preserves sibling keys", () => {
  const first: any = withPremise({ questions: [{ header: "H", question: "Q" }], extra: 1 }, "premise")
  expect(first.extra).toBe(1)
  expect(withPremise(first, "another premise")).toBeUndefined()
})

test("withPremise declines every malformed input shape", () => {
  expect(withPremise(undefined, "p")).toBeUndefined()
  expect(withPremise({}, "p")).toBeUndefined()
  expect(withPremise({ questions: [] }, "p")).toBeUndefined()
  expect(withPremise({ questions: "nope" }, "p")).toBeUndefined()
  expect(withPremise({ questions: [null] }, "p")).toBeUndefined()
  const noText: any = withPremise({ questions: [{ header: "H" }] }, "premise")
  expect(noText.questions[0].question).toBe("premise\n\n" + INJECTED_MARKER)
})

test("one nudge per turn, then through", () => {
  const turns = new Map<string, TurnState>()
  const now = 1_000_000
  expect(rejectionsSoFar(turns, "s:u1", now, opts.turnWindowMs)).toBe(0)
  expect(recordRejection(turns, "s:u1", now, opts.turnWindowMs)).toBe(1)
  expect(rejectionsSoFar(turns, "s:u1", now, opts.turnWindowMs)).toBe(1)
  expect(rejectionsSoFar(turns, "s:u1", now, opts.turnWindowMs) < opts.maxRejectionsPerTurn).toBe(false)
  // next turn in the same session starts clean
  expect(rejectionsSoFar(turns, "s:u2", now, opts.turnWindowMs)).toBe(0)
})

test("stale turns expire and the map stays bounded", () => {
  const turns = new Map<string, TurnState>()
  recordRejection(turns, "s:old", 0, opts.turnWindowMs)
  expect(rejectionsSoFar(turns, "s:old", opts.turnWindowMs + 1, opts.turnWindowMs)).toBe(0)
  for (let i = 0; i < 700; i++) recordRejection(turns, `s:${i}`, 2_000_000 + i, opts.turnWindowMs)
  expect(turns.size).toBeLessThanOrEqual(500)
  expect(turns.has("s:old")).toBe(false)
})

test("rejection text names the thinking block only when the step is reasoning-only", () => {
  expect(rejection("question", 40, 0, true)).toContain("inside the thinking block")
  expect(rejection("question", 40, 0, true)).toContain("This is the only retry")
  expect(rejection("question", 40, 12, false)).not.toContain("inside the thinking block")
  expect(rejection("question", 40, 12, false)).toContain("12 visible characters")
})

test("partTypes reports the step shape for the journal", () => {
  expect(partTypes(assistant("a", [reasoning("r"), call("t")]))).toBe("reasoning,tool")
  expect(partTypes(assistant("a", [text("t"), call("t")]))).toBe("text,tool")
  expect(partTypes(undefined)).toBe("-")
})

test("premiseFromReasoning prefers the paragraph that addresses the user", () => {
  const r = [
    "Let me check the files first.",
    "The landing page is just a sign-in box; tell me how far you want to take it before I start.",
    "I will wait for the answer and then plan the work.",
  ].join("\n\n")
  const p = premiseFromReasoning(r, opts)!
  expect(p).toContain("how far you want to take it")
  expect(p).not.toContain("plan the work")
})

test("premiseFromReasoning drops gate self-talk and declines when only self-talk remains", () => {
  const meta = "I should add a short visible paragraph explaining why this choice matters before asking the question."
  expect(premiseFromReasoning(meta, opts)).toBeUndefined()
  const mixed = `${meta}\n\nRed is warm and makes the room cosier, blue is cool and makes it feel bigger; your pick decides the filament.`
  const p = premiseFromReasoning(mixed, opts)!
  expect(p).not.toContain("visible paragraph")
  expect(p).toContain("your pick decides")
})
