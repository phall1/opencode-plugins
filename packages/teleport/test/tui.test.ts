import { afterEach, describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { runTeleport } from "../src/tui.tsx"
import type { Transfer } from "../src/types.ts"

const fixture: Transfer = {
  info: { id: "ses_remote", title: "Remote fixture", location: { directory: "/remote/repo" } },
  messages: [{ id: "m1" }, { id: "m2" }],
}

type Recorded = {
  alerts: string[]
  toasts: string[]
  selects: string[]
  prompts: string[]
  imports: { id: string; directory: string }[]
  focused: string[]
}

function fakeContext(recorded: Recorded, options: { remotes?: Record<string, unknown>; documents?: unknown } = {}) {
  const imports: { id: string; directory: string }[] = []
  const stored = new Map<string, Transfer>()
  const client = {
    server: { info: async () => ({ version: "2.2.5", urls: ["http://local"] }) },
    config: { get: async () => options.documents ?? [] },
    session: {
      list: async () => ({
        data: [{ id: "ses_local", title: "Local session", location: { directory: "/repo" }, time: { updated: 0 } }],
        cursor: {},
      }),
    },
    experimental: {
      session: {
        export: async (input: { sessionID: string }) =>
          stored.get(input.sessionID) ?? {
            info: { id: input.sessionID, title: "Local session", location: { directory: "/repo" } },
            messages: [],
          },
        import: async (input: { info: { id: string }; messages: readonly unknown[]; location: { directory: string } }) => {
          imports.push({ id: input.info.id, directory: input.location.directory })
          stored.set(input.info.id, { info: input.info, messages: input.messages })
          return { id: input.info.id }
        },
      },
    },
  }
  const context = {
    options: options.remotes ? { remotes: options.remotes } : {},
    client,
    location: { directory: "/work/repo" },
    data: { location: { default: () => ({ directory: "/work/repo" }) } },
    keymap: { layer: () => {} },
    ui: {
      dialog: {
        select: async (input: { title: string; options: { value: string }[] }) => {
          recorded.selects.push(input.title)
          return input.options[0]?.value
        },
        alert: async (input: { message: string }) => {
          recorded.alerts.push(input.message)
        },
        prompt: async () => {
          recorded.prompts.push("directory")
          return "/work/repo"
        },
      },
      toast: {
        show: (input: { message: string }) => {
          recorded.toasts.push(input.message)
        },
      },
      tabs: {
        focus: (id: string) => {
          recorded.focused.push(id)
          return true
        },
        list: () => [{ sessionID: "ses_driver", active: true }],
      },
      router: { current: () => ({ type: "session", sessionID: "ses_driver" }) },
    },
  }
  recorded.imports = imports
  return context as never
}

function remoteFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === "/api/info") return Response.json({ version: "2.2.5" })
    if (url.pathname === "/api/session") return Response.json({ data: [fixture.info], cursor: {} })
    if (url.pathname.endsWith("/export")) return Response.json({ data: fixture })
    return Response.json({ _tag: "NotFound" }, { status: 404 })
  }) as unknown as typeof fetch
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function recorded(): Recorded {
  return { alerts: [], toasts: [], selects: [], prompts: [], imports: [], focused: [] }
}

describe("TUI teleport flow", () => {
  test("no remotes explains how to configure them", async () => {
    const seen = recorded()
    await runTeleport(fakeContext(seen, { remotes: undefined }), "")
    expect(seen.alerts.join("\n")).toContain("No remotes are configured")
  })

  test("the interactive pull runs end to end", async () => {
    globalThis.fetch = remoteFetch()
    const seen = recorded()
    await runTeleport(fakeContext(seen, { remotes: { a: "http://remote:1" } }), "")

    expect(seen.selects).toEqual(["Teleport", "Session to pull"])
    expect(seen.prompts).toEqual(["directory"])
    expect(seen.imports).toEqual([{ id: "ses_remote", directory: "/work/repo" }])
    expect(seen.toasts).toContain("Teleporting session here…")
    expect(seen.focused).toEqual(["ses_remote"])
  })

  test("remotes renders the probe", async () => {
    globalThis.fetch = remoteFetch()
    const seen = recorded()
    await runTeleport(fakeContext(seen, { remotes: { a: "http://remote:1" } }), "remotes")
    expect(seen.alerts.join("\n")).toContain("Teleport remotes:")
    expect(seen.alerts.join("\n")).toContain("a  http://remote:1  OpenCode 2.2.5")
  })

  test("remotes are recovered from config documents when options are absent", async () => {
    globalThis.fetch = remoteFetch()
    const seen = recorded()
    const packageRoot = fileURLToPath(new URL("..", import.meta.url))
    const documents = [{ info: { plugins: [{ package: packageRoot, options: { remotes: { a: "http://remote:1" } } }] } }]
    await runTeleport(fakeContext(seen, { documents }), "remotes")
    expect(seen.alerts.join("\n")).toContain("a  http://remote:1  OpenCode 2.2.5")
  })

  test("plain help renders usage", async () => {
    const seen = recorded()
    await runTeleport(fakeContext(seen, { remotes: { a: "http://remote:1" } }), "help")
    expect(seen.alerts.join("\n")).toContain("/teleport pull <remote> <session>")
  })
})
