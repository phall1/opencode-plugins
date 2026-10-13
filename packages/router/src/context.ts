import type { SessionContext } from "@opencode/plugin/promise/session"

export function routingState(messages: SessionContext["messages"], maxChars: number) {
  const user = messages.findLast((message) => message.role === "user")
  const request = user?.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").slice(-Math.floor(maxChars / 2)) ?? ""
  const recent: { role: string; text: string }[] = []
  let remaining = maxChars - request.length
  for (const message of messages.slice(-6).toReversed()) {
    if (message === user || message.role === "system") continue
    const text = message.content.map(partText).filter(Boolean).join("\n").slice(-remaining)
    if (!text) continue
    recent.unshift({ role: message.role, text })
    remaining -= text.length
    if (remaining <= 0) break
  }
  return { request, recent }
}

function partText(part: SessionContext["messages"][number]["content"][number]): string {
  if (part.type === "text") return part.text
  if (part.type === "tool-call") return JSON.stringify({ tool: part.name, input: part.input }, omitMedia)
  if (part.type === "tool-result") {
    const result = part.result.type === "content"
      ? { type: "content", value: part.result.value.filter((item) => item.type === "text") }
      : part.result
    return JSON.stringify({ tool: part.name, result }, omitMedia)
  }
  // Never send media payloads, reasoning, system prompts, or provider credentials.
  return ""
}

const MEDIA_FIELDS = new Set(["files", "media", "image", "images", "base64", "bytes", "data"])
function omitMedia(key: string, value: unknown): unknown {
  if (MEDIA_FIELDS.has(key)) return undefined
  if (typeof value === "string" && value.startsWith("data:")) return "[media omitted]"
  return value
}
