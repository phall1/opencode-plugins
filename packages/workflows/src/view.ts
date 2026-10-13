import type { NodeSnapshot, RunSnapshot } from "./engine.ts"
import { glyph } from "./format.ts"

export function footerText(run: RunSnapshot): string {
  if (run.status === "waiting") return `${glyph(run.status)} ${run.workflow} · waiting`
  return `${glyph(run.status)} ${run.workflow} · ${run.cursor}`
}

export function formatElapsed(startedAt: number, finishedAt = Date.now()): string {
  const seconds = Math.floor(Math.max(0, finishedAt - startedAt) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function typeGlyph(type: string): string {
  switch (type) {
    case "agent":
      return "●"
    case "compute":
      return "ƒ"
    case "decision":
      return "◇"
    case "checkpoint":
      return "◆"
    case "wait":
      return "○"
    case "include":
      return "▣"
    default:
      return "·"
  }
}

export function rowTail(node: NodeSnapshot, now = Date.now()): string {
  if (node.decision) return `${node.output && typeof node.output === "object" && "choice" in node.output ? String(node.output.choice) : "?"} · ${node.decision.source}${node.decision.source === "jev" ? ` ${Math.round(node.decision.confidence * 100)}%` : " (uncalibrated)"}`
  if ((node.status === "failed" || node.status === "waiting") && node.detail) return clip(node.detail, 36) ?? ""
  if (!node.startedAt) return ""
  return formatElapsed(node.startedAt, node.finishedAt ?? (node.status === "running" ? now : node.startedAt))
}

export type VisibleStep = { node: NodeSnapshot; label: string; depth: number }

export function visibleSteps(run: RunSnapshot, depth = 0): VisibleStep[] {
  return run.nodes.flatMap((node) => [
    { node, label: node.id, depth },
    ...(node.child ? visibleSteps(node.child, depth + 1) : []),
  ])
}

export function stepDetail(node: NodeSnapshot): string {
  const parts = [`${node.type} · ${node.status}`]
  if (node.sessionID) parts.push(`Session: ${node.sessionID} (enter to open)`)
  if (node.prompt) parts.push(`Prompt:\n${node.prompt}`)
  if (node.decision) parts.push(`Route: ${node.decision.source} · ${node.decision.source === "jev" ? `${Math.round(node.decision.confidence * 100)}% confidence` : "uncalibrated fallback"}\nProbabilities: ${JSON.stringify(node.decision.probabilities)}`)
  if (node.output !== undefined) parts.push(`Output:\n${formatDetail(node.output)}`)
  if (node.detail && !node.prompt) parts.push(`Detail: ${node.detail}`)
  return parts.join("\n\n")
}

function formatDetail(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2) ?? String(output)
  return text.length > 8000 ? `${text.slice(0, 8000)}\n… truncated` : text
}

export function runTitle(run: RunSnapshot): string | undefined {
  const task = taskOf(run.input)
  return task ? clip(task, 72) : undefined
}

export function showGraph(presentation: "panel" | "fullscreen", nodes: number): boolean {
  if (nodes === 0) return false
  if (presentation === "fullscreen") return true
  return nodes <= 4
}

export function panelHints(input: { fullscreen: boolean; waiting: boolean; stoppable: boolean; openable: boolean }): string {
  return [
    "↑↓",
    input.openable ? "enter" : undefined,
    input.waiting ? "a answer" : undefined,
    input.stoppable ? "x stop" : undefined,
    input.fullscreen ? "f list" : "f graph",
    "esc",
  ]
    .filter(Boolean)
    .join("  ")
}

export function runElapsed(run: RunSnapshot, now = Date.now()): string {
  const live = run.status === "running" || run.status === "waiting"
  const end = live ? now : latestFinish(run) ?? now
  return formatElapsed(run.startedAt, end)
}

function latestFinish(run: RunSnapshot): number | undefined {
  return run.nodes.reduce<number | undefined>((latest, node) => {
    if (!node.finishedAt) return latest
    if (latest === undefined || node.finishedAt > latest) return node.finishedAt
    return latest
  }, undefined)
}

export function cursorIndex(run: RunSnapshot): number {
  const index = run.nodes.findIndex((node) => node.id === run.cursor)
  return index >= 0 ? index : 0
}

function taskOf(input: unknown): string | undefined {
  if (typeof input === "string") return input.trim() || undefined
  if (typeof input !== "object" || input === null || !("task" in input)) return undefined
  const task = input.task
  return typeof task === "string" ? task.trim() || undefined : undefined
}

function clip(value: string | undefined, max = 42): string | undefined {
  if (!value) return undefined
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
