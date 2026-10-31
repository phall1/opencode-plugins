import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverLocal, registrationFiles } from "../src/endpoint.ts"

const roots: string[] = []

function stateHome(): string {
  const root = mkdtempSync(join(tmpdir(), "teleport-endpoint-"))
  roots.push(root)
  mkdirSync(join(root, "opencode"), { recursive: true })
  return root
}

function registration(root: string, name: string, value: unknown): void {
  writeFileSync(join(root, "opencode", name), JSON.stringify(value))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("discoverLocal", () => {
  test("finds the registration owned by this process", () => {
    const root = stateHome()
    registration(root, "service.json", { url: "http://127.0.0.1:4000", pid: 42, password: "pw" })
    const found = discoverLocal({}, { XDG_STATE_HOME: root }, 42)
    expect(found.endpoint).toEqual({
      name: "local",
      url: "http://127.0.0.1:4000",
      username: "opencode",
      password: "pw",
      source: "service",
    })
  })

  test("ignores another process's registration and explains why", () => {
    const root = stateHome()
    registration(root, "service.json", { url: "http://127.0.0.1:4000", pid: 7, password: "pw" })
    const found = discoverLocal({}, { XDG_STATE_HOME: root }, 42)
    expect(found.endpoint).toBeUndefined()
    expect(found.reason).toContain("no registration matches")
    expect(found.reason).toContain("pid 7")
  })

  test("scans channel-specific file names", () => {
    const root = stateHome()
    registration(root, "service-local.json", { url: "http://127.0.0.1:4001", pid: 42 })
    const found = discoverLocal({}, { XDG_STATE_HOME: root }, 42)
    expect(found.endpoint?.url).toBe("http://127.0.0.1:4001")
    expect(found.endpoint?.password).toBeUndefined()
  })

  test("tolerates malformed files and missing directories", () => {
    const root = stateHome()
    writeFileSync(join(root, "opencode", "service.json"), "{not json")
    expect(discoverLocal({}, { XDG_STATE_HOME: root }, 42).endpoint).toBeUndefined()
    expect(discoverLocal({}, { XDG_STATE_HOME: join(root, "missing") }, 42).endpoint).toBeUndefined()
  })

  test("honours an explicit service file", () => {
    const root = stateHome()
    const file = join(root, "custom.json")
    writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:4002", pid: 42 }))
    const found = discoverLocal({}, { OPENCODE_TELEPORT_SERVICE_FILE: file }, 42)
    expect(found.endpoint?.url).toBe("http://127.0.0.1:4002")
    expect(registrationFiles({ OPENCODE_TELEPORT_SERVICE_FILE: file })).toEqual([file])
  })
})
