import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { checkpoint, compute, decision, defineWorkflow, includeWorkflow, wait } from "../src/dsl.ts"
import { nextNode, runWorkflow, toSnapshot, type WorkflowHost } from "../src/engine.ts"

const host: WorkflowHost = {
  runAgent: (request) => Effect.succeed({ reply: request.prompt }),
  runDecision: (request) => Effect.succeed(request.choices[0] ?? "unknown"),
  checkpoint: () => Effect.succeed({ ok: true }),
  wait: () => Effect.void,
}

const run = (options: Parameters<typeof runWorkflow>[0]) => Effect.runPromise(runWorkflow(options))

describe("runWorkflow", () => {
  test("runs a single compute node to completion", async () => {
    const workflow = defineWorkflow({
      name: "echo",
      startAt: "reply",
      nodes: {
        reply: compute({
          run: ({ input }) => ({ reply: (input as { task: string }).task }),
        }),
      },
      edges: [],
    })

    const result = await run({ workflow, input: { task: "hi" }, host })
    expect(result.status).toBe("done")
    expect(result.outputs.reply).toEqual({ reply: "hi" })
    expect(result.nodes[0]?.status).toBe("done")
    expect(result).not.toHaveProperty("nodeStatus")
    expect(result).not.toHaveProperty("steps")
    expect(result).not.toHaveProperty("error")
    expect(Schema.encodeUnknownExit(Schema.Json)(toSnapshot(result))._tag).toBe("Success")
  })

  test("chains compute nodes through edges", async () => {
    const workflow = defineWorkflow({
      name: "chain",
      startAt: "one",
      nodes: {
        one: compute({ run: () => 1 }),
        two: compute({ run: ({ outputs }) => Number(outputs.one) + 1 }),
      },
      edges: [{ from: "one", to: "two" }],
    })

    const result = await run({ workflow, host })
    expect(result.status).toBe("done")
    expect(result.outputs).toEqual({ one: 1, two: 2 })
  })

  test("routes decision exits by choice name", async () => {
    const workflow = defineWorkflow({
      name: "branch",
      startAt: "classify",
      nodes: {
        classify: decision({ prompt: "pick", choices: ["left", "right"] }),
        left: compute({ run: () => "L" }),
        right: compute({ run: () => "R" }),
      },
      edges: [
        { from: "classify.left", to: "left" },
        { from: "classify.right", to: "right" },
      ],
    })

    const result = await run({
      workflow,
      host: { ...host, runDecision: () => Effect.succeed("right") },
    })
    expect(result.status).toBe("done")
    expect(result.outputs.right).toBe("R")
    expect(result.outputs.left).toBeUndefined()
  })

  test("fails when a decision returns an unknown choice", async () => {
    const workflow = defineWorkflow({
      name: "bad-choice",
      startAt: "classify",
      nodes: {
        classify: decision({ prompt: "pick", choices: ["a", "b"] }),
      },
      edges: [],
    })

    const result = await run({
      workflow,
      host: { ...host, runDecision: () => Effect.succeed("nope") },
    })
    expect(result.status).toBe("failed")
    expect(result.error).toContain("nope")
  })

  test("resumes after a checkpoint answer", async () => {
    const workflow = defineWorkflow({
      name: "gate",
      startAt: "ask",
      nodes: {
        ask: checkpoint({ prompt: "continue?" }),
        done: compute({ run: ({ outputs }) => outputs.ask }),
      },
      edges: [{ from: "ask", to: "done" }],
    })

    const result = await run({
      workflow,
      host: { ...host, checkpoint: () => Effect.succeed({ go: true }) },
    })
    expect(result.status).toBe("done")
    expect(result.outputs.done).toEqual({ go: true })
  })

  test("runs an agent node through the host", async () => {
    const workflow = defineWorkflow({
      name: "talk",
      startAt: "reply",
      nodes: {
        reply: {
          type: "agent",
          prompt: ({ input }) => String((input as { task: string }).task),
          output: "json",
          session: "child",
        },
      },
      edges: [],
    })

    const result = await run({
      workflow,
      input: { task: "summarize" },
      host: { ...host, runAgent: (request) => Effect.succeed({ reply: request.prompt }) },
    })
    expect(result.status).toBe("done")
    expect(result.outputs.reply).toEqual({ reply: "summarize" })
  })

  test("runs included workflows through named exits", async () => {
    const child = defineWorkflow({
      name: "child",
      startAt: "work",
      exits: { ready: { from: "work" } },
      nodes: {
        work: compute({ run: ({ input }) => ({ n: (input as { n: number }).n + 1 }) }),
      },
      edges: [],
    })
    const parent = defineWorkflow({
      name: "parent",
      startAt: "start",
      includes: {
        child: includeWorkflow(child, {
          input: ({ input }) => ({ n: (input as { n: number }).n }),
        }),
      },
      nodes: {
        start: compute({ run: () => "go" }),
        done: compute({ run: ({ outputs }) => outputs.child }),
      },
      edges: [
        { from: "start", to: "child" },
        { from: "child.ready", to: "done" },
      ],
    })

    const result = await run({ workflow: parent, input: { n: 1 }, host })
    expect(result.status).toBe("done")
    expect(result.outputs.done).toMatchObject({ exit: "ready" })
  })

  test("routes uncertain when the host returns that choice", async () => {
    const workflow = defineWorkflow({
      name: "gated",
      startAt: "route",
      nodes: {
        route: decision({ prompt: "go?", choices: ["fix", "blocked"], minConfidence: 0.9 }),
        ask: compute({ run: () => "human" }),
      },
      edges: [
        { from: "route.fix", to: "ask" },
        { from: "route.blocked", to: "ask" },
        { from: "route.uncertain", to: "ask" },
      ],
    })
    const result = await run({
      workflow,
      host: { ...host, runDecision: () => Effect.succeed("uncertain") },
    })
    expect(result.status).toBe("done")
    expect(result.outputs.ask).toBe("human")
  })

  test("wait nodes call the host", async () => {
    let waited = 0
    const workflow = defineWorkflow({
      name: "sleeper",
      startAt: "hold",
      nodes: {
        hold: wait({ ms: 5 }),
        done: compute({ run: () => "ok" }),
      },
      edges: [{ from: "hold", to: "done" }],
    })
    const result = await run({
      workflow,
      host: { ...host, wait: (ms) => Effect.sync(() => void (waited = ms)) },
    })
    expect(result.status).toBe("done")
    expect(waited).toBe(5)
  })
})

describe("nextNode", () => {
  test("uses the first matching when() edge", () => {
    const workflow = defineWorkflow({
      name: "when",
      startAt: "start",
      nodes: {
        start: compute({ run: () => ({ n: 2 }) }),
        low: compute({ run: () => "low" }),
        high: compute({ run: () => "high" }),
      },
      edges: [
        { from: "start", to: "low", when: ({ output }) => (output as { n: number }).n < 2 },
        { from: "start", to: "high", when: ({ output }) => (output as { n: number }).n >= 2 },
      ],
    })

    expect(nextNode(workflow, "start", { input: {}, outputs: {}, output: { n: 2 } })).toBe("high")
  })

  test("throws when multiple default edges exist", () => {
    const workflow = defineWorkflow({
      name: "ambiguous",
      startAt: "start",
      nodes: {
        start: compute({ run: () => 1 }),
        a: compute({ run: () => "a" }),
        b: compute({ run: () => "b" }),
      },
      edges: [
        { from: "start", to: "a" },
        { from: "start", to: "b" },
      ],
    })

    expect(() => nextNode(workflow, "start", { input: {}, outputs: {}, output: 1 })).toThrow(
      "multiple default edges",
    )
  })
})
