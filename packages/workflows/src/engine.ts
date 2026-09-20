import { resolvePrompt, type NodeCtx, type Workflow, type WorkflowNode } from "./dsl.ts"

export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled"

export type NodeRunStatus = "pending" | "running" | "done" | "failed" | "waiting"

export type NodeSnapshot = {
  id: string
  type: WorkflowNode["type"]
  status: NodeRunStatus
}

export type RunSnapshot = {
  id: string
  workflow: string
  status: RunStatus
  cursor: string
  input: unknown
  outputs: Record<string, unknown>
  error?: string
  nodes: NodeSnapshot[]
}

export type AgentRequest = {
  nodeId: string
  prompt: string
  output: "json" | "assistant"
  session: "child" | "origin"
}

export type DecisionRequest = {
  nodeId: string
  prompt: string
  choices: readonly string[]
}

export type CheckpointRequest = {
  nodeId: string
  prompt: string
}

export type WorkflowHost = {
  runAgent(request: AgentRequest, signal: AbortSignal): Promise<unknown>
  runDecision(request: DecisionRequest, signal: AbortSignal): Promise<string>
  checkpoint(request: CheckpointRequest, signal: AbortSignal): Promise<unknown>
}

export type RunEvent =
  | { type: "run.started"; run: RunSnapshot }
  | { type: "node.started"; run: RunSnapshot }
  | { type: "node.finished"; run: RunSnapshot }
  | { type: "run.waiting"; run: RunSnapshot }
  | { type: "run.finished"; run: RunSnapshot }
  | { type: "run.failed"; run: RunSnapshot }

export type RunEventHandler = (event: RunEvent) => void

type MutableRun = RunSnapshot & {
  nodeStatus: Record<string, NodeRunStatus>
}

export function createRunId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createRun(workflow: Workflow, input: unknown, id = createRunId()): MutableRun {
  const nodeStatus = Object.fromEntries(
    Object.keys(workflow.nodes).map((nodeId) => [nodeId, "pending" as NodeRunStatus]),
  )
  return {
    id,
    workflow: workflow.name,
    status: "running",
    cursor: workflow.startAt,
    input,
    outputs: {},
    nodeStatus,
    nodes: snapshots(workflow, nodeStatus),
  }
}

export async function runWorkflow(options: {
  workflow: Workflow
  input?: unknown
  host: WorkflowHost
  signal?: AbortSignal
  runId?: string
  onEvent?: RunEventHandler
}): Promise<RunSnapshot> {
  const run = createRun(options.workflow, options.input ?? {}, options.runId)
  const signal = options.signal ?? new AbortController().signal
  const emit = (type: RunEvent["type"]) => {
    refresh(run, options.workflow)
    options.onEvent?.({ type, run: snapshot(run) })
  }

  emit("run.started")
  try {
    while (run.status === "running") {
      throwIfAborted(signal)
      await step(run, options.workflow, options.host, signal, emit)
    }
  } catch (error) {
    if (run.status === "cancelled") return snapshot(run)
    run.status = "failed"
    run.error = messageOf(error)
    run.nodeStatus[run.cursor] = "failed"
    emit("run.failed")
  }
  return snapshot(run)
}

async function step(
  run: MutableRun,
  workflow: Workflow,
  host: WorkflowHost,
  signal: AbortSignal,
  emit: (type: RunEvent["type"]) => void,
): Promise<void> {
  const nodeId = run.cursor
  const node = workflow.nodes[nodeId]
  if (!node) throw new Error(`Unknown node "${nodeId}" in workflow "${workflow.name}"`)

  run.nodeStatus[nodeId] = node.type === "checkpoint" ? "waiting" : "running"
  emit(node.type === "checkpoint" ? "run.waiting" : "node.started")

  const ctx: NodeCtx = { input: run.input, outputs: run.outputs }
  const output = await executeNode(node, nodeId, ctx, host, signal)
  run.outputs[nodeId] = output
  run.nodeStatus[nodeId] = "done"
  emit("node.finished")

  const next = nextNode(workflow, nodeId, { ...ctx, output })
  if (!next) {
    run.status = "done"
    emit("run.finished")
    return
  }
  run.cursor = next
}

async function executeNode(
  node: WorkflowNode,
  nodeId: string,
  ctx: NodeCtx,
  host: WorkflowHost,
  signal: AbortSignal,
): Promise<unknown> {
  switch (node.type) {
    case "compute":
      return node.run(ctx)
    case "agent":
      return host.runAgent(
        {
          nodeId,
          prompt: await resolvePrompt(node.prompt, ctx),
          output: node.output,
          session: node.session,
        },
        signal,
      )
    case "decision": {
      const choice = await host.runDecision(
        {
          nodeId,
          prompt: await resolvePrompt(node.prompt, ctx),
          choices: node.choices,
        },
        signal,
      )
      if (!node.choices.includes(choice)) {
        throw new Error(`Decision "${nodeId}" returned "${choice}", expected one of: ${node.choices.join(", ")}`)
      }
      return { choice }
    }
    case "checkpoint":
      return host.checkpoint(
        {
          nodeId,
          prompt: await resolvePrompt(node.prompt, ctx),
        },
        signal,
      )
  }
}

export function nextNode(
  workflow: Workflow,
  from: string,
  ctx: NodeCtx & { output: unknown },
): string | undefined {
  const choice = choiceOf(ctx.output)
  const named = choice ? workflow.edges.filter((edge) => edge.from === `${from}.${choice}`) : []
  const direct = workflow.edges.filter((edge) => edge.from === from)
  const candidates = named.length > 0 ? named : direct
  if (candidates.length === 0) return undefined

  const matched = candidates.find((edge) => (edge.when ? edge.when(ctx) : false))
  if (matched) return matched.to

  const fallback = candidates.filter((edge) => !edge.when)
  if (fallback.length > 1) {
    throw new Error(`Node "${from}" has multiple default edges`)
  }
  if (fallback.length === 1) return fallback[0]?.to
  if (named.length + direct.length > 0 && !matched) {
    throw new Error(`Node "${from}" has edges but none matched`)
  }
  return undefined
}

function choiceOf(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined
  const choice = (output as { choice?: unknown }).choice
  return typeof choice === "string" ? choice : undefined
}

function refresh(run: MutableRun, workflow: Workflow): void {
  run.nodes = snapshots(workflow, run.nodeStatus)
}

function snapshots(workflow: Workflow, nodeStatus: Record<string, NodeRunStatus>): NodeSnapshot[] {
  return Object.entries(workflow.nodes).map(([id, node]) => ({
    id,
    type: node.type,
    status: nodeStatus[id] ?? "pending",
  }))
}

function snapshot(run: MutableRun): RunSnapshot {
  const { nodeStatus: _, ...rest } = run
  return {
    ...rest,
    outputs: { ...run.outputs },
    nodes: run.nodes.map((node) => ({ ...node })),
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error("Workflow cancelled")
  error.name = "AbortError"
  throw error
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
