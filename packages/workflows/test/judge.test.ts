import { describe, expect, test } from "bun:test"
import { applyConfidence, type Judgment } from "../src/judge.ts"

const judgment = (choice: string, confidence: number): Judgment => ({
  choice,
  confidence,
  probabilities: { [choice]: confidence },
  source: "jev",
})

describe("applyConfidence", () => {
  test("keeps the choice when confidence meets the gate", () => {
    expect(applyConfidence(judgment("act", 0.8), 0.65).choice).toBe("act")
  })

  test("routes to uncertain below the gate", () => {
    expect(applyConfidence(judgment("act", 0.2), 0.65).choice).toBe("uncertain")
  })

  test("does not gate when minConfidence is omitted", () => {
    expect(applyConfidence(judgment("act", 0.1)).choice).toBe("act")
  })
})
