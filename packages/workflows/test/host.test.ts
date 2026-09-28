import { expect, test } from "bun:test"
import { parseChoice } from "../src/host.ts"

test("fallback decision parser never treats a negated sentence as a pass", () => {
  const choices = ["pass", "fix", "blocked"]
  expect(parseChoice("the tests did not pass", choices)).toBeUndefined()
  expect(parseChoice('{"choice":"fix"}', choices)).toBe("fix")
  expect(parseChoice("pass", choices)).toBe("pass")
})
