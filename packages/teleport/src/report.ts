import type { SessionSummary } from "./types.ts"
import type { TransferNode, TransferReport } from "./transfer.ts"

export function formatSessionLine(item: SessionSummary): string {
  const title = item.title?.trim() || "(untitled)"
  const when = item.updated ?? item.created
  const date = when === undefined ? "" : ` ${new Date(when).toISOString().slice(0, 16).replace("T", " ")}`
  const directory = item.directory ? ` — ${item.directory}` : ""
  return `${item.id}  ${title}${date}${directory}`
}

export function formatSessions(items: readonly SessionSummary[], label: string, query?: string): string {
  if (items.length === 0) {
    return query ? `No sessions on ${label} match "${query}".` : `No sessions found on ${label}.`
  }
  return [`Sessions on ${label}:`, ...items.map((item) => `  ${formatSessionLine(item)}`)].join("\n")
}

type Status = "imported" | "skipped" | "failed" | "unverified"

function glyph(status: Status): string {
  if (status === "imported") return "imported"
  if (status === "skipped") return "skipped "
  if (status === "unverified") return "UNVERIFIED"
  return "FAILED "
}

function treeLines(node: TransferNode, depth: number): string[] {
  const indent = "  ".repeat(depth + 1)
  const title = node.title?.trim() || "(untitled)"
  const detail =
    node.status === "skipped" && node.messages === 0
      ? node.error ?? "already on destination"
      : `${node.messages} msg${node.messages === 1 ? "" : "s"}${node.error ? ` — ${node.error}` : ""}`
  const line = `${indent}${glyph(node.status)}  ${node.id}  ${title}  (${detail})`
  return [line, ...node.children.flatMap((child) => treeLines(child, depth + 1))]
}

export function formatReport(report: TransferReport, from: string, to: string): string {
  const totals = [
    `${report.sessions} session${report.sessions === 1 ? "" : "s"}`,
    `${report.messages} message${report.messages === 1 ? "" : "s"}`,
  ]
  if (report.skipped > 0) totals.push(`${report.skipped} skipped`)
  if (report.unverified > 0) totals.push(`${report.unverified} unverified`)
  if (report.failed > 0) totals.push(`${report.failed} failed`)
  if (report.truncated) totals.push("truncated")
  const headline = `Teleported ${from} → ${to} in ${(report.durationMs / 1000).toFixed(1)}s: ${totals.join(", ")}`
  return [headline, ...treeLines(report.root, 0)].join("\n")
}

export function formatRemotes(
  remotes: readonly { name: string; url: string; version?: string; error?: string; source?: string }[],
  local: { url?: string; reason: string; version?: string; error?: string },
): string {
  const lines = ["Teleport remotes:"]
  if (remotes.length === 0) {
    lines.push("  (none configured — add `remotes` to the plugin options or set OPENCODE_TELEPORT_REMOTES)")
  }
  for (const remote of remotes) {
    const state = remote.error ? `unreachable: ${remote.error}` : `OpenCode ${remote.version ?? "?"}`
    lines.push(`  ${remote.name}  ${remote.url}  ${state}`)
  }
  const localState = local.error
    ? `unreachable: ${local.error}`
    : local.url
      ? `${local.url}  OpenCode ${local.version ?? "?"}`
      : `not discovered (${local.reason})`
  lines.push(`  local  ${localState}`)
  return lines.join("\n")
}

export function formatHelp(remoteNames: readonly string[]): string {
  const remotes = remoteNames.length === 0 ? "<none configured>" : remoteNames.join(", ")
  return [
    "Teleport complete OpenCode sessions and their child-session trees between servers.",
    "",
    `Remotes: ${remotes}`,
    "",
    "Usage:",
    "  /teleport                          show remotes and this help",
    "  /teleport remotes                  probe every remote",
    "  /teleport sessions <remote> [query]  list root sessions on a remote",
    "  /teleport pull <remote> <session>  copy a remote session here",
    "  /teleport push <remote> <session>  copy a session to a remote",
    "",
    "Flags: --directory <path> (destination directory), --no-children, --skip-conflicts",
  ].join("\n")
}
