import { TeleportError } from "./errors.ts"

export const REMOTES_ENV = "OPENCODE_TELEPORT_REMOTES"
export const PASSWORD_ENV = "OPENCODE_TELEPORT_PASSWORD"
export const LOCAL_URL_ENV = "OPENCODE_TELEPORT_LOCAL_URL"
export const LOCAL_PASSWORD_ENV = "OPENCODE_TELEPORT_LOCAL_PASSWORD"
export const LOCAL_USERNAME_ENV = "OPENCODE_TELEPORT_LOCAL_USERNAME"
export const SERVICE_FILE_ENV = "OPENCODE_TELEPORT_SERVICE_FILE"

export const DEFAULT_TIMEOUT_MS = 30_000
export const MIN_TIMEOUT_MS = 1_000
export const MAX_TIMEOUT_MS = 120_000

/** A remote may be written as a bare URL string or as an object with credentials. */
export type RemoteDefinition = {
  readonly url: string
  readonly username?: string
  readonly password?: string
  readonly passwordEnv?: string
}

export type RemoteInput = RemoteDefinition | string

export type TeleportOptions = {
  readonly remotes?: Readonly<Record<string, RemoteInput>>
  readonly local?: RemoteInput
  readonly timeoutMs?: number
}

/** A resolved, normalized connection to one OpenCode server. */
export type Endpoint = {
  readonly name: string
  readonly url: string
  readonly username: string
  readonly password?: string
  readonly source?: string
}

export type Env = Readonly<Record<string, string | undefined>>

export function optionsOf(raw: unknown): TeleportOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const value = raw as Record<string, unknown>
  return {
    remotes: isRecord(value.remotes) ? (value.remotes as Record<string, RemoteInput>) : undefined,
    local: typeof value.local === "string" || isRecord(value.local) ? (value.local as RemoteInput) : undefined,
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : undefined,
  }
}

export function timeoutOf(options: TeleportOptions): number {
  const value = options.timeoutMs
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)))
}

export function normalizeUrl(raw: string, label: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new TeleportError("invalid", `${label} has an empty URL`)
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new TeleportError("invalid", `${label} URL is not absolute: ${trimmed}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TeleportError("invalid", `${label} URL must be http or https: ${trimmed}`)
  }
  const path = url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${url.host}${path}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function definition(remote: RemoteInput, label: string): RemoteDefinition {
  if (typeof remote === "string") return { url: remote }
  if (!isRecord(remote)) throw new TeleportError("invalid", `${label} must be a URL string or an object`)
  if (typeof remote.url !== "string") throw new TeleportError("invalid", `${label}.url must be a string`)
  const value = remote as Record<string, unknown>
  return {
    url: remote.url,
    username: typeof value.username === "string" ? value.username : undefined,
    password: typeof value.password === "string" ? value.password : undefined,
    passwordEnv: typeof value.passwordEnv === "string" ? value.passwordEnv : undefined,
  }
}

/** Environment variable that carries a named remote's password, e.g. `OPENCODE_TELEPORT_MINI_PASSWORD`. */
export function remotePasswordEnv(name: string): string {
  return `OPENCODE_TELEPORT_${name.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_PASSWORD`
}

function remotePassword(name: string, definition: RemoteDefinition, env: Env): string | undefined {
  if (definition.password !== undefined) return definition.password
  if (definition.passwordEnv !== undefined) {
    const value = env[definition.passwordEnv]
    if (value === undefined) {
      throw new TeleportError(
        "not_configured",
        `Remote "${name}" expects its password in ${definition.passwordEnv}, which is not set`,
      )
    }
    return value
  }
  return env[remotePasswordEnv(name)] ?? env[PASSWORD_ENV]
}

/** Remote definitions from plugin options, or from an `OPENCODE_TELEPORT_REMOTES` JSON object. */
export function remoteDefinitions(options: TeleportOptions, env: Env): Map<string, RemoteDefinition> {
  const result = new Map<string, RemoteDefinition>()
  const configured = options.remotes
  if (configured !== undefined) {
    for (const [name, value] of Object.entries(configured)) {
      result.set(name, definition(value, `Remote "${name}"`))
    }
    return result
  }
  const raw = env[REMOTES_ENV]
  if (!raw) return result
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new TeleportError("invalid", `${REMOTES_ENV} is not valid JSON`, String(cause))
  }
  if (!isRecord(parsed)) throw new TeleportError("invalid", `${REMOTES_ENV} must be a JSON object of remotes`)
  for (const [name, value] of Object.entries(parsed)) {
    result.set(name, definition(value as RemoteInput, `Remote "${name}"`))
  }
  return result
}

export function resolveRemote(name: string, definitions: Map<string, RemoteDefinition>, env: Env): Endpoint {
  const definition = definitions.get(name)
  if (!definition) {
    const known = [...definitions.keys()]
    throw new TeleportError(
      "not_configured",
      known.length === 0
        ? `No remotes are configured. Add a "remotes" map to the teleport plugin options or set ${REMOTES_ENV}.`
        : `Unknown remote "${name}". Configured remotes: ${known.join(", ")}`,
    )
  }
  return {
    name,
    url: normalizeUrl(definition.url, `Remote "${name}"`),
    username: definition.username ?? "opencode",
    password: remotePassword(name, definition, env),
    source: "config",
  }
}

export function resolveLocalEndpoint(options: TeleportOptions, env: Env): Endpoint | undefined {
  if (options.local !== undefined) {
    const local = definition(options.local, "local")
    return {
      name: "local",
      url: normalizeUrl(local.url, "local"),
      username: local.username ?? "opencode",
      password: remotePassword("local", local, env),
      source: "options",
    }
  }
  const url = env[LOCAL_URL_ENV]
  if (url) {
    return {
      name: "local",
      url: normalizeUrl(url, "Local server"),
      username: env[LOCAL_USERNAME_ENV] ?? "opencode",
      password: env[LOCAL_PASSWORD_ENV] ?? env[PASSWORD_ENV],
      source: "env",
    }
  }
  return undefined
}

export function localUnavailable(): TeleportError {
  return new TeleportError(
    "local_unavailable",
    "The local server's address and password could not be discovered. " +
      `Teleport from the TUI (/teleport), or set ${LOCAL_URL_ENV} plus ${LOCAL_PASSWORD_ENV}, ` +
      "or add a `local` endpoint to the plugin options.",
  )
}
