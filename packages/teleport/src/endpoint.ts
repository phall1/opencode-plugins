import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { SERVICE_FILE_ENV, resolveLocalEndpoint, type Env, type Endpoint, type TeleportOptions } from "./config.ts"

export type Discovery = {
  readonly endpoint?: Endpoint
  /** Human-readable explanation of what was inspected, for diagnostics. */
  readonly reason: string
}

type Registration = {
  readonly url?: unknown
  readonly pid?: unknown
  readonly password?: unknown
}

function stateDirectory(env: Env): string {
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode")
}

/**
 * Registration files written by `opencode serve --service`. Channels other than
 * latest/dev/beta/next use `service-<channel>.json`, so the directory is scanned
 * instead of guessing a filename.
 */
export function registrationFiles(env: Env): string[] {
  const explicit = env[SERVICE_FILE_ENV]
  if (explicit) return [explicit]
  const directory = stateDirectory(env)
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }
  return names
    .filter((name) => /^service.*\.json$/.test(name))
    .map((name) => join(directory, name))
    .sort((left, right) => modified(right) - modified(left))
}

function modified(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function read(file: string): Registration | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    return value as Registration
  } catch {
    return undefined
  }
}

/**
 * Resolve the server this plugin runs inside. Explicit configuration wins, then
 * the environment, then the background service registration whose pid matches
 * this process. A local `opencode serve` or `--standalone` server leaves no
 * registration, which is why the TUI surface uses its own authenticated client.
 */
export function discoverLocal(
  options: TeleportOptions,
  env: Env = process.env,
  pid: number = process.pid,
): Discovery {
  const configured = resolveLocalEndpoint(options, env)
  if (configured) return { endpoint: configured, reason: `configured via ${configured.source}` }
  const files = registrationFiles(env)
  if (files.length === 0) {
    return { reason: `no service registration found in ${stateDirectory(env)}` }
  }
  for (const file of files) {
    const registration = read(file)
    if (!registration) continue
    if (registration.pid !== pid) continue
    if (typeof registration.url !== "string") continue
    return {
      endpoint: {
        name: "local",
        url: registration.url,
        username: "opencode",
        password: typeof registration.password === "string" ? registration.password : undefined,
        source: "service",
      },
      reason: `service registration ${file}`,
    }
  }
  const seen = files.map((file) => `${file} (pid ${String(read(file)?.pid ?? "?")})`).join(", ")
  return { reason: `no registration matches this process pid ${pid}: ${seen}` }
}
