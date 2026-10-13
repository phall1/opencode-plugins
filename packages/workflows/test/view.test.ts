import { describe, expect, test } from "bun:test"
import type { RunSnapshot } from "../src/engine.ts"
import { panelHints, runTitle, showGraph, stepDetail, visibleSteps } from "../src/view.ts"

const run: RunSnapshot = {
  id: "wf_1",
  workflow: "autoplan",
  status: "running",
  cursor: "choose",
  startedAt: 1,
  input: { task: "plan a timeout fallback" },
  outputs: {},
  nodes: [],
  edges: [],
}

describe("panel layout", () => {
  test("keeps a long graph out of the side panel", () => {
    expect(showGraph("panel", 6)).toBe(false)
    expect(showGraph("fullscreen", 6)).toBe(true)
    expect(showGraph("panel", 3)).toBe(true)
  })

  test("only advertises actions that work", () => {
    expect(panelHints({ fullscreen: false, waiting: false, stoppable: true, openable: false })).toBe("↑↓  x stop  f graph  esc")
    expect(panelHints({ fullscreen: true, waiting: true, stoppable: true, openable: true })).toBe(
      "↑↓  enter  a answer  x stop  f list  esc",
    )
  })

  test("uses the task as the title", () => {
    expect(runTitle(run)).toBe("plan a timeout fallback")
  })

  test("shows nested steps, decisions and prompts", () => {
    const child = { ...run, workflow: "child", nodes: [{ id: "route", type: "decision" as const, status: "done" as const, prompt: "Why?", output: { choice: "go" }, decision: { source: "generate" as const, confidence: 1, probabilities: { go: 1 } } }] }
    const nested = { ...run, nodes: [{ id: "child", type: "include" as const, status: "done" as const, child }] }
    expect(visibleSteps(nested).map((step) => step.depth)).toEqual([0, 1])
    expect(stepDetail(child.nodes[0]!)).toContain("uncalibrated fallback")
    expect(stepDetail(child.nodes[0]!)).toContain("Why?")
  })
})
