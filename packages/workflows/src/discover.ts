import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isWorkflow, type Workflow } from "./dsl.ts"

const FILE_PATTERN = /\.workflow\.(ts|js|mts|mjs)$/

export async function discoverWorkflows(projectDirectory: string): Promise<Workflow[]> {
  const dirs = [
    path.join(projectDirectory, ".opencode", "workflows"),
    path.join(homedir(), ".config", "opencode", "workflows"),
  ]
  const found: Workflow[] = []
  const names = new Set<string>()

  for (const dir of dirs) {
    for (const file of await listWorkflowFiles(dir)) {
      const workflow = await loadWorkflow(file)
      if (!workflow || names.has(workflow.name)) continue
      names.add(workflow.name)
      found.push(workflow)
    }
  }

  return found
}

export async function listWorkflowFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort()
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

export async function loadWorkflow(file: string): Promise<Workflow | undefined> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
  if (!isWorkflow(mod.default)) {
    console.error(`opencode-workflows: ${file} does not default-export a workflow`)
    return undefined
  }
  return mod.default
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}
