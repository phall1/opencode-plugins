import type { EdgeSnapshot, NodeSnapshot, RunSnapshot } from "./engine.ts"

const ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/

export function workflowMermaid(run: RunSnapshot): string {
  const lines = ["flowchart TD"]
  const reserved = new Set(run.nodes.filter((node) => ID_RE.test(node.id)).map((node) => node.id))
  const ids = new Map<string, string>()
  run.nodes.forEach((node, index) => {
    if (ID_RE.test(node.id)) {
      ids.set(node.id, node.id)
      return
    }
    let id = `wf_node_${index}`
    while (reserved.has(id)) id = `_${id}`
    reserved.add(id)
    ids.set(node.id, id)
  })
  for (const node of run.nodes) lines.push(`  ${nodeToken(node, ids.get(node.id)!)}`)
  for (const edge of run.edges) lines.push(`  ${edgeToken(edge, ids)}`)
  lines.push("  classDef active stroke-width:3px", "  classDef complete stroke-width:2px")
  for (const node of run.nodes) {
    if (node.id === run.cursor && (run.status === "running" || run.status === "waiting")) lines.push(`  class ${ids.get(node.id)} active`)
    else if (node.status === "done") lines.push(`  class ${ids.get(node.id)} complete`)
  }
  return lines.join("\n")
}

function nodeToken(node: NodeSnapshot, id: string): string {
  const label = escapeLabel(node.id)
  switch (node.type) {
    case "decision":
      return `${id}{"${label}"}`
    case "checkpoint":
    case "include":
      return `${id}[["${label}"]]`
    case "wait":
      return `${id}(["${label}"])`
    case "agent":
      return `${id}("${label}")`
    default:
      return `${id}["${label}"]`
  }
}

function edgeToken(edge: EdgeSnapshot, ids: Map<string, string>): string {
  const from = ids.get(edge.from) ?? safeId(edge.from)
  const to = ids.get(edge.to) ?? safeId(edge.to)
  if (!edge.label) return `${from} --> ${to}`
  return `${from} -->|"${escapeLabel(edge.label)}"| ${to}`
}

function safeId(id: string): string {
  return ID_RE.test(id) ? id : `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`
}

function escapeLabel(value: string): string {
  return value.replaceAll('"', "'").replaceAll("\n", " ")
}
