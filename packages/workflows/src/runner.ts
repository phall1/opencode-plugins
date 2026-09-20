import { Plugin } from "@opencode/plugin/effect"
import { Deferred, Effect, Fiber } from "effect"
import type { Workflow } from "./dsl.ts"
import { createRun, createRunId, runWorkflow, type RunSnapshot } from "./engine.ts"
import { createHost } from "./host.ts"
import type { RunRegistry } from "./registry.ts"

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
    const host = createHost({
      ctx: options.ctx,
      registry: options.registry,
      runId,
      originSessionID: options.originSessionID,
    })
    const initial = createRun(options.workflow, options.input, runId)
    options.registry.put(initial)
    yield* options.emit(initial)
    const fiber = yield* runWorkflow({
      workflow: options.workflow,
      input: options.input,
      host,
      runId,
      onEvent: (event) => options.emit(event.run),
    }).pipe(Effect.tap(options.emit), Effect.forkChild)
    options.registry.fibers.set(runId, fiber)
    return initial
  })

export const cancelRun = (registry: RunRegistry, runId: string): Effect.Effect<RunSnapshot | undefined> =>
  Effect.gen(function* () {
    const run = registry.runs.get(runId)
    if (!run) return undefined
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
    const cancelled: RunSnapshot = { ...run, status: "cancelled", error: "Workflow cancelled" }
    registry.put(cancelled)
    return cancelled
  })

function cancelledError(): Error {
  const error = new Error("Workflow cancelled")
  error.name = "AbortError"
  return error
}
