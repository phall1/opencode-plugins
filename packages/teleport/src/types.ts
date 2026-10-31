/** Session data as OpenCode projects it over its transfer API. Unknown fields ride along untouched. */
export type SessionInfo = {
  readonly id: string
  readonly parentID?: string
  readonly title?: string
  readonly location?: { readonly directory?: string }
  readonly time?: { readonly created?: number; readonly updated?: number; readonly [key: string]: unknown }
  readonly [key: string]: unknown
}

export type Transfer = {
  readonly info: SessionInfo
  readonly messages: readonly unknown[]
}

export type SessionSummary = {
  readonly id: string
  readonly parentID?: string
  readonly title?: string
  readonly directory?: string
  readonly created?: number
  readonly updated?: number
}

export type ListInput = {
  readonly parentID?: string | null
  readonly search?: string
  readonly limit?: number
  readonly cursor?: string
  readonly directory?: string
}

export type ListPage = {
  readonly items: readonly SessionSummary[]
  /** Opaque cursor for the next page; absent when the list is exhausted. */
  readonly next?: string
}

export type ServerHealth = {
  readonly version: string
  readonly url?: string
}

/** The three capabilities teleport needs from either side of a transfer. */
export interface ServerApi {
  readonly label: string
  /** Base URL when the surface knows it, for diagnostics. */
  readonly url?: string
  readonly list: (input?: ListInput) => Promise<ListPage>
  readonly export: (sessionID: string) => Promise<Transfer>
  readonly import: (data: Transfer, directory: string) => Promise<SessionInfo>
  readonly health: () => Promise<ServerHealth>
}
