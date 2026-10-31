import { describe, expect, test } from "bun:test"
import { TeleportError } from "../src/errors.ts"
import { listAll, teleport } from "../src/transfer.ts"
import type { ListInput, ListPage, ServerApi, ServerHealth, SessionInfo, Transfer } from "../src/types.ts"

type Stored = {
  readonly info: SessionInfo
  readonly messages: readonly { id: string; text?: string }[]
}

class FakeServer implements ServerApi {
  readonly sessions = new Map<string, Stored>()
  readonly imports: { id: string; directory: string; messages: number }[] = []
  readonly conflicts = new Set<string>()
  readonly importFailures = new Map<string, Error>()
  readonly exportFailures = new Set<string>()
  readonly readBackFailures = new Set<string>()
  drift = false

  constructor(readonly label = "fake") {}

  add(id: string, options: { parentID?: string; directory?: string; messages?: number; title?: string } = {}): void {
    const count = options.messages ?? 2
    this.sessions.set(id, {
      info: {
        id,
        parentID: options.parentID,
        title: options.title ?? `Session ${id}`,
        location: { directory: options.directory ?? "/source/repo" },
      },
      messages: Array.from({ length: count }, (_, index) => ({ id: `msg_${id}_${index}` })),
    })
  }

  async health(): Promise<ServerHealth> {
    return { version: "2.2.5" }
  }

  async list(input: ListInput = {}): Promise<ListPage> {
    const items = [...this.sessions.values()]
      .filter((stored) => {
        if (input.parentID === null) return stored.info.parentID === undefined
        if (input.parentID !== undefined) return stored.info.parentID === input.parentID
        return true
      })
      .filter((stored) => {
        if (!input.search) return true
        return `${stored.info.title ?? ""} ${stored.info.id}`.includes(input.search)
      })
      .map((stored) => ({
        id: stored.info.id,
        parentID: stored.info.parentID,
        title: stored.info.title,
        directory: stored.info.location?.directory,
      }))
    return { items: items.slice(0, input.limit ?? 50) }
  }

  async export(sessionID: string): Promise<Transfer> {
    if (this.readBackFailures.has(sessionID)) throw new TeleportError("unreachable", "read back failed")
    if (this.exportFailures.has(sessionID)) throw new TeleportError("failed", `cannot export ${sessionID}`)
    const stored = this.sessions.get(sessionID)
    if (!stored) throw new TeleportError("not_found", `missing ${sessionID}`)
    return { info: stored.info, messages: stored.messages }
  }

  async import(data: Transfer, directory: string): Promise<SessionInfo> {
    const id = data.info.id
    const failure = this.importFailures.get(id)
    if (failure) throw failure
    if (this.conflicts.has(id) || this.sessions.has(id)) {
      throw new TeleportError("conflict", `Session already exists: ${id}`)
    }
    if (data.info.parentID && !this.sessions.has(data.info.parentID)) {
      throw new TeleportError("not_found", `parent ${data.info.parentID} is missing`)
    }
    const messages = this.drift ? data.messages.slice(0, -1) : data.messages
    this.sessions.set(id, { info: { ...data.info, location: { directory } }, messages: messages as Stored["messages"] })
    this.imports.push({ id, directory, messages: data.messages.length })
    return { ...data.info, location: { directory } }
  }
}

describe("teleport", () => {
  test("imports the root before its children and maps one directory", async () => {
    const source = new FakeServer("source")
    source.add("root")
    source.add("child-a", { parentID: "root" })
    source.add("child-b", { parentID: "root", directory: "/source/other" })
    const destination = new FakeServer("destination")

    const report = await teleport({
      source,
      destination,
      sessionID: "root",
      directory: "/work/repo",
    })

    expect(destination.imports.map((entry) => entry.id)).toEqual(["root", "child-a", "child-b"])
    expect(destination.imports.every((entry) => entry.directory === "/work/repo")).toBe(true)
    expect(report).toMatchObject({ sessions: 3, imported: 3, skipped: 0, failed: 0, unverified: 0, messages: 6 })
    expect(report.root.children.map((child) => child.id).sort()).toEqual(["child-a", "child-b"])
  })

  test("keeps each session's own location when no directory is given", async () => {
    const source = new FakeServer()
    source.add("root", { directory: "/repo" })
    source.add("child", { parentID: "root", directory: "/repo/sub" })
    const destination = new FakeServer()

    await teleport({ source, destination, sessionID: "root" })

    expect(destination.imports).toEqual([
      { id: "root", directory: "/repo", messages: 2 },
      { id: "child", directory: "/repo/sub", messages: 2 },
    ])
  })

  test("a skipped conflict still lets missing children through", async () => {
    const source = new FakeServer()
    source.add("root")
    source.add("child", { parentID: "root" })
    const destination = new FakeServer()
    destination.add("root", { messages: 1 })

    const report = await teleport({ source, destination, sessionID: "root", onConflict: "skip" })

    expect(report.imported).toBe(1)
    expect(report.skipped).toBe(1)
    expect(report.root.status).toBe("skipped")
    expect(report.root.children[0]?.status).toBe("imported")
    expect(destination.sessions.get("root")?.messages).toHaveLength(1)
  })

  test("fail is the default conflict policy", async () => {
    const source = new FakeServer()
    source.add("root")
    const destination = new FakeServer()
    destination.add("root")

    const result = teleport({ source, destination, sessionID: "root" })
    await expect(result).rejects.toBeInstanceOf(TeleportError)
  })

  test("child failures are recorded without aborting siblings", async () => {
    const source = new FakeServer()
    source.add("root")
    source.add("bad", { parentID: "root" })
    source.add("good", { parentID: "root" })
    const destination = new FakeServer()
    destination.importFailures.set("bad", new TeleportError("failed", "disk full"))

    const report = await teleport({ source, destination, sessionID: "root" })

    expect(report.failed).toBe(1)
    expect(report.imported).toBe(2)
    const bad = report.root.children.find((child) => child.id === "bad")
    expect(bad?.status).toBe("failed")
    expect(bad?.error).toContain("disk full")
  })

  test("verification drift is surfaced instead of reported as success", async () => {
    const source = new FakeServer()
    source.add("root", { messages: 3 })
    const destination = new FakeServer()
    destination.drift = true

    const report = await teleport({ source, destination, sessionID: "root" })

    expect(report.unverified).toBe(1)
    expect(report.imported).toBe(0)
    expect(report.root.status).toBe("unverified")
    expect(report.root.error).toContain("2 of 3")
  })

  test("a failed read-back is unverified instead of aborting the tree", async () => {
    const source = new FakeServer()
    source.add("root")
    source.add("child", { parentID: "root" })
    const destination = new FakeServer()
    destination.readBackFailures.add("root")

    const report = await teleport({ source, destination, sessionID: "root" })

    expect(report.root.status).toBe("unverified")
    expect(report.root.error).toContain("could not read the imported session back")
    expect(report.root.children[0]?.status).toBe("imported")
  })

  test("verification can be skipped", async () => {
    const source = new FakeServer()
    source.add("root")
    const destination = new FakeServer()
    destination.drift = true

    const report = await teleport({ source, destination, sessionID: "root", verify: false })

    expect(report.root.status).toBe("imported")
    expect(report.root.verified).toBeUndefined()
  })

  test("child sessions are skipped when includeChildren is false", async () => {
    const source = new FakeServer()
    source.add("root")
    source.add("child", { parentID: "root" })
    const destination = new FakeServer()

    const report = await teleport({ source, destination, sessionID: "root", includeChildren: false })

    expect(destination.imports.map((entry) => entry.id)).toEqual(["root"])
    expect(report.root.children).toEqual([])
  })

  test("the session limit truncates the tree", async () => {
    const source = new FakeServer()
    source.add("root")
    for (const name of ["a", "b", "c"]) source.add(name, { parentID: "root" })
    const destination = new FakeServer()

    const report = await teleport({ source, destination, sessionID: "root", maxSessions: 2 })

    expect(report.truncated).toBe(true)
    expect(report.sessions).toBe(2)
    expect(destination.imports).toHaveLength(2)
  })

  test("a session with no location needs an explicit directory", async () => {
    const source = new FakeServer()
    source.sessions.set("root", { info: { id: "root" }, messages: [] })
    const destination = new FakeServer()

    await expect(teleport({ source, destination, sessionID: "root" })).rejects.toBeInstanceOf(TeleportError)
    await expect(teleport({ source, destination, sessionID: "root", directory: "/work" })).resolves.toBeDefined()
  })
})

describe("listAll", () => {
  test("follows cursors and ignores repeats", async () => {
    const pages: Record<string, ListPage> = {
      first: { items: [{ id: "a" }], next: "second" },
      second: { items: [{ id: "b" }], next: "second" },
    }
    const api = {
      label: "fake",
      list: async (input: ListInput = {}) => pages[input.cursor ?? "first"]!,
    } as unknown as ServerApi

    expect((await listAll(api)).map((item) => item.id)).toEqual(["a", "b"])
  })

  test("stops at the requested maximum", async () => {
    const api = {
      label: "fake",
      list: async () => ({ items: [{ id: "a" }, { id: "b" }], next: "more" }),
    } as unknown as ServerApi

    expect(await listAll(api, {}, 1)).toHaveLength(1)
  })
})
