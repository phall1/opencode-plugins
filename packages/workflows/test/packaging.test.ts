import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// OpenCode 2.2.6's peers, independent of this package's declarations.
const hostPeers = {
  "@opentui/core": "0.8.1",
  "@opentui/solid": "0.8.1",
  "solid-js": "1.9.17",
}

test("declared peers accept the installed OpenCode host", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json()
  for (const [name, version] of Object.entries(hostPeers)) {
    expect(Bun.semver.satisfies(version, manifest.peerDependencies[name])).toBe(true)
  }
})

test("compiled TUI loads alongside the host OpenTUI runtime", () => {
  const loaded = Bun.spawnSync([
    "bun", "-e",
    'await import("@opentui/core"); const { default: plugin } = await import("./tui.js"); console.log(plugin.id)',
  ], { cwd: new URL("..", import.meta.url).pathname })
  expect(loaded.stderr.toString()).toBe("")
  expect(loaded.exitCode).toBe(0)
  expect(loaded.stdout.toString().trim()).toBe("phall.workflows.cli")
})

test("installed tarball shares the host runtime outside the checkout", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "workflows-runtime-"))
  try {
    const archive = path.join(directory, "plugin.tgz")
    const packed = Bun.spawnSync(["bun", "pm", "pack", "--filename", archive], {
      cwd: new URL("..", import.meta.url).pathname,
    })
    expect(packed.exitCode).toBe(0)
    await writeFile(path.join(directory, "package.json"), JSON.stringify({
      private: true,
      dependencies: { "@phall1/opencode-workflows": archive, ...hostPeers },
    }))
    const installed = Bun.spawnSync(["bun", "install"], { cwd: directory })
    expect(installed.exitCode).toBe(0)
    const loaded = Bun.spawnSync(["bun", "-e", `
      const entry = import.meta.resolve('@phall1/opencode-workflows/tui');
      for (const name of ['@opentui/core', '@opentui/solid', 'solid-js']) {
        const host = Bun.resolveSync(name, process.cwd());
        if (Bun.resolveSync(name, entry) !== host) throw new Error(name + ' has a private runtime');
        await import(host);
      }
      const { default: plugin } = await import(entry);
      console.log(plugin.id);
    `], { cwd: directory })
    expect(loaded.stderr.toString()).toBe("")
    expect(loaded.exitCode).toBe(0)
    expect(loaded.stdout.toString().trim()).toBe("phall.workflows.cli")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

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
