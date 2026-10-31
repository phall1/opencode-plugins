import { TeleportError } from "./errors.ts"
import type { Endpoint } from "./config.ts"
import type { ListInput, ListPage, ServerApi, ServerHealth, SessionSummary, Transfer, SessionInfo } from "./types.ts"

export type HttpApiOptions = {
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

type RequestOptions = {
  readonly method?: string
  readonly query?: Record<string, string | number | boolean | undefined>
  readonly body?: unknown
}

function authorization(endpoint: Endpoint): string | undefined {
  if (endpoint.password === undefined) return undefined
  const secret = Buffer.from(`${endpoint.username ?? "opencode"}:${endpoint.password}`).toString("base64")
  return `Basic ${secret}`
}

function messageOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const value = body as Record<string, unknown>
  if (typeof value.message === "string") return value.message
  if (typeof value.detail === "string") return value.detail
  if (typeof value._tag === "string") return value._tag
  return undefined
}

function tagOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const tag = (body as Record<string, unknown>)._tag
  return typeof tag === "string" ? tag : undefined
}

function failure(status: number, body: unknown, label: string, path: string): TeleportError {
  const detail = messageOf(body)
  const tag = tagOf(body)
  if (status === 401 || status === 403) {
    return new TeleportError("unauthorized", `${label} rejected the credentials (${status})`, detail)
  }
  if (status === 409) {
    return new TeleportError("conflict", detail ?? "Session already exists on the destination", tag)
  }
  if (status === 404) {
    if (tag === "SessionNotFoundError") return new TeleportError("not_found", detail ?? `Session not found on ${label}`)
    return new TeleportError(
      "unsupported",
      `${label} does not expose ${path}. Update the server to a release with session transfer support.`,
      detail,
    )
  }
  if (status === 400) return new TeleportError("invalid", detail ?? `${label} rejected the request`, tag)
  return new TeleportError("failed", `${label} failed ${path} with status ${status}`, detail)
}

function transportError(label: string, error: unknown): TeleportError {
  const detail = error instanceof Error ? error.message : String(error)
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
  return new TeleportError(
    "unreachable",
    timedOut ? `${label} did not answer before the timeout` : `${label} is unreachable`,
    detail,
  )
}

function summary(item: Record<string, unknown>): SessionSummary {
  const location = item.location as { directory?: unknown } | undefined
  const time = item.time as { created?: unknown; updated?: unknown } | undefined
  return {
    id: String(item.id),
    parentID: typeof item.parentID === "string" ? item.parentID : undefined,
    title: typeof item.title === "string" ? item.title : undefined,
    directory: typeof location?.directory === "string" ? location.directory : undefined,
    created: typeof time?.created === "number" ? time.created : undefined,
    updated: typeof time?.updated === "number" ? time.updated : undefined,
  }
}

/** HTTP client for one OpenCode server's transfer surface. */
export function httpApi(endpoint: Endpoint, options: HttpApiOptions = {}): ServerApi {
  const label = endpoint.name === "local" ? "Local server" : `Remote "${endpoint.name}"`
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000

  async function request<T>(path: string, request: RequestOptions = {}): Promise<T> {
    // Concatenate instead of URL-resolving so a reverse-proxied prefix in the
    // configured base URL survives.
    const url = new URL(`${endpoint.url}${path}`)
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = { accept: "application/json" }
    const auth = authorization(endpoint)
    if (auth) headers.authorization = auth
    if (request.body !== undefined) headers["content-type"] = "application/json"
    let response: Response
    try {
      response = await fetcher(url, {
        method: request.method ?? "GET",
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw transportError(label, error)
    }
    const text = await response.text().catch(() => "")
    let body: unknown = undefined
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    if (!response.ok) throw failure(response.status, body, label, path)
    return body as T
  }

  return {
    label,
    url: endpoint.url,
    health: async (): Promise<ServerHealth> => {
      const body = await request<{ version?: unknown; urls?: unknown }>("/api/info")
      return {
        version: typeof body.version === "string" ? body.version : "unknown",
        url: Array.isArray(body.urls) && typeof body.urls[0] === "string" ? body.urls[0] : undefined,
      }
    },
    list: async (input: ListInput = {}): Promise<ListPage> => {
      const body = await request<{ data?: unknown; cursor?: { next?: unknown } }>("/api/session", {
        query: {
          limit: input.limit,
          order: "desc",
          search: input.search,
          parentID: input.parentID === null ? "null" : input.parentID,
          directory: input.directory,
          cursor: input.cursor,
        },
      })
      const data = Array.isArray(body.data) ? body.data : []
      return {
        items: data.map((item) => summary(item as Record<string, unknown>)),
        next: typeof body.cursor?.next === "string" ? body.cursor.next : undefined,
      }
    },
    export: async (sessionID: string): Promise<Transfer> => {
      const body = await request<{ data?: unknown }>(
        `/api/experimental/session/${encodeURIComponent(sessionID)}/export`,
      )
      const data = body.data as Transfer | undefined
      if (!data || typeof data !== "object" || !data.info || typeof data.info.id !== "string") {
        throw new TeleportError("failed", `${label} returned an invalid session transfer`, JSON.stringify(data).slice(0, 200))
      }
      return data
    },
    import: async (data: Transfer, directory: string): Promise<SessionInfo> => {
      const body = await request<{ data?: unknown }>("/api/experimental/session/import", {
        method: "POST",
        body: { info: data.info, messages: data.messages, location: { directory } },
      })
      const session = body.data as SessionInfo | undefined
      if (!session || typeof session.id !== "string") {
        throw new TeleportError("failed", `${label} returned an invalid imported session`)
      }
      return session
    },
  }
}
