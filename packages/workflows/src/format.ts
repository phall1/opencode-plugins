import type { RunEvent, RunSnapshot } from "./engine.ts"
import type { Workflow } from "./dsl.ts"

export function glyph(status: string): string {
  switch (status) {
    case "done":
      return "✓"
    case "running":
      return "▶"
    case "waiting":
      return "⏸"
    case "failed":
    case "cancelled":
      return "✕"
    default:
      return "·"
  }
}

export function formatList(workflows: Workflow[]): string {
  if (workflows.length === 0) {
    return "No workflows found. Put files in .opencode/workflows/*.workflow.ts"
  }
  const lines = workflows.map((workflow) => `${workflow.name}  (${Object.keys(workflow.nodes).join(" → ")})`)
  return [`Try /workflow ping hi — it finishes in this chat.`, ...lines].join("\n")
}

export function formatRun(run: RunSnapshot): string {
  const head = `${glyph(run.status)} ${run.workflow}  ${run.status}`
  const nodes = run.nodes.map((node) => {
    const output = node.status === "done" ? compact(run.outputs[node.id]) : ""
    return output ? `${glyph(node.status)} ${node.id}  ${output}` : `${glyph(node.status)} ${node.id}`
  })
  return [head, ...nodes, run.error ?? ""].filter(Boolean).join("\n")
}

export function narrateLine(event: RunEvent): string | undefined {
  const run = event.run
  const node = run.nodes.find((item) => item.id === run.cursor)
  switch (event.type) {
    case "node.started":
      if (node?.type === "compute" || node?.type === "decision") return undefined
      return `▶ ${run.workflow} · ${run.cursor}`
    case "run.waiting":
      return `⏸ ${run.workflow} waiting at ${run.cursor}\n/workflow answer …`
    case "run.finished":
      return formatRun(run)
    case "run.failed":
      return `✕ ${run.workflow}  ${run.error ?? "failed"}`
    default:
      return undefined
  }
}

function compact(value: unknown): string {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  try {
    const json = JSON.stringify(value)
    return json.length > 220 ? `${json.slice(0, 217)}...` : json
  } catch {
    return String(value)
  }
}
