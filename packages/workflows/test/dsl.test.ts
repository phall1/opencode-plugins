import { describe, expect, test } from "bun:test"
import { compute, decision, defineWorkflow } from "../src/dsl.ts"

describe("defineWorkflow", () => {
  test("rejects reserved names", () => {
    expect(() =>
      defineWorkflow({
        name: "status",
        startAt: "go",
        nodes: { go: compute({ run: () => 1 }) },
        edges: [],
      }),
    ).toThrow("reserved")
  })

  test("rejects a missing start node", () => {
    expect(() =>
      defineWorkflow({
        name: "missing",
        startAt: "nope",
        nodes: { go: compute({ run: () => 1 }) },
        edges: [],
      }),
    ).toThrow("startAt")
  })

  test("rejects missing decision branches and dangling edges", () => {
    expect(() => defineWorkflow({ name: "missing-route", startAt: "route", nodes: { route: decision({ prompt: "?", choices: ["yes", "no"] }), done: compute({ run: () => 1 }) }, edges: [{ from: "route.yes", to: "done" }] })).toThrow('no route for "no"')
    expect(() => defineWorkflow({ name: "dangling", startAt: "go", nodes: { go: compute({ run: () => 1 }) }, edges: [{ from: "go", to: "missing" }] })).toThrow("Invalid edge")
  })

  test("rejects exits from non-terminal nodes", () => {
    expect(() => defineWorkflow({ name: "bad-exit", startAt: "go", nodes: { go: compute({ run: () => 1 }), next: compute({ run: () => 2 }) }, edges: [{ from: "go", to: "next" }], exits: { ready: { from: "go" } } })).toThrow("terminal")
  })
})
