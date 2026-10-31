import { describe, expect, test } from "bun:test"
import { parseCommand, tokenize } from "../src/parse.ts"

describe("parseCommand", () => {
  test("empty input is help", () => {
    expect(parseCommand("   ")).toEqual({ action: "help" })
  })

  test("remotes and help", () => {
    expect(parseCommand("remotes")).toEqual({ action: "remotes" })
    expect(parseCommand("help")).toEqual({ action: "help" })
    expect(parseCommand("nonsense")).toEqual({ action: "help", note: 'unknown command "nonsense"' })
  })

  test("sessions accepts an optional remote and query", () => {
    expect(parseCommand("sessions")).toEqual({ action: "sessions", remote: undefined, query: undefined })
    expect(parseCommand("sessions mini")).toEqual({ action: "sessions", remote: "mini", query: undefined })
    expect(parseCommand("sessions mini failing tests")).toEqual({
      action: "sessions",
      remote: "mini",
      query: "failing tests",
    })
  })

  test("pull parses flags in any position", () => {
    expect(parseCommand("pull mini ses_123")).toEqual({
      action: "pull",
      remote: "mini",
      sessionID: "ses_123",
      directory: undefined,
      includeChildren: true,
      onConflict: "fail",
      dryRun: false,
    })
    expect(parseCommand("pull --skip-conflicts --no-children --directory /work mini ses_123")).toEqual({
      action: "pull",
      remote: "mini",
      sessionID: "ses_123",
      directory: "/work",
      includeChildren: false,
      onConflict: "skip",
      dryRun: false,
    })
    expect(parseCommand("pull --plan mini ses_123")).toMatchObject({ action: "pull", dryRun: true })
    expect(parseCommand("push --dry-run mini")).toMatchObject({ action: "push", dryRun: true })
    expect(parseCommand("pull mini ses_123 --directory=/srv/repo")).toEqual({
      action: "pull",
      remote: "mini",
      sessionID: "ses_123",
      directory: "/srv/repo",
      includeChildren: true,
      onConflict: "fail",
      dryRun: false,
    })
  })

  test("push allows the session to be filled in later", () => {
    expect(parseCommand("push mini")).toEqual({
      action: "push",
      remote: "mini",
      sessionID: undefined,
      directory: undefined,
      includeChildren: true,
      onConflict: "fail",
      dryRun: false,
    })
  })

  test("quoted directory paths survive tokenization", () => {
    expect(parseCommand('pull mini ses_1 --directory "/Users/phall/My Repo"')).toMatchObject({
      action: "pull",
      directory: "/Users/phall/My Repo",
    })
    expect(parseCommand("push mini --directory='/tmp/with space'")).toMatchObject({
      action: "push",
      directory: "/tmp/with space",
    })
    expect(parseCommand("sessions mini \"two words\"")).toMatchObject({ action: "sessions", query: "two words" })
  })

  test("tokenize keeps backslashes and handles unterminated quotes", () => {
    expect(tokenize("a C:\\work\\repo")).toEqual(["a", "C:\\work\\repo"])
    expect(tokenize('pull "unterminated')).toEqual(["pull", "unterminated"])
    expect(tokenize("  pull   mini  ")).toEqual(["pull", "mini"])
  })

  test("a flag instead of a path is rejected", () => {
    expect(parseCommand("pull mini ses_1 --directory --no-children")).toEqual({
      action: "help",
      note: "--directory needs a path",
    })
    expect(parseCommand("pull mini ses_1 --directory=")).toEqual({ action: "help", note: "--directory needs a path" })
  })

  test("missing remote or directory values never start a transfer", () => {
    expect(parseCommand("pull")).toEqual({ action: "help", note: "/pull needs a remote name" })
    expect(parseCommand("pull mini ses_1 --directory")).toEqual({ action: "help", note: "--directory needs a path" })
  })
})
