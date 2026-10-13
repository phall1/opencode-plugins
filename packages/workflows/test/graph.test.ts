import { describe, expect, test } from "bun:test"
import { decision, defineWorkflow } from "../src/dsl.ts"
import { edgeSnapshots } from "../src/engine.ts"
import { workflowMermaid } from "../src/graph.ts"
import type { RunSnapshot } from "../src/engine.ts"

const run: RunSnapshot = {
  id: "wf_1",
  workflow: "branch",
  status: "running",
  cursor: "classify",
  startedAt: 1,
  input: {},
  outputs: {},
  nodes: [
    { id: "classify", type: "decision", status: "running" },
    { id: "left", type: "agent", status: "pending" },
  ],
  edges: [
    { from: "classify", to: "left", label: "left" },
    { from: "classify", to: "right", label: "right" },
  ],
}

describe("workflowMermaid", () => {
  test("renders a flowchart with typed nodes and labeled edges", () => {
    const source = workflowMermaid(run)
    expect(source.startsWith("flowchart TD")).toBe(true)
    expect(source).toContain('classify{"classify"}')
    expect(source).toContain('left("left")')
    expect(source).toContain('classify -->|"left"| left')
  })

  test("uses distinct diagram IDs even when labels normalize identically", () => {
    const diagram = workflowMermaid({ ...run, nodes: [
      { id: "a/b", type: "compute", status: "done" },
      { id: "a_b", type: "compute", status: "pending" },
    ], edges: [{ from: "a/b", to: "a_b" }] })
    expect(diagram).toContain('wf_node_0["a/b"]')
    expect(diagram).toContain('a_b["a_b"]')
    expect(diagram).toContain("wf_node_0 --> a_b")
  })
})

describe("edgeSnapshots", () => {
  test("splits choice suffixes into edge labels", () => {
    const workflow = defineWorkflow({
      name: "branch",
      startAt: "classify",
      nodes: {
        classify: decision({ prompt: "pick", choices: ["left", "right"] }),
        left: decision({ prompt: "end", choices: [] }),
        right: decision({ prompt: "end", choices: [] }),
      },
      edges: [
        { from: "classify.left", to: "left" },
        { from: "classify.right", to: "right" },
      ],
    })
    expect(edgeSnapshots(workflow)).toEqual([
      { from: "classify", to: "left", label: "left" },
      { from: "classify", to: "right", label: "right" },
    ])
  })
})
