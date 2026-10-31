import { describe, expect, test } from "bun:test"
import { formatHelp, formatRemotes, formatReport, formatSessionLine, formatSessions } from "../src/report.ts"
import type { TransferReport } from "../src/transfer.ts"

const report: TransferReport = {
  root: {
    id: "ses_root",
    title: "Root",
    directory: "/repo",
    messages: 4,
    status: "imported",
    verified: true,
    children: [
      {
        id: "ses_child",
        title: "Child",
        directory: "/repo",
        messages: 2,
        status: "imported",
        verified: true,
        children: [],
      },
      {
        id: "ses_old",
        directory: "/repo",
        messages: 1,
        status: "skipped",
        children: [],
      },
    ],
  },
  sessions: 3,
  imported: 2,
  skipped: 1,
  failed: 0,
  unverified: 0,
  messages: 6,
  truncated: false,
  durationMs: 1234,
}

describe("formatReport", () => {
  test("summarises totals and each node", () => {
    const text = formatReport(report, "Remote", "This server")
    expect(text.split("\n")[0]).toBe("Teleported Remote → This server in 1.2s: 3 sessions, 6 messages, 1 skipped")
    expect(text).toContain("imported  ses_root")
    expect(text).toContain("skipped   ses_old")
    expect(text).toContain("(2 msgs)")
  })

  test("shows failures and truncation", () => {
    const text = formatReport({ ...report, failed: 1, unverified: 2, truncated: true }, "a", "b")
    expect(text).toContain("1 failed")
    expect(text).toContain("2 unverified")
    expect(text).toContain("truncated")
  })
})

describe("session formatting", () => {
  test("empty and query variants", () => {
    expect(formatSessions([], "mini")).toBe("No sessions found on mini.")
    expect(formatSessions([], "mini", "flaky")).toBe('No sessions on mini match "flaky".')
  })

  test("one line per session", () => {
    const line = formatSessionLine({ id: "ses_1", title: "Fix things", directory: "/repo", updated: 0 })
    expect(line).toContain("ses_1")
    expect(line).toContain("Fix things")
    expect(line).toContain("/repo")
  })
})

describe("formatRemotes", () => {
  test("marks unreachable remotes and an undiscovered local server", () => {
    const text = formatRemotes([{ name: "mini", url: "http://mini", error: "connection refused" }], {
      reason: "no service registration",
    })
    expect(text).toContain("unreachable: connection refused")
    expect(text).toContain("not discovered (no service registration)")
  })
})

describe("formatHelp", () => {
  test("lists remotes and the pull/push surface", () => {
    const text = formatHelp(["mini", "laptop"])
    expect(text).toContain("mini, laptop")
    expect(text).toContain("/teleport pull <remote> <session>")
    expect(text).toContain("--no-children")
  })
})
