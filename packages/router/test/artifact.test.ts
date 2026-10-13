import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("packed plugin loads outside the checkout without runtime SDK resolution", async () => {
  const root = join(tmpdir(), "opencode")
  mkdirSync(root, { recursive: true })
  const scratch = mkdtempSync(join(root, "router-packed-"))
  try {
    execFileSync(process.execPath, ["pm", "pack", "--destination", scratch], { cwd: join(import.meta.dir, ".."), stdio: "pipe" })
    execFileSync("tar", ["-xzf", join(scratch, "phall1-opencode-router-0.1.0.tgz"), "-C", scratch])
    const entry = (await import(join(scratch, "package/server.js"))).default
    expect(entry.id).toBe("phall.router")
    const registered: string[] = []
    const cleanup = await entry.setup({ options: { enabled: false }, rpc: { register: async (definition: { id: string }) => registered.push(definition.id) } })
    expect(registered).toEqual(["phall.router"])
    await cleanup()
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
