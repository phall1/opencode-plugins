import { TeleportError } from "./errors.ts"
import type { ListInput, ServerApi, SessionSummary } from "./types.ts"

export type ConflictPolicy = "skip" | "fail"

export type TransferStatus = "imported" | "skipped" | "failed" | "unverified"

export type TransferNode = {
  readonly id: string
  readonly title?: string
  readonly sourceDirectory?: string
  readonly directory: string
  readonly messages: number
  readonly status: TransferStatus
  readonly verified?: boolean
  readonly error?: string
  readonly children: readonly TransferNode[]
}

export type TransferReport = {
  readonly root: TransferNode
  readonly sessions: number
  readonly imported: number
  readonly skipped: number
  readonly failed: number
  readonly unverified: number
  readonly messages: number
  readonly truncated: boolean
  readonly durationMs: number
}

export type PlanNode = {
  readonly id: string
  readonly title?: string
  readonly directory?: string
  readonly children: readonly PlanNode[]
}

export type TransferPlan = {
  readonly root: PlanNode
  readonly sessions: number
  readonly truncated: boolean
}

export type PlanOptions = {
  readonly source: ServerApi
  readonly sessionID: string
  readonly includeChildren?: boolean
  readonly maxSessions?: number
}

export type TransferOptions = {
  readonly source: ServerApi
  readonly destination: ServerApi
  readonly sessionID: string
  /** Map every transferred session to this directory. Omit to keep each session's own location. */
  readonly directory?: string
  readonly includeChildren?: boolean
  readonly onConflict?: ConflictPolicy
  readonly verify?: boolean
  readonly maxSessions?: number
}

export const DEFAULT_MAX_SESSIONS = 200
const MAX_PAGES = 50
const PAGE_SIZE = 100

export async function listAll(api: ServerApi, input: ListInput = {}, max = 1_000): Promise<SessionSummary[]> {
  const items: SessionSummary[] = []
  const seen = new Set<string>()
  let cursor = input.cursor
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await api.list({ ...input, limit: input.limit ?? PAGE_SIZE, cursor })
    items.push(...result.items)
    if (items.length >= max) return items.slice(0, max)
    if (result.next === undefined || seen.has(result.next)) return items
    seen.add(result.next)
    cursor = result.next
  }
  return items
}

function messageIDs(messages: readonly unknown[]): string[] {
  return messages.map((message, index) => {
    if (message && typeof message === "object" && typeof (message as { id?: unknown }).id === "string") {
      return (message as { id: string }).id
    }
    return `#${index}`
  })
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Walk a session tree without transferring anything. Metadata only: the
 * preview costs one `get` per root plus one `list` per parent.
 */
export async function planTransfer(options: PlanOptions): Promise<TransferPlan> {
  const includeChildren = options.includeChildren ?? true
  const maxSessions = Math.max(1, Math.min(2_000, options.maxSessions ?? DEFAULT_MAX_SESSIONS))
  const visited = new Set<string>()
  let sessions = 0
  let truncated = false

  async function visit(sessionID: string, known?: SessionSummary): Promise<PlanNode> {
    visited.add(sessionID)
    sessions++
    const info = known ?? (await options.source.get(sessionID))
    const children: PlanNode[] = []
    if (includeChildren) {
      const found = await listAll(options.source, { parentID: sessionID }, maxSessions)
      for (const child of found) {
        if (visited.has(child.id)) continue
        if (sessions >= maxSessions) {
          truncated = true
          break
        }
        children.push(await visit(child.id, child))
      }
    }
    return { id: sessionID, title: info.title, directory: info.directory, children }
  }

  const root = await visit(options.sessionID)
  return { root, sessions, truncated }
}

/**
 * Copy a session and, by default, its whole child-session tree to another
 * server. Parents are imported before children because the destination checks
 * that a child's parent exists. A conflict on `skip` is reported, not hidden:
 * the existing session is left untouched and its children are still considered.
 */
export async function teleport(options: TransferOptions): Promise<TransferReport> {
  const startedAt = Date.now()
  const onConflict = options.onConflict ?? "fail"
  const verify = options.verify ?? true
  const includeChildren = options.includeChildren ?? true
  const maxSessions = Math.max(1, Math.min(2_000, options.maxSessions ?? DEFAULT_MAX_SESSIONS))
  const visited = new Set<string>()
  const counters = { sessions: 0, imported: 0, skipped: 0, failed: 0, unverified: 0, messages: 0 }
  let truncated = false

  async function visit(sessionID: string, known: SessionSummary | undefined): Promise<TransferNode> {
    if (visited.has(sessionID)) {
      throw new TeleportError("invalid", `Session tree contains a cycle at ${sessionID}`)
    }
    if (counters.sessions >= maxSessions) {
      truncated = true
      return node(known, "skipped", {
        directory: options.directory ?? known?.directory ?? "",
        error: `session limit ${maxSessions} reached`,
      })
    }
    visited.add(sessionID)
    counters.sessions++

    const transfer = await options.source.export(sessionID)
    const directory = options.directory ?? transfer.info.location?.directory
    if (!directory) {
      throw new TeleportError(
        "invalid",
        `Session ${sessionID} has no location. Pass an explicit directory for the transfer.`,
      )
    }
    const base = {
      id: sessionID,
      title: transfer.info.title ?? known?.title,
      sourceDirectory: transfer.info.location?.directory,
      directory,
      messages: transfer.messages.length,
    }

    let status: TransferStatus
    let error: string | undefined
    try {
      await options.destination.import(transfer, directory)
      status = "imported"
    } catch (cause) {
      if (cause instanceof TeleportError && cause.code === "conflict" && onConflict === "skip") {
        status = "skipped"
      } else {
        throw cause
      }
    }

    let verified: boolean | undefined
    if (status === "imported" && verify) {
      try {
        const after = await options.destination.export(sessionID)
        verified = sameSequence(messageIDs(transfer.messages), messageIDs(after.messages))
        if (!verified) {
          status = "unverified"
          error = `imported ${after.messages.length} of ${transfer.messages.length} messages`
        }
      } catch (cause) {
        status = "unverified"
        error = `could not read the imported session back: ${errorOf(cause)}`
      }
    }
    if (status === "imported") counters.imported++
    else if (status === "skipped") counters.skipped++
    else if (status === "unverified") counters.unverified++
    if (status !== "skipped") counters.messages += transfer.messages.length

    const children: TransferNode[] = []
    if (includeChildren && !truncated) {
      const found = await listAll(options.source, { parentID: sessionID }, maxSessions)
      for (const child of found) {
        if (visited.has(child.id)) continue
        try {
          children.push(await visit(child.id, child))
        } catch (cause) {
          counters.failed++
          children.push(
            node(child, "failed", { directory: options.directory ?? child.directory ?? "", error: errorOf(cause) }),
          )
        }
      }
    }

    return { ...base, status, verified, error, children }
  }

  const root = await visit(options.sessionID, undefined)
  return {
    root,
    ...counters,
    sessions: counters.sessions,
    truncated,
    durationMs: Date.now() - startedAt,
  }
}

function errorOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

function node(
  known: SessionSummary | undefined,
  status: TransferStatus,
  extra: { directory: string; error?: string },
): TransferNode {
  return {
    id: known?.id ?? "unknown",
    title: known?.title,
    sourceDirectory: known?.directory,
    directory: extra.directory,
    messages: 0,
    status,
    error: extra.error,
    children: [],
  }
}
