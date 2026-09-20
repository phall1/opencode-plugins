import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { discoverWorkflows } from "../src/discover.ts"

describe("discoverWorkflows", () => {
  test("loads default-exported graphs from .opencode/workflows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ocw-"))
    const dir = path.join(root, ".opencode", "workflows")
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, "echo.workflow.ts")
    await writeFile(
      file,
      `
        export default {
          name: "echo",
          startAt: "reply",
          nodes: { reply: { type: "compute", run: () => ({ ok: true }) } },
          edges: [],
        }
      `,
    )

    const workflows = await discoverWorkflows(root)
    expect(workflows.map((workflow) => workflow.name)).toContain("echo")
  })
})
