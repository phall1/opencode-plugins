import { afterEach, describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { runTeleport, targetsFromInventory } from "../src/tui.tsx"
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
  confirms: string[]
  imports: { id: string; directory: string }[]
  focused: string[]
}

function fakeContext(
  recorded: Recorded,
  options: {
    remotes?: Record<string, unknown>
    documents?: unknown
    inventory?: unknown
    confirm?: boolean
  } = {},
) {
  const imports: { id: string; directory: string }[] = []
  const stored = new Map<string, Transfer>()
  const client = {
    server: { info: async () => ({ version: "2.2.5", urls: ["http://local"] }) },
    config: { get: async () => options.documents ?? [] },
    plugin: { list: async () => options.inventory ?? { data: [] } },
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
        confirm: async (input: { message: string }) => {
          recorded.confirms.push(input.message)
          return options.confirm ?? true
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
    const one = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (one) {
      return Response.json({
        data: { id: decodeURIComponent(one[1]!), title: "Remote fixture", location: { directory: "/remote/repo" } },
      })
    }
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
  return { alerts: [], toasts: [], selects: [], prompts: [], confirms: [], imports: [], focused: [] }
}

describe("targetsFromInventory", () => {
  test("extracts package and local sources for this plugin id only", () => {
    expect(
      targetsFromInventory(
        {
          data: [
            { id: "other.plugin", source: { type: "package", target: "github:other/repo" } },
            { id: "phall.teleport", source: { type: "package", target: "github:phall1/repo#abc::path:packages/teleport" } },
            { id: "phall.teleport", source: { type: "local", path: "/repo/packages/teleport" } },
          ],
        },
        "phall.teleport",
      ),
    ).toEqual(["github:phall1/repo#abc::path:packages/teleport", "/repo/packages/teleport"])
  })

  test("tolerates missing or malformed inventory", () => {
    expect(targetsFromInventory(undefined, "phall.teleport")).toEqual([])
    expect(targetsFromInventory({ data: "nope" }, "phall.teleport")).toEqual([])
    expect(targetsFromInventory({ data: [null, 1, {}] }, "phall.teleport")).toEqual([])
  })
})

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
    expect(seen.confirms).toHaveLength(1)
    expect(seen.confirms[0]).toContain("Plan: Remote \"a\" → This server")
    expect(seen.confirms[0]).toContain("Remote fixture (ses_remote)")
    expect(seen.imports).toEqual([{ id: "ses_remote", directory: "/work/repo" }])
    expect(seen.toasts).toContain("Teleporting session here…")
    expect(seen.focused).toEqual(["ses_remote"])
  })

  test("cancelling the plan confirmation aborts the transfer", async () => {
    globalThis.fetch = remoteFetch()
    const seen = recorded()
    await runTeleport(fakeContext(seen, { remotes: { a: "http://remote:1" }, confirm: false }), "")
    expect(seen.confirms).toHaveLength(1)
    expect(seen.imports).toEqual([])
    expect(seen.toasts).toEqual([])
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

  test("git install specs resolve through the plugin inventory", async () => {
    globalThis.fetch = remoteFetch()
    const seen = recorded()
    const spec = "github:phall1/opencode-plugins#abc123::path:packages/teleport"
    const documents = [{ info: { plugins: [{ package: spec, options: { remotes: { a: "http://remote:1" } } }] } }]
    const inventory = { data: [{ id: "phall.teleport", source: { type: "package", target: spec } }] }
    await runTeleport(fakeContext(seen, { documents, inventory }), "remotes")
    expect(seen.alerts.join("\n")).toContain("a  http://remote:1  OpenCode 2.2.5")
  })

  test("plain help renders usage", async () => {
    const seen = recorded()
    await runTeleport(fakeContext(seen, { remotes: { a: "http://remote:1" } }), "help")
    expect(seen.alerts.join("\n")).toContain("/teleport pull <remote> <session>")
  })
})
