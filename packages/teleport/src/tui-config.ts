import type { RemoteInput, TeleportOptions } from "./config.ts"

/**
 * TUI plugins do not receive their configured `options` in OpenCode 2.2.x, so
 * the same config entries are read back through the authenticated client. The
 * server plugin still receives options directly; this is the TUI fallback.
 */
export function optionsFromConfig(documents: unknown, targets: readonly string[]): TeleportOptions {
  const remotes: Record<string, unknown> = {}
  let local: unknown
  let timeoutMs: number | undefined
  let found = false
  for (const entry of pluginEntries(documents)) {
    if (!matches(entry.package, targets)) continue
    const options = entry.options
    if (!options || typeof options !== "object" || Array.isArray(options)) continue
    found = true
    const value = options as Record<string, unknown>
    if (value.remotes && typeof value.remotes === "object" && !Array.isArray(value.remotes)) {
      Object.assign(remotes, value.remotes)
    }
    if (local === undefined && (typeof value.local === "string" || isRecord(value.local))) local = value.local
    if (timeoutMs === undefined && typeof value.timeoutMs === "number") timeoutMs = value.timeoutMs
  }
  if (!found) return {}
  return {
    remotes: Object.keys(remotes).length > 0 ? (remotes as Record<string, RemoteInput>) : undefined,
    local: local as TeleportOptions["local"],
    timeoutMs,
  }
}

/** Explicit plugin options win; config documents only fill what is missing. */
export function mergeOptions(explicit: TeleportOptions, fromConfig: TeleportOptions): TeleportOptions {
  const remotes = explicit.remotes ?? fromConfig.remotes
  const local = explicit.local ?? fromConfig.local
  const timeoutMs = explicit.timeoutMs ?? fromConfig.timeoutMs
  return { remotes, local, timeoutMs }
}

function pluginEntries(documents: unknown): { package: string; options?: unknown }[] {
  if (!Array.isArray(documents)) return []
  const result: { package: string; options?: unknown }[] = []
  for (const document of documents) {
    if (!isRecord(document)) continue
    const info = document.info
    if (!isRecord(info) || !Array.isArray(info.plugins)) continue
    for (const entry of info.plugins) {
      if (typeof entry === "string") continue
      if (!isRecord(entry) || typeof entry.package !== "string") continue
      result.push({ package: entry.package, options: entry.options })
    }
  }
  return result
}

function matches(packageSpec: string, targets: readonly string[]): boolean {
  const normalized = normalize(packageSpec)
  return targets.some((target) => normalize(target) === normalized)
}

function normalize(value: string): string {
  return value.replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
