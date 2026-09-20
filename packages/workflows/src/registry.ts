import type { RunSnapshot } from "./engine.ts"

export type PendingCheckpoint = {
  runId: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export type ActiveAgent = {
  runId: string
  nodeId: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class RunRegistry {
  readonly runs = new Map<string, RunSnapshot>()
  readonly controllers = new Map<string, AbortController>()
  readonly checkpoints = new Map<string, PendingCheckpoint>()
  readonly agents = new Map<string, ActiveAgent>()
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

  controller(runId: string): AbortController {
    const existing = this.controllers.get(runId)
    if (existing) return existing
    const created = new AbortController()
    this.controllers.set(runId, created)
    return created
  }

  cancel(runId: string): RunSnapshot | undefined {
    const run = this.runs.get(runId)
    if (!run) return undefined
    this.controllers.get(runId)?.abort()
    this.checkpoints.get(runId)?.reject(new Error("Workflow cancelled"))
    this.checkpoints.delete(runId)
    for (const [sessionID, agent] of this.agents) {
      if (agent.runId !== runId) continue
      agent.reject(new Error("Workflow cancelled"))
      this.agents.delete(sessionID)
    }
    const cancelled: RunSnapshot = { ...run, status: "cancelled", error: "Workflow cancelled" }
    this.put(cancelled)
    return cancelled
  }
}
