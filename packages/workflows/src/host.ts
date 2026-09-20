import { Plugin } from "@opencode/plugin"
import type { AgentRequest, CheckpointRequest, DecisionRequest, WorkflowHost } from "./engine.ts"
import type { RunRegistry } from "./registry.ts"

type Context = Plugin.Context

export function createHost(options: {
  ctx: Context
  registry: RunRegistry
  runId: string
  originSessionID?: string
}): WorkflowHost {
  const { ctx, registry, runId, originSessionID } = options

  return {
    async runAgent(request: AgentRequest, signal: AbortSignal) {
      const sessionID = await sessionFor(request, ctx, originSessionID)
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError())
        signal.addEventListener("abort", onAbort, { once: true })
        registry.agents.set(sessionID, {
          runId,
          nodeId: request.nodeId,
          resolve: (value) => {
            signal.removeEventListener("abort", onAbort)
            registry.agents.delete(sessionID)
            resolve(value)
          },
          reject: (error) => {
            signal.removeEventListener("abort", onAbort)
            registry.agents.delete(sessionID)
            reject(error)
          },
        })
        void (async () => {
          try {
            await ctx.session.prompt({
              sessionID,
              text: agentPrompt(request),
            })
            await ctx.session.wait({ sessionID })
            if (registry.agents.has(sessionID)) {
              const output = await readSessionOutput(ctx, sessionID, request.output)
              registry.agents.get(sessionID)?.resolve(output)
            }
          } catch (error) {
            registry.agents.get(sessionID)?.reject(error instanceof Error ? error : new Error(String(error)))
          }
        })()
      })
    },

    async runDecision(request: DecisionRequest, signal: AbortSignal) {
      const listed = request.choices.map((choice) => `"${choice}"`).join(", ")
      const result = await ctx.generate.text(
        {
          prompt: [
            request.prompt,
            "",
            `Reply with exactly one of these choices: ${listed}.`,
            'Return JSON only: {"choice":"..."}',
          ].join("\n"),
        },
        { signal },
      )
      const choice = parseChoice(result.text, request.choices)
      if (!choice) {
        throw new Error(`Could not parse a decision from: ${truncate(result.text)}`)
      }
      return choice
    },

    checkpoint(_request: CheckpointRequest, signal: AbortSignal) {
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          registry.checkpoints.delete(runId)
          reject(abortError())
        }
        signal.addEventListener("abort", onAbort, { once: true })
        registry.checkpoints.set(runId, {
          runId,
          resolve: (value) => {
            signal.removeEventListener("abort", onAbort)
            registry.checkpoints.delete(runId)
            resolve(value)
          },
          reject: (error) => {
            signal.removeEventListener("abort", onAbort)
            registry.checkpoints.delete(runId)
            reject(error)
          },
        })
      })
    },
  }
}

async function sessionFor(request: AgentRequest, ctx: Context, originSessionID?: string): Promise<string> {
  if (request.session === "origin") {
    if (!originSessionID) throw new Error("Origin session agent steps need a sessionID")
    return originSessionID
  }
  const created = await ctx.session.create({
    title: `workflow:${request.nodeId}`,
  })
  return created.id
}

function agentPrompt(request: AgentRequest): string {
  if (request.output === "assistant") {
    return `${request.prompt}\n\nReply with the final answer as a normal message.`
  }
  return `${request.prompt}\n\nWhen finished, call the workflow tool with action "submit" and a JSON result.`
}

async function readSessionOutput(
  ctx: Context,
  sessionID: string,
  output: AgentRequest["output"],
): Promise<unknown> {
  const messages = await ctx.session.context({ sessionID })
  const text = lastAssistantText(messages)
  if (output === "assistant") return text
  return parseJson(text) ?? { text }
}

function lastAssistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as {
      role?: string
      text?: string
      parts?: Array<{ type?: string; text?: string }>
    }
    if (message.role && message.role !== "assistant" && message.role !== "output") continue
    if (typeof message.text === "string" && message.text.trim()) return message.text
    const text = message.parts
      ?.filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
    if (text?.trim()) return text
  }
  return ""
}

function parseChoice(text: string, choices: readonly string[]): string | undefined {
  const json = parseJson(text)
  if (json && typeof json === "object" && json !== null && "choice" in json) {
    const choice = (json as { choice: unknown }).choice
    if (typeof choice === "string" && choices.includes(choice)) return choice
  }
  const trimmed = text.trim().replace(/^["']|["']$/g, "")
  return choices.find((choice) => choice === trimmed || trimmed.endsWith(choice))
}

function parseJson(text: string): unknown {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function abortError(): Error {
  const error = new Error("Workflow cancelled")
  error.name = "AbortError"
  return error
}

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}
