import { execFile } from "node:child_process"

// Read only the configured credential. Never log command output or persist keys.
export function createCredential(command?: string[], environment = process.env, now = Date.now) {
  let cached: Promise<string> | undefined
  let expiresAt = 0
  return (): Promise<string> => {
    if (environment.TYPESAFE_API_KEY) return Promise.resolve(environment.TYPESAFE_API_KEY)
    if (now() >= expiresAt) cached = undefined
    if (!cached) {
      expiresAt = now() + 5 * 60_000
      cached = loadCredential(command).catch(() => {
        cached = undefined
        throw new Error("Router credential unavailable")
      })
    }
    return cached
  }
}

function loadCredential(command?: string[]): Promise<string> {
  if (!command) return Promise.reject(new Error("TYPESAFE_API_KEY is not set"))
  return new Promise((resolve, reject) => {
    execFile(command[0]!, command.slice(1), { timeout: 3000, maxBuffer: 16_384 }, (error, stdout) => {
      if (error) return reject(new Error("Router credential command failed"))
      const key = stdout.trim()
      if (!key || /\s/.test(key)) return reject(new Error("Router credential command did not return a key"))
      resolve(key)
    })
  })
}
