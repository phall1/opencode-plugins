import { TeleportError } from "./errors.ts"
import type { ListInput, ListPage, ServerApi, ServerHealth, SessionInfo, SessionSummary, Transfer } from "./types.ts"

/**
 * The slice of `@opencode/plugin/tui`'s authenticated client teleport needs.
 * Parameters are intentionally loose: the TUI client's generated types are
 * version-specific, while every response is validated here before use.
 */
export type ClientLike = {
  readonly server: {
    readonly info: () => Promise<{ readonly version?: string; readonly urls?: readonly string[] }>
  }
  readonly config: {
    readonly get: () => Promise<unknown>
  }
  readonly plugin: {
    readonly list: () => Promise<unknown>
  }
  readonly session: {
    readonly get: (input: any) => Promise<unknown>
    readonly list: (input?: any) => Promise<{
      readonly data?: readonly unknown[]
      readonly cursor?: { readonly next?: string | null }
    }>
  }
  readonly experimental: {
    readonly session: {
      readonly export: (input: any) => Promise<unknown>
      readonly import: (input: any) => Promise<{ readonly id: string }>
    }
  }
}

function summary(item: unknown): SessionSummary | undefined {
  if (!item || typeof item !== "object") return undefined
  const value = item as Record<string, unknown>
  if (typeof value.id !== "string") return undefined
  const location = value.location as { directory?: unknown } | undefined
  const time = value.time as { created?: unknown; updated?: unknown } | undefined
  return {
    id: value.id,
    parentID: typeof value.parentID === "string" ? value.parentID : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    directory: typeof location?.directory === "string" ? location.directory : undefined,
    created: typeof time?.created === "number" ? time.created : undefined,
    updated: typeof time?.updated === "number" ? time.updated : undefined,
  }
}

/** Local server access for the TUI, where the authenticated client is already in hand. */
export function clientApi(client: ClientLike, label = "This server"): ServerApi {
  return {
    label,
    health: async (): Promise<ServerHealth> => {
      const info = await client.server.info()
      return { version: info.version ?? "unknown", url: info.urls?.[0] }
    },
    get: async (sessionID: string): Promise<SessionSummary> => {
      const item = summary(await client.session.get({ sessionID }))
      if (!item) throw new TeleportError("not_found", `${label} has no session ${sessionID}`)
      return item
    },
    list: async (input: ListInput = {}): Promise<ListPage> => {
      const page = await client.session.list({
        limit: input.limit,
        order: "desc",
        search: input.search,
        parentID: input.parentID,
        directory: input.directory,
        cursor: input.cursor,
      })
      const data = page.data ?? []
      return {
        items: data.map(summary).filter((item): item is SessionSummary => item !== undefined),
        next: page.cursor?.next ?? undefined,
      }
    },
    export: async (sessionID: string): Promise<Transfer> => {
      const data = (await client.experimental.session.export({ sessionID })) as Transfer | undefined
      if (!data || typeof data !== "object" || !data.info || typeof data.info.id !== "string") {
        throw new TeleportError("failed", `${label} returned an invalid session transfer`)
      }
      return data
    },
    import: async (data: Transfer, directory: string): Promise<SessionInfo> => {
      const session = await client.experimental.session.import({ info: data.info, messages: data.messages, location: { directory } })
      return session as SessionInfo
    },
  }
}
