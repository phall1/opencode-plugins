import type { ConflictPolicy } from "./transfer.ts"

export type ActionRequest =
  | { readonly action: "help"; readonly note?: string }
  | { readonly action: "remotes" }
  | { readonly action: "sessions"; readonly remote?: string; readonly query?: string }
  | {
      readonly action: "pull" | "push"
      readonly remote: string
      readonly sessionID?: string
      readonly directory?: string
      readonly includeChildren: boolean
      readonly onConflict: ConflictPolicy
    }

const DIRECTORY_FLAGS = new Set(["--directory", "--dir", "-d"])

/**
 * Parse `/teleport ...` text. Flags may appear anywhere; everything else is
 * positional. Unknown subcommands return help with a note instead of throwing
 * so a typo never starts a transfer.
 */
export function parseCommand(input: string): ActionRequest {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { action: "help" }
  const positional: string[] = []
  let directory: string | undefined
  let includeChildren = true
  let onConflict: ConflictPolicy = "fail"
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (DIRECTORY_FLAGS.has(token)) {
      directory = tokens[++index]
      if (directory === undefined) return { action: "help", note: `${token} needs a path` }
      continue
    }
    if (token.startsWith("--directory=")) {
      directory = token.slice("--directory=".length)
      continue
    }
    if (token === "--no-children") {
      includeChildren = false
      continue
    }
    if (token === "--children") {
      includeChildren = true
      continue
    }
    if (token === "--skip-conflicts") {
      onConflict = "skip"
      continue
    }
    positional.push(token)
  }
  const command = positional[0]
  if (command === undefined) return { action: "help" }
  if (command === "remotes") return { action: "remotes" }
  if (command === "help") return { action: "help" }
  if (command === "sessions") {
    const remote = positional[1]
    const query = positional.slice(2).join(" ").trim()
    return { action: "sessions", remote, query: query === "" ? undefined : query }
  }
  if (command === "pull" || command === "push") {
    const remote = positional[1]
    if (remote === undefined) return { action: "help", note: `/${command} needs a remote name` }
    return {
      action: command,
      remote,
      sessionID: positional[2],
      directory,
      includeChildren,
      onConflict,
    }
  }
  return { action: "help", note: `unknown command "${command}"` }
}
