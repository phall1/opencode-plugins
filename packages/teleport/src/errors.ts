export type TeleportErrorCode =
  | "not_configured"
  | "local_unavailable"
  | "unreachable"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unsupported"
  | "failed"
  | "verification_failed"

export class TeleportError extends Error {
  readonly code: TeleportErrorCode
  readonly detail: string | undefined

  constructor(code: TeleportErrorCode, message: string, detail?: string) {
    super(message)
    this.name = "TeleportError"
    this.code = code
    this.detail = detail
  }
}

export function errorText(error: unknown): string {
  if (error instanceof TeleportError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}
