import { Deferred, type Fiber } from "effect"
import type { RunSnapshot } from "./engine.ts"

export type AgentWaiter = {
  runId: string
  nodeId: string
  deferred: Deferred.Deferred<unknown, Error>
}

export class RunRegistry {
  readonly runs = new Map<string, RunSnapshot>()
  readonly checkpoints = new Map<string, Deferred.Deferred<unknown, Error>>()
  readonly agents = new Map<string, AgentWaiter>()
  readonly fibers = new Map<string, Fiber.Fiber<RunSnapshot, never>>()
  activeRunId: string | undefined

  get(runId?: string): RunSnapshot | undefined {
    if (runId) return this.runs.get(runId)
    if (this.activeRunId) return this.runs.get(this.activeRunId)
    return [...this.runs.values()].at(-1)
  }

  busy(): RunSnapshot | undefined {
    const run = this.get(this.activeRunId)
    if (!run) return undefined
    if (run.status === "running" || run.status === "waiting") return run
    return undefined
  }

  put(run: RunSnapshot): void {
    this.runs.set(run.id, run)
    if (run.status === "running" || run.status === "waiting") this.activeRunId = run.id
    else if (this.activeRunId === run.id) this.activeRunId = undefined
  }
}
