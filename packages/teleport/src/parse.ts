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
      readonly dryRun?: boolean
    }

const DIRECTORY_FLAGS = new Set(["--directory", "--dir", "-d"])

/**
 * Parse `/teleport ...` text. Flags may appear anywhere; everything else is
 * positional. Unknown subcommands return help with a note instead of throwing
 * so a typo never starts a transfer.
 */
export function parseCommand(input: string): ActionRequest {
  const tokens = tokenize(input)
  if (tokens.length === 0) return { action: "help" }
  const positional: string[] = []
  let directory: string | undefined
  let includeChildren = true
  let onConflict: ConflictPolicy = "fail"
  let dryRun = false
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (DIRECTORY_FLAGS.has(token)) {
      const value = tokens[++index]
      if (value === undefined || value === "" || value.startsWith("--")) {
        return { action: "help", note: `${token} needs a path` }
      }
      directory = value
      continue
    }
    if (token.startsWith("--directory=")) {
      const value = token.slice("--directory=".length)
      if (value === "") return { action: "help", note: "--directory needs a path" }
      directory = value
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
    if (token === "--plan" || token === "--dry-run") {
      dryRun = true
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
      dryRun,
    }
  }
  return { action: "help", note: `unknown command "${command}"` }
}

/**
 * Split command text into arguments, keeping quoted segments intact so
 * directories with spaces work. Backslashes stay literal, which keeps Windows
 * paths usable.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quoted = false
  let quote: '"' | "'" | undefined
  for (const character of input) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      quoted = true
      continue
    }
    if (character === " " || character === "\t" || character === "\n") {
      if (quoted || current !== "") {
        tokens.push(current)
        current = ""
        quoted = false
      }
      continue
    }
    current += character
    quoted = true
  }
  if (quoted || current !== "") tokens.push(current)
  return tokens
}
