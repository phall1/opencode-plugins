import { describe, expect, test } from "bun:test"
import { requestOf } from "../src/index.ts"

type Input = Parameters<typeof requestOf>[0]

function input(value: Record<string, unknown>): Input {
  return value as Input
}

describe("requestOf", () => {
  test("maps read-only actions", () => {
    expect(requestOf(input({ action: "help" }))).toEqual({ action: "help" })
    expect(requestOf(input({ action: "remotes" }))).toEqual({ action: "remotes" })
    expect(requestOf(input({ action: "sessions", remote: "mini", query: "flaky" }))).toEqual({
      action: "sessions",
      remote: "mini",
      query: "flaky",
    })
  })

  test("pull and push apply the documented defaults", () => {
    expect(requestOf(input({ action: "pull", remote: "mini", sessionID: "ses_1" }))).toEqual({
      action: "pull",
      remote: "mini",
      sessionID: "ses_1",
      directory: undefined,
      includeChildren: true,
      onConflict: "fail",
    })
    expect(
      requestOf(input({ action: "push", remote: "mini", includeChildren: false, onConflict: "skip" })),
    ).toEqual({
      action: "push",
      remote: "mini",
      sessionID: undefined,
      directory: undefined,
      includeChildren: false,
      onConflict: "skip",
    })
  })

  test("a missing remote becomes help, never a transfer", () => {
    expect(requestOf(input({ action: "pull", sessionID: "ses_1" }))).toEqual({
      action: "help",
      note: "pull needs a remote name",
    })
  })
})
