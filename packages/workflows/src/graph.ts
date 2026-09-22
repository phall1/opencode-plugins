import type { EdgeSnapshot, NodeSnapshot, RunSnapshot } from "./engine.ts"

const ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/

export function workflowMermaid(run: RunSnapshot): string {
  const lines = ["flowchart TD"]
  for (const node of run.nodes) lines.push(`  ${nodeToken(node)}`)
  for (const edge of run.edges) lines.push(`  ${edgeToken(edge)}`)
  return lines.join("\n")
}

function nodeToken(node: NodeSnapshot): string {
  const id = safeId(node.id)
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

function edgeToken(edge: EdgeSnapshot): string {
  const from = safeId(edge.from)
  const to = safeId(edge.to)
  if (!edge.label) return `${from} --> ${to}`
  return `${from} -->|"${escapeLabel(edge.label)}"| ${to}`
}

function safeId(id: string): string {
  return ID_RE.test(id) ? id : `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`
}

function escapeLabel(value: string): string {
  return value.replaceAll('"', "'").replaceAll("\n", " ")
}
