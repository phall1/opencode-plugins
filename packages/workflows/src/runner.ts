import { Plugin } from "@opencode/plugin"
import type { Workflow } from "./dsl.ts"
import { createRun, createRunId, runWorkflow, type RunSnapshot } from "./engine.ts"
import { createHost } from "./host.ts"
import type { RunRegistry } from "./registry.ts"

export function startRun(options: {
  workflow: Workflow
  input: unknown
  ctx: Plugin.Context
  registry: RunRegistry
  originSessionID?: string
  emit: (run: RunSnapshot) => Promise<void>
}): RunSnapshot {
  const runId = createRunId()
  const controller = options.registry.controller(runId)
  const host = createHost({
    ctx: options.ctx,
    registry: options.registry,
    runId,
    originSessionID: options.originSessionID,
  })
  const initial = createRun(options.workflow, options.input, runId)
  options.registry.put(initial)
  void options.emit(initial)
  void runWorkflow({
    workflow: options.workflow,
    input: options.input,
    host,
    runId,
    signal: controller.signal,
    onEvent: (event) => {
      void options.emit(event.run)
    },
  }).then(
    (run) => options.emit(run),
    (error) =>
      options.emit({
        ...initial,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
  )
  return initial
}
