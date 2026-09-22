import { describe, expect, test } from "bun:test"
import { compute, defineWorkflow } from "../src/dsl.ts"
import type { RunSnapshot } from "../src/engine.ts"
import { formatList, formatRun, narrateLine } from "../src/format.ts"

const run: RunSnapshot = {
  id: "wf_1",
  workflow: "ping",
  status: "done",
  cursor: "pong",
  input: { task: "hi" },
  outputs: { pong: { ok: true, echo: "hi" } },
  startedAt: 1,
  nodes: [{ id: "pong", type: "compute", status: "done" }],
  edges: [],
}

describe("formatRun", () => {
  test("prints a finished graph with outputs", () => {
    expect(formatRun(run)).toBe(`✓ ping  done\n✓ pong\n{"ok":true,"echo":"hi"}`)
  })
})

describe("formatList", () => {
  test("points at ping", () => {
    const workflow = defineWorkflow({
      name: "ping",
      startAt: "pong",
      nodes: { pong: compute({ run: () => "ok" }) },
      edges: [],
    })
    expect(formatList([workflow])).toContain("ping hi")
    expect(formatList([workflow])).toContain("ping  (pong)")
  })
})

describe("narrateLine", () => {
  test("skips compute node starts", () => {
    expect(narrateLine({ type: "node.started", run })).toBeUndefined()
  })

  test("prints the finished card", () => {
    expect(narrateLine({ type: "run.finished", run })).toBe(formatRun(run))
  })
})
