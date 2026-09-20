import { describe, expect, test } from "bun:test"
import { compute, defineWorkflow } from "../src/dsl.ts"

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
})
