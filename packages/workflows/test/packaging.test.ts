import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test("packed TSX entrypoints compile without a project tsconfig", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "workflows-package-"))
  try {
    for (const file of ["tui.tsx", "panel.tsx"]) {
      const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8")
      await writeFile(path.join(directory, file), source)
      const built = Bun.spawnSync(["bun", "build", file, "--target=bun", "--external=*", "--outdir=dist"], { cwd: directory })
      expect(built.exitCode).toBe(0)
      const compiled = await readFile(path.join(directory, "dist", file.replace(".tsx", ".js")), "utf8")
      expect(compiled).toContain("@opentui/solid/jsx-dev-runtime")
      expect(compiled).not.toContain('from "react/jsx-dev-runtime"')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
