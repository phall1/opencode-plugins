import { Plugin } from "@opencode/plugin/effect"
import { Deferred, Duration, Effect } from "effect"
import type { AgentRequest, CheckpointRequest, DecisionRequest, WorkflowHost } from "./engine.ts"
import { applyConfidence, judgeChoice, type Judgment } from "./judge.ts"
import type { RunRegistry } from "./registry.ts"

type Context = Plugin.Context

function asSessionID(id: string) {
  return id as never
}

export function createHost(options: {
  ctx: Context
  registry: RunRegistry
  runId: string
  originSessionID?: string
  onAgentSession?: (nodeId: string, sessionID: string) => void
}): WorkflowHost {
  const { ctx, registry, runId, originSessionID } = options

  return {
    runAgent: (request) =>
      Effect.gen(function* () {
        const id = yield* sessionFor(request, ctx, originSessionID)
        if (request.session !== "origin") options.onAgentSession?.(request.nodeId, id)
        const deferred = yield* Deferred.make<unknown, Error>()
        registry.agents.set(id, { runId, nodeId: request.nodeId, deferred })
        yield* ctx.session.prompt({ sessionID: asSessionID(id), text: agentPrompt(request) }).pipe(Effect.orDie)
        yield* ctx.session.wait({ sessionID: asSessionID(id) }).pipe(Effect.orDie)
        if (registry.agents.has(id)) {
          const output = yield* readSessionOutput(ctx, id, request.output)
          yield* Deferred.succeed(deferred, output)
          registry.agents.delete(id)
        }
        return yield* Deferred.await(deferred)
      }),

    runDecision: (request) =>
      Effect.gen(function* () {
        const judged = yield* judgeChoice({
          prompt: request.prompt,
          choices: request.choices,
          state: request.state ?? { prompt: request.prompt },
        }).pipe(
          Effect.timeout(Duration.millis(3000)),
          Effect.catch(() => generateChoice(ctx, request).pipe(Effect.timeout(Duration.millis(15_000)))),
        )
        const applied = applyConfidence(judged, request.minConfidence)
        if (applied.choice !== "uncertain" && !request.choices.includes(applied.choice)) {
          return yield* Effect.fail(new Error(`Decision returned "${applied.choice}"`))
        }
        return applied.choice
      }),

    checkpoint: (_request: CheckpointRequest) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<unknown, Error>()
        registry.checkpoints.set(runId, deferred)
        return yield* Deferred.await(deferred)
      }),

    wait: (ms) => Effect.sleep(Duration.millis(ms)),
  }
}

const sessionFor = (
  request: AgentRequest,
  ctx: Context,
  originSessionID?: string,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    if (request.session === "origin") {
      if (!originSessionID) {
        return yield* Effect.fail(new Error("Origin session agent steps need a sessionID"))
      }
      return originSessionID
    }
    const created = yield* ctx.session.create({ title: `workflow:${request.nodeId}` }).pipe(Effect.orDie)
    return created.id
  })

const generateChoice = (ctx: Context, request: DecisionRequest): Effect.Effect<Judgment, Error> =>
  Effect.gen(function* () {
    const listed = request.choices.map((choice) => `"${choice}"`).join(", ")
    const result = yield* ctx.generate
      .text({
        prompt: [
          request.prompt,
          "",
          `Reply with exactly one of these choices: ${listed}.`,
          'Return JSON only: {"choice":"..."}',
        ].join("\n"),
      })
      .pipe(Effect.orDie)
    const choice = parseChoice(result.text, request.choices)
    if (!choice) {
      return yield* Effect.fail(new Error(`Could not parse a decision from: ${truncate(result.text)}`))
    }
    return {
      choice,
      confidence: 1,
      probabilities: Object.fromEntries(request.choices.map((item) => [item, item === choice ? 1 : 0])),
      source: "generate" as const,
    }
  })

function agentPrompt(request: AgentRequest): string {
  if (request.output === "assistant") {
    return `${request.prompt}\n\nReply with the final answer as a normal message.`
  }
  return `${request.prompt}\n\nWhen finished, call the workflow tool with action "submit" and a JSON result.`
}

const readSessionOutput = (
  ctx: Context,
  sessionID: string,
  output: AgentRequest["output"],
): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const messages = yield* ctx.session.context({ sessionID: asSessionID(sessionID) }).pipe(Effect.orDie)
    const text = lastAssistantText(messages as readonly unknown[])
    if (output === "assistant") return text
    return parseJson(text) ?? { text }
  })

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

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}
