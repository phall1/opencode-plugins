import { describe, expect, test } from "bun:test"
import { compute, decision, defineWorkflow, checkpoint } from "../src/dsl.ts"
import { nextNode, runWorkflow, type WorkflowHost } from "../src/engine.ts"

const host: WorkflowHost = {
  runAgent: async ({ prompt }) => ({ reply: prompt }),
  runDecision: async ({ choices }) => choices[0] ?? "unknown",
  checkpoint: async () => ({ ok: true }),
}

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

    const run = await runWorkflow({
      workflow,
      input: { task: "hi" },
      host,
    })

    expect(run.status).toBe("done")
    expect(run.outputs.reply).toEqual({ reply: "hi" })
    expect(run.nodes[0]?.status).toBe("done")
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

    const run = await runWorkflow({ workflow, host })
    expect(run.status).toBe("done")
    expect(run.outputs).toEqual({ one: 1, two: 2 })
  })

  test("routes decision exits by choice name", async () => {
    const workflow = defineWorkflow({
      name: "branch",
      startAt: "classify",
      nodes: {
        classify: decision({
          prompt: "pick",
          choices: ["left", "right"],
        }),
        left: compute({ run: () => "L" }),
        right: compute({ run: () => "R" }),
      },
      edges: [
        { from: "classify.left", to: "left" },
        { from: "classify.right", to: "right" },
      ],
    })

    const run = await runWorkflow({
      workflow,
      host: { ...host, runDecision: async () => "right" },
    })
    expect(run.status).toBe("done")
    expect(run.outputs.right).toBe("R")
    expect(run.outputs.left).toBeUndefined()
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

    const run = await runWorkflow({
      workflow,
      host: { ...host, runDecision: async () => "nope" },
    })
    expect(run.status).toBe("failed")
    expect(run.error).toContain("nope")
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

    const run = await runWorkflow({
      workflow,
      host: { ...host, checkpoint: async () => ({ go: true }) },
    })
    expect(run.status).toBe("done")
    expect(run.outputs.done).toEqual({ go: true })
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

    const run = await runWorkflow({
      workflow,
      input: { task: "summarize" },
      host: { ...host, runAgent: async ({ prompt }) => ({ reply: prompt }) },
    })
    expect(run.status).toBe("done")
    expect(run.outputs.reply).toEqual({ reply: "summarize" })
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

    expect(
      nextNode(workflow, "start", {
        input: {},
        outputs: {},
        output: { n: 2 },
      }),
    ).toBe("high")
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

    expect(() =>
      nextNode(workflow, "start", { input: {}, outputs: {}, output: 1 }),
    ).toThrow("multiple default edges")
  })
})
