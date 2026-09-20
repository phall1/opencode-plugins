import { Effect } from "effect"
import { resolvePrompt, type NodeCtx, type Workflow, type WorkflowNode } from "./dsl.ts"

export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled"

export type NodeRunStatus = "pending" | "running" | "done" | "failed" | "waiting"

export type NodeSnapshot = {
  id: string
  type: WorkflowNode["type"] | "include"
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
  state?: unknown
  minConfidence?: number
}

export type CheckpointRequest = {
  nodeId: string
  prompt: string
}

export type WorkflowHost = {
  runAgent: (request: AgentRequest) => Effect.Effect<unknown, Error>
  runDecision: (request: DecisionRequest) => Effect.Effect<string, Error>
  checkpoint: (request: CheckpointRequest) => Effect.Effect<unknown, Error>
  wait: (ms: number) => Effect.Effect<void, Error>
}

export type RunEvent =
  | { type: "run.started"; run: RunSnapshot }
  | { type: "node.started"; run: RunSnapshot }
  | { type: "node.finished"; run: RunSnapshot }
  | { type: "run.waiting"; run: RunSnapshot }
  | { type: "run.finished"; run: RunSnapshot }
  | { type: "run.failed"; run: RunSnapshot }

type MutableRun = RunSnapshot & {
  nodeStatus: Record<string, NodeRunStatus>
  steps: number
}

export type RunOptions = {
  workflow: Workflow
  input?: unknown
  host: WorkflowHost
  runId?: string
  onEvent?: (event: RunEvent) => Effect.Effect<void>
}

export function createRunId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createRun(workflow: Workflow, input: unknown, id = createRunId()): MutableRun {
  const nodeStatus = Object.fromEntries(nodeIds(workflow).map((nodeId) => [nodeId, "pending" as NodeRunStatus]))
  return {
    id,
    workflow: workflow.name,
    status: "running",
    cursor: workflow.startAt,
    input,
    outputs: {},
    nodeStatus,
    steps: 0,
    nodes: snapshots(workflow, nodeStatus),
  }
}

export const runWorkflow = (options: RunOptions): Effect.Effect<RunSnapshot> =>
  Effect.gen(function* () {
    const run = createRun(options.workflow, options.input ?? {}, options.runId)
    const emit = makeEmit(run, options)
    yield* emit("run.started")
    return yield* Effect.gen(function* () {
      while (run.status === "running") {
        yield* step(run, options, emit)
      }
      return snapshot(run)
    }).pipe(
      Effect.catch((error) => failRun(run, options.workflow, emit, error)),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          run.status = "cancelled"
          run.error = "Workflow cancelled"
        }),
      ),
    )
  })

const step = (
  run: MutableRun,
  options: RunOptions,
  emit: (type: RunEvent["type"]) => Effect.Effect<void>,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    run.steps += 1
    const limit = options.workflow.maxSteps ?? 100
    if (run.steps > limit) {
      return yield* Effect.fail(new Error(`maxSteps (${limit}) exceeded`))
    }
    const include = options.workflow.includes?.[run.cursor]
    if (include) {
      yield* stepInclude(run, options, emit, include.workflow, include.input)
      return
    }
    yield* stepNode(run, options, emit)
  })

const stepNode = (
  run: MutableRun,
  options: RunOptions,
  emit: (type: RunEvent["type"]) => Effect.Effect<void>,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const nodeId = run.cursor
    const node = options.workflow.nodes[nodeId]
    if (!node) {
      return yield* Effect.fail(new Error(`Unknown node "${nodeId}" in workflow "${options.workflow.name}"`))
    }

    run.nodeStatus[nodeId] = node.type === "checkpoint" ? "waiting" : "running"
    yield* emit(node.type === "checkpoint" ? "run.waiting" : "node.started")

    const ctx: NodeCtx = { input: run.input, outputs: run.outputs }
    const output = yield* executeNode(node, nodeId, ctx, options.host)
    run.outputs[nodeId] = output
    run.nodeStatus[nodeId] = "done"
    yield* emit("node.finished")
    yield* advance(run, options, emit, { ...ctx, output })
  })

const stepInclude = (
  run: MutableRun,
  options: RunOptions,
  emit: (type: RunEvent["type"]) => Effect.Effect<void>,
  child: Workflow,
  inputOf: (ctx: NodeCtx) => unknown,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const mount = run.cursor
    run.nodeStatus[mount] = "running"
    yield* emit("node.started")
    const ctx: NodeCtx = { input: run.input, outputs: run.outputs }
    const childRun = yield* runWorkflow({
      workflow: child,
      input: inputOf(ctx),
      host: options.host,
    })
    if (childRun.status !== "done") {
      run.status = childRun.status
      run.error = childRun.error
      run.nodeStatus[mount] = "failed"
      yield* emit(childRun.status === "cancelled" ? "run.failed" : "run.failed")
      return
    }
    const exit = exitOf(child, childRun)
    const output = { choice: exit, exit, outputs: childRun.outputs }
    run.outputs[mount] = output
    run.nodeStatus[mount] = "done"
    yield* emit("node.finished")
    yield* advance(run, options, emit, { ...ctx, output })
  })

const advance = (
  run: MutableRun,
  options: RunOptions,
  emit: (type: RunEvent["type"]) => Effect.Effect<void>,
  ctx: NodeCtx & { output: unknown },
): Effect.Effect<void> =>
  Effect.sync(() => {
    const next = nextNode(options.workflow, run.cursor, ctx)
    if (!next) {
      run.status = "done"
      return
    }
    run.cursor = next
  }).pipe(Effect.flatMap(() => (run.status === "done" ? emit("run.finished") : Effect.void)))

const executeNode = (
  node: WorkflowNode,
  nodeId: string,
  ctx: NodeCtx,
  host: WorkflowHost,
): Effect.Effect<unknown, Error> => {
  switch (node.type) {
    case "compute":
      return Effect.tryPromise({
        try: async () => node.run(ctx),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    case "agent":
      return Effect.promise(() => resolvePrompt(node.prompt, ctx)).pipe(
        Effect.flatMap((prompt) =>
          host.runAgent({ nodeId, prompt, output: node.output, session: node.session }),
        ),
      )
    case "decision":
      return Effect.promise(() => resolvePrompt(node.prompt, ctx)).pipe(
        Effect.flatMap((prompt) =>
          host.runDecision({
            nodeId,
            prompt,
            choices: node.choices,
            state: { input: ctx.input, outputs: ctx.outputs },
            minConfidence: node.minConfidence,
          }),
        ),
        Effect.flatMap((choice) => {
          if (choice !== "uncertain" && !node.choices.includes(choice)) {
            return Effect.fail(
              new Error(`Decision "${nodeId}" returned "${choice}", expected one of: ${node.choices.join(", ")}`),
            )
          }
          return Effect.succeed({ choice })
        }),
      )
    case "checkpoint":
      return Effect.promise(() => resolvePrompt(node.prompt, ctx)).pipe(
        Effect.flatMap((prompt) => host.checkpoint({ nodeId, prompt })),
      )
    case "wait": {
      const ms = typeof node.ms === "number" ? node.ms : node.ms(ctx)
      return host.wait(ms).pipe(Effect.as({ waitedMs: ms }))
    }
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
  if (fallback.length > 1) throw new Error(`Node "${from}" has multiple default edges`)
  if (fallback.length === 1) return fallback[0]?.to
  if (named.length + direct.length > 0 && !matched) {
    throw new Error(`Node "${from}" has edges but none matched`)
  }
  return undefined
}

export function exitOf(workflow: Workflow, child: RunSnapshot): string {
  if (!workflow.exits) return "done"
  for (const [name, exit] of Object.entries(workflow.exits)) {
    if (exit.from === child.cursor) return name
  }
  return "done"
}

function makeEmit(run: MutableRun, options: RunOptions) {
  return (type: RunEvent["type"]) => {
    refresh(run, options.workflow)
    const event = { type, run: snapshot(run) } as RunEvent
    return options.onEvent ? options.onEvent(event) : Effect.void
  }
}

const failRun = (
  run: MutableRun,
  workflow: Workflow,
  emit: (type: RunEvent["type"]) => Effect.Effect<void>,
  error: unknown,
): Effect.Effect<RunSnapshot> =>
  Effect.gen(function* () {
    run.status = "failed"
    run.error = error instanceof Error ? error.message : String(error)
    run.nodeStatus[run.cursor] = "failed"
    refresh(run, workflow)
    yield* emit("run.failed")
    return snapshot(run)
  })

function nodeIds(workflow: Workflow): string[] {
  return [...Object.keys(workflow.nodes), ...Object.keys(workflow.includes ?? {})]
}

function refresh(run: MutableRun, workflow: Workflow): void {
  run.nodes = snapshots(workflow, run.nodeStatus)
}

function snapshots(workflow: Workflow, nodeStatus: Record<string, NodeRunStatus>): NodeSnapshot[] {
  const nodes = Object.entries(workflow.nodes).map(([id, node]) => ({
    id,
    type: node.type,
    status: nodeStatus[id] ?? "pending",
  }))
  const includes = Object.keys(workflow.includes ?? {}).map((id) => ({
    id,
    type: "include" as const,
    status: nodeStatus[id] ?? "pending",
  }))
  return [...nodes, ...includes]
}

function snapshot(run: MutableRun): RunSnapshot {
  const { nodeStatus: _, steps: __, ...rest } = run
  return {
    ...rest,
    outputs: { ...run.outputs },
    nodes: run.nodes.map((node) => ({ ...node })),
  }
}

function choiceOf(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined
  const choice = (output as { choice?: unknown }).choice
  return typeof choice === "string" ? choice : undefined
}
