import { describe, expect, test } from "bun:test"
import { runAction, type ActionDeps } from "../src/actions.ts"
import { TeleportError } from "../src/errors.ts"
import type { ListInput, ListPage, ServerApi, ServerHealth, SessionInfo, Transfer } from "../src/types.ts"

const transfer: Transfer = {
  info: { id: "ses_remote", title: "Remote session", location: { directory: "/remote/repo" } },
  messages: [{ id: "m1" }, { id: "m2" }],
}

class LocalServer implements ServerApi {
  readonly label = "This server"
  readonly imports: { id: string; directory: string }[] = []
  readonly sessions = new Map<string, Transfer>([
    ["ses_local", { info: { id: "ses_local", title: "Local session", location: { directory: "/repo" } }, messages: [] }],
  ])

  async health(): Promise<ServerHealth> {
    return { version: "2.2.5" }
  }

  async list(input: ListInput = {}): Promise<ListPage> {
    return {
      items: [...this.sessions.values()]
        .filter((entry) => !input.search || entry.info.id.includes(input.search))
        .map((entry) => ({ id: entry.info.id, title: entry.info.title })),
    }
  }

  async export(sessionID: string): Promise<Transfer> {
    const found = this.sessions.get(sessionID)
    if (!found) throw new TeleportError("not_found", "missing")
    return found
  }

  async import(data: Transfer, directory: string): Promise<SessionInfo> {
    this.imports.push({ id: data.info.id, directory })
    this.sessions.set(data.info.id, data)
    return { ...data.info, location: { directory } }
  }
}

function remoteFetch(options: { fail?: boolean; version?: string } = {}): typeof fetch {
  let imported: Transfer | undefined
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (options.fail) throw new Error("connection refused")
    if (url.pathname === "/api/info") return Response.json({ version: options.version ?? "2.2.5" })
    if (url.pathname === "/api/session") {
      return Response.json({ data: [{ id: transfer.info.id, title: transfer.info.title }], cursor: {} })
    }
    if (url.pathname.endsWith("/export")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-2) ?? "")
      if (imported && imported.info.id === id) return Response.json({ data: imported })
      return Response.json({ data: { ...transfer, info: { ...transfer.info, id } } })
    }
    if (url.pathname === "/api/experimental/session/import") {
      imported = { info: { id: "ses_local", location: { directory: "/remote/repo" } }, messages: [] }
      return Response.json({ data: imported.info })
    }
    return Response.json({ _tag: "NotFound" }, { status: 404 })
  }) as unknown as typeof fetch
}

function deps(overrides: Omit<Partial<ActionDeps>, "local"> & { local?: ServerApi } = {}): ActionDeps {
  const { local, ...rest } = overrides
  return {
    options: { remotes: { mini: "http://mini:1" } },
    env: {},
    local: () => local,
    localReason: () => "no service registration",
    defaultDirectory: "/repo",
    currentSessionID: "ses_local",
    fetch: remoteFetch(),
    ...rest,
  }
}

describe("runAction", () => {
  test("remotes probes each remote and the local server", async () => {
    const result = await runAction({ action: "remotes" }, deps({ local: new LocalServer() }))
    expect(result.ok).toBe(true)
    expect(result.text).toContain("mini")
    expect(result.text).toContain("OpenCode 2.2.5")
    expect(result.text).toContain("local")
  })

  test("remotes reports a dead remote without failing the whole probe", async () => {
    const result = await runAction({ action: "remotes" }, deps({ fetch: remoteFetch({ fail: true }) }))
    expect(result.ok).toBe(true)
    expect(result.text).toContain("unreachable")
  })

  test("sessions lists a remote", async () => {
    const result = await runAction({ action: "sessions", remote: "mini" }, deps())
    expect(result.ok).toBe(true)
    expect(result.text).toContain("ses_remote")
    expect(result.metadata.count).toBe(1)
  })

  test("sessions can list the local server", async () => {
    const result = await runAction({ action: "sessions" }, deps({ local: new LocalServer() }))
    expect(result.ok).toBe(true)
    expect(result.text).toContain("ses_local")
  })

  test("pull copies a remote session into the default directory", async () => {
    const local = new LocalServer()
    const result = await runAction({ action: "pull", remote: "mini", sessionID: "ses_remote", includeChildren: false, onConflict: "fail" }, deps({ local }))
    expect(result.ok).toBe(true)
    expect(result.text).toContain("Teleported")
    expect(local.imports).toEqual([{ id: "ses_remote", directory: "/repo" }])
    expect(result.metadata).toMatchObject({ action: "pull", sessionID: "ses_remote", imported: 1, messages: 2 })
  })

  test("push copies the current session to a remote", async () => {
    const result = await runAction(
      { action: "push", remote: "mini", includeChildren: false, onConflict: "fail" },
      deps({ local: new LocalServer() }),
    )
    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ action: "push", sessionID: "ses_local" })
  })

  test("unknown remotes fail with a configuration error", async () => {
    const result = await runAction({ action: "pull", remote: "nope", sessionID: "ses_x", includeChildren: true, onConflict: "fail" }, deps({ local: new LocalServer() }))
    expect(result.ok).toBe(false)
    expect(result.metadata.code).toBe("not_configured")
    expect(result.text).toContain("Unknown remote")
  })

  test("missing local access is explained", async () => {
    const result = await runAction({ action: "sessions" }, deps())
    expect(result.ok).toBe(false)
    expect(result.metadata.code).toBe("local_unavailable")
    expect(result.text).toContain("local server")
  })

  test("pull without a session id fails fast", async () => {
    const result = await runAction({ action: "pull", remote: "mini", includeChildren: true, onConflict: "fail" }, deps({ local: new LocalServer() }))
    expect(result.ok).toBe(false)
    expect(result.metadata.code).toBe("invalid")
  })

  test("help lists configured remotes", async () => {
    const result = await runAction({ action: "help", note: "try again" }, deps())
    expect(result.ok).toBe(true)
    expect(result.text).toContain("try again")
    expect(result.text).toContain("mini")
    expect(result.text).toContain("/teleport pull")
  })
})
