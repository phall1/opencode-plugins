import { Plugin } from "@opencode/plugin/effect"
import { Deferred, Duration, Effect, Fiber } from "effect"
import type { Workflow } from "./dsl.ts"
import {
  createRun,
  createRunId,
  runWorkflow,
  toSnapshot,
  type RunEvent,
  type RunSnapshot,
} from "./engine.ts"
import { narrateLine } from "./format.ts"
import { createHost } from "./host.ts"
import type { RunRegistry } from "./registry.ts"

const SETTLE_TICKS = 25

export const startRun = (options: {
  workflow: Workflow
  input: unknown
  ctx: Plugin.Context
  registry: RunRegistry
  originSessionID?: string
  emit: (run: RunSnapshot) => Effect.Effect<void>
}): Effect.Effect<RunSnapshot> =>
  Effect.gen(function* () {
    const runId = createRunId()
    const sessions = new Map<string, string>()
    const publish = (run: RunSnapshot) => options.emit(stampSessions(run, sessions))
    const host = createHost({
      ctx: options.ctx,
      registry: options.registry,
      runId,
      originSessionID: options.originSessionID,
      onAgentSession: (path, sessionID) => {
        sessions.set(path, sessionID)
        const current = options.registry.get(runId)
        if (current) void Effect.runPromise(publish(current)).catch((error) => console.error("opencode-workflows: failed to publish session link", error))
      },
    })
    const initial = toSnapshot(createRun(options.workflow, options.input, runId))
    options.registry.put(initial)
    yield* publish(initial)

    const live = { on: false }
    const fiber = yield* runWorkflow({
      workflow: options.workflow,
      input: options.input,
      host,
      runId,
      onEvent: (event) => publish(event.run).pipe(Effect.andThen(maybeNarrate(options, live, event))),
    }).pipe(
      Effect.tap(publish),
      Effect.ensuring(Effect.sync(() => {
        options.registry.sessions.delete(runId)
        options.registry.fibers.delete(runId)
        options.registry.checkpoints.delete(runId)
      })),
      Effect.forkDetach({ startImmediately: true }),
    )
    options.registry.fibers.set(runId, fiber)

    yield* waitWhileRunning(options.registry, runId)
    const latest = options.registry.get(runId) ?? initial
    if (latest.status === "running" || latest.status === "waiting") live.on = true
    return latest
  })

export const cancelRun = (registry: RunRegistry, runId: string): Effect.Effect<RunSnapshot | undefined> =>
  Effect.gen(function* () {
    const run = registry.runs.get(runId)
    if (!run) return undefined
    if (run.status !== "running" && run.status !== "waiting") return run
    const fiber = registry.fibers.get(runId)
    if (fiber) yield* Fiber.interrupt(fiber)
    const checkpoint = registry.checkpoints.get(runId)
    if (checkpoint) {
      yield* Deferred.fail(checkpoint, cancelledError())
      registry.checkpoints.delete(runId)
    }
    for (const [sessionID, agent] of registry.agents) {
      if (agent.runId !== runId) continue
      yield* Deferred.fail(agent.deferred, cancelledError())
      registry.agents.delete(sessionID)
    }
    registry.sessions.delete(runId)
    const cancelled = toSnapshot({ ...run, status: "cancelled", error: "Workflow cancelled" })
    registry.put(cancelled)
    return cancelled
  })

const waitWhileRunning = (registry: RunRegistry, runId: string, remaining = SETTLE_TICKS): Effect.Effect<void> =>
  Effect.gen(function* () {
    const run = registry.get(runId)
    if (!run || run.status !== "running" || remaining <= 0) return
    yield* Effect.sleep(Duration.millis(16))
    return yield* waitWhileRunning(registry, runId, remaining - 1)
  })

const maybeNarrate = (
  options: {
    ctx: Plugin.Context
    originSessionID?: string
  },
  live: { on: boolean },
  event: RunEvent,
): Effect.Effect<void> => {
  if (!live.on || !options.originSessionID) return Effect.void
  const text = narrateLine(event)
  if (!text) return Effect.void
  return options.ctx.session
    .synthetic({
      sessionID: options.originSessionID as never,
      text,
      resume: false,
    })
    .pipe(
      Effect.asVoid,
      Effect.catch(() => Effect.void),
    )
}

function stampSessions(run: RunSnapshot, sessions: Map<string, string>, prefix = ""): RunSnapshot {
  if (sessions.size === 0) return run
  return {
    ...run,
    nodes: run.nodes.map((node) => {
      const path = prefix ? `${prefix}.${node.id}` : node.id
      const sessionID = sessions.get(path)
      return {
        ...node,
        ...(sessionID ? { sessionID } : {}),
        ...(node.child ? { child: stampSessions(node.child, sessions, path) } : {}),
      }
    }),
  }
}

function cancelledError(): Error {
  const error = new Error("Workflow cancelled")
  error.name = "AbortError"
  return error
}
