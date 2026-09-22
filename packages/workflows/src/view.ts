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
  if ((node.status === "failed" || node.status === "waiting") && node.detail) return clip(node.detail, 36) ?? ""
  if (!node.startedAt) return ""
  return formatElapsed(node.startedAt, node.finishedAt ?? (node.status === "running" ? now : node.startedAt))
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
