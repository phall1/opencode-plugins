import { Effect } from "effect"
import { resolvePrompt, type Edge, type NodeCtx, type Workflow, type WorkflowNode } from "./dsl.ts"

export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled"

export type NodeRunStatus = "pending" | "running" | "done" | "failed" | "waiting"

export type NodeSnapshot = {
  id: string
  type: WorkflowNode["type"] | "include"
  status: NodeRunStatus
  startedAt?: number
  finishedAt?: number
  sessionID?: string
  detail?: string
  choices?: string[]
  prompt?: string
  output?: unknown
  decision?: { source: "jev" | "generate"; confidence: number; probabilities: Record<string, number> }
  child?: RunSnapshot
}

export type EdgeSnapshot = {
  from: string
  to: string
  label?: string
}

export type RunSnapshot = {
  id: string
  workflow: string
  status: RunStatus
  cursor: string
  startedAt: number
  input: unknown
  outputs: Record<string, unknown>
  error?: string
  nodes: NodeSnapshot[]
  edges: EdgeSnapshot[]
}

export type AgentRequest = {
  nodeId: string
  path: string
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
  runDecision: (request: DecisionRequest) => Effect.Effect<{ choice: string; source: "jev" | "generate"; confidence: number; probabilities: Record<string, number> }, Error>
  checkpoint: (request: CheckpointRequest) => Effect.Effect<unknown, Error>
  wait: (ms: number) => Effect.Effect<void, Error>
}

export type RunEvent =
  | { type: "run.started"; run: RunSnapshot }
  | { type: "node.started"; run: RunSnapshot }
  | { type: "node.updated"; run: RunSnapshot }
  | { type: "node.finished"; run: RunSnapshot }
  | { type: "run.waiting"; run: RunSnapshot }
  | { type: "run.finished"; run: RunSnapshot }
  | { type: "run.failed"; run: RunSnapshot }

type NodeMeta = {
  startedAt?: number
  finishedAt?: number
  sessionID?: string
  detail?: string
  choices?: string[]
  prompt?: string
  output?: unknown
  decision?: NodeSnapshot["decision"]
  child?: RunSnapshot
}

type MutableRun = RunSnapshot & {
  nodeStatus: Record<string, NodeRunStatus>
  nodeMeta: Record<string, NodeMeta>
  steps: number
}

export type RunOptions = {
  workflow: Workflow
  input?: unknown
  host: WorkflowHost
  runId?: string
  path?: string
  onEvent?: (event: RunEvent) => Effect.Effect<void>
}

export function createRunId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createRun(workflow: Workflow, input: unknown, id = createRunId()): MutableRun {
  const nodeStatus = Object.fromEntries(nodeIds(workflow).map((nodeId) => [nodeId, "pending" as NodeRunStatus]))
  const nodeMeta: Record<string, NodeMeta> = {}
  return {
    id,
    workflow: workflow.name,
    status: "running",
    cursor: workflow.startAt,
    startedAt: Date.now(),
    input,
    outputs: {},
    nodeStatus,
    nodeMeta,
    steps: 0,
    nodes: snapshots(workflow, nodeStatus, nodeMeta),
    edges: edgeSnapshots(workflow),
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

    const ctx: NodeCtx = { input: run.input, outputs: run.outputs }
    run.nodeMeta[nodeId] = yield* beginMeta(node, ctx)
    run.nodeStatus[nodeId] = node.type === "checkpoint" ? "waiting" : "running"
    yield* emit(node.type === "checkpoint" ? "run.waiting" : "node.started")

    const result = yield* executeNode(node, nodeId, ctx, options.host, run.nodeMeta[nodeId].prompt, options.path ? `${options.path}.${nodeId}` : nodeId)
    const output = node.type === "decision" ? { choice: (result as { choice: string }).choice } : result
    run.outputs[nodeId] = output
    run.nodeStatus[nodeId] = "done"
    run.nodeMeta[nodeId] = finishMeta(run.nodeMeta[nodeId], output)
    if (node.type === "decision") {
      const judged = result as NonNullable<NodeSnapshot["decision"]> & { choice: string }
      run.nodeMeta[nodeId].decision = { source: judged.source, confidence: judged.confidence, probabilities: judged.probabilities }
    }
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
    run.nodeMeta[mount] = { startedAt: Date.now() }
    run.nodeStatus[mount] = "running"
    yield* emit("node.started")
    const ctx: NodeCtx = { input: run.input, outputs: run.outputs }
    const childInput = yield* Effect.try({ try: () => inputOf(ctx), catch: asError })
    const childRun = yield* runWorkflow({
      workflow: child,
      input: childInput,
      host: options.host,
      path: options.path ? `${options.path}.${mount}` : mount,
      onEvent: (event) => Effect.sync(() => {
        run.nodeMeta[mount] = { ...run.nodeMeta[mount], child: event.run }
      }).pipe(Effect.andThen(emit("node.updated"))),
    })
    run.nodeMeta[mount] = { ...run.nodeMeta[mount], child: childRun }
    if (childRun.status !== "done") {
      run.status = childRun.status
      run.error = childRun.error
      run.nodeStatus[mount] = "failed"
      run.nodeMeta[mount] = { ...run.nodeMeta[mount], finishedAt: Date.now(), detail: childRun.error }
      yield* emit(childRun.status === "cancelled" ? "run.failed" : "run.failed")
      return
    }
    const exit = yield* Effect.try({ try: () => exitOf(child, childRun), catch: asError })
    const output = { choice: exit, exit, outputs: childRun.outputs }
    run.outputs[mount] = output
    run.nodeStatus[mount] = "done"
    run.nodeMeta[mount] = finishMeta(run.nodeMeta[mount], output)
    yield* emit("node.finished")
    yield* advance(run, options, emit, { ...ctx, output })
  })

const advance = (
  run: MutableRun,
  options: RunOptions,
  emit: (type: RunEvent["type"]) => Effect.Effect<void>,
  ctx: NodeCtx & { output: unknown },
): Effect.Effect<void, Error> =>
  Effect.try({ try: () => {
    const next = nextNode(options.workflow, run.cursor, ctx)
    if (!next) {
      run.status = "done"
      return
    }
    run.cursor = next
  }, catch: asError }).pipe(Effect.flatMap(() => (run.status === "done" ? emit("run.finished") : Effect.void)))

const executeNode = (
  node: WorkflowNode,
  nodeId: string,
  ctx: NodeCtx,
  host: WorkflowHost,
  prompt?: string,
  path = nodeId,
): Effect.Effect<unknown, Error> => {
  switch (node.type) {
    case "compute":
      return Effect.tryPromise({
        try: async () => node.run(ctx),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    case "agent":
      return host.runAgent({ nodeId, path, prompt: prompt!, output: node.output, session: node.session }).pipe(
        Effect.flatMap((output) => {
          if (node.output === "json" && (!output || typeof output !== "object" || Array.isArray(output))) {
            return Effect.fail(new Error(`Agent "${nodeId}" did not return a JSON object`))
          }
          if (node.validate) return Effect.try({
            try: () => {
              if (!node.validate!(output)) throw new Error(`Agent "${nodeId}" returned an invalid result`)
              return output
            },
            catch: asError,
          })
          return Effect.succeed(output)
        }),
      )
    case "decision":
      return host.runDecision({
            nodeId,
            prompt: prompt!,
            choices: node.choices,
            state: { input: ctx.input, outputs: ctx.outputs },
            minConfidence: node.minConfidence,
          }).pipe(
        Effect.flatMap((choice) => {
          if (choice.choice !== "uncertain" && !node.choices.includes(choice.choice)) {
            return Effect.fail(
              new Error(`Decision "${nodeId}" returned "${choice.choice}", expected one of: ${node.choices.join(", ")}`),
            )
          }
          return Effect.succeed(choice)
        }),
      )
    case "checkpoint":
      return host.checkpoint({ nodeId, prompt: prompt! })
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
  if (candidates.length === 0) {
    if (workflow.nodes[from]?.type === "decision" || workflow.includes?.[from] || workflow.edges.some((edge) => edge.from === from || edge.from.startsWith(`${from}.`))) {
      throw new Error(`No route from "${from}"${choice ? ` for choice "${choice}"` : ""}`)
    }
    return undefined
  }

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
  throw new Error(`Workflow "${workflow.name}" ended at undeclared exit "${child.cursor}"`)
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
    run.nodeMeta[run.cursor] = {
      ...run.nodeMeta[run.cursor],
      finishedAt: Date.now(),
      detail: run.error,
    }
    refresh(run, workflow)
    yield* emit("run.failed")
    return snapshot(run)
  })

function nodeIds(workflow: Workflow): string[] {
  return [...Object.keys(workflow.nodes), ...Object.keys(workflow.includes ?? {})]
}

function refresh(run: MutableRun, workflow: Workflow): void {
  run.nodes = snapshots(workflow, run.nodeStatus, run.nodeMeta)
}

function snapshots(
  workflow: Workflow,
  nodeStatus: Record<string, NodeRunStatus>,
  nodeMeta: Record<string, NodeMeta>,
): NodeSnapshot[] {
  const nodes = Object.entries(workflow.nodes).map(([id, node]) =>
    publicNode(id, node.type, nodeStatus[id] ?? "pending", nodeMeta[id]),
  )
  const includes = Object.keys(workflow.includes ?? {}).map((id) =>
    publicNode(id, "include", nodeStatus[id] ?? "pending", nodeMeta[id]),
  )
  return [...nodes, ...includes]
}

function publicNode(
  id: string,
  type: NodeSnapshot["type"],
  status: NodeRunStatus,
  meta: NodeMeta | undefined,
): NodeSnapshot {
  return {
    id,
    type,
    status,
    ...(meta?.startedAt ? { startedAt: meta.startedAt } : {}),
    ...(meta?.finishedAt ? { finishedAt: meta.finishedAt } : {}),
    ...(meta?.sessionID ? { sessionID: meta.sessionID } : {}),
    ...(meta?.detail ? { detail: meta.detail } : {}),
    ...(meta?.choices && meta.choices.length > 0 ? { choices: [...meta.choices] } : {}),
    ...(meta?.prompt ? { prompt: meta.prompt } : {}),
    ...("output" in (meta ?? {}) ? { output: meta?.output } : {}),
    ...(meta?.decision ? { decision: meta.decision } : {}),
    ...(meta?.child ? { child: meta.child } : {}),
  }
}

export function edgeSnapshots(workflow: Workflow): EdgeSnapshot[] {
  const ids = new Set(nodeIds(workflow))
  return workflow.edges.map((edge) => labeledEdge(edge, ids))
}

function labeledEdge(edge: Edge, ids: Set<string>): EdgeSnapshot {
  const dot = edge.from.indexOf(".")
  if (dot <= 0) return { from: edge.from, to: edge.to }
  const from = edge.from.slice(0, dot)
  if (!ids.has(from)) return { from: edge.from, to: edge.to }
  return { from, to: edge.to, label: edge.from.slice(dot + 1) }
}

const beginMeta = (node: WorkflowNode, ctx: NodeCtx): Effect.Effect<NodeMeta, Error> =>
  Effect.gen(function* () {
    const meta: NodeMeta = { startedAt: Date.now() }
    if (node.type === "decision") meta.choices = [...node.choices]
    if (node.type === "agent" || node.type === "decision" || node.type === "checkpoint") {
      meta.detail = yield* Effect.tryPromise({ try: () => resolvePrompt(node.prompt, ctx), catch: asError })
      meta.prompt = meta.detail
    }
    return meta
  })

function finishMeta(meta: NodeMeta | undefined, output: unknown): NodeMeta {
  const choice = choiceOf(output)
  return {
    ...meta,
    finishedAt: Date.now(),
    output,
    ...(choice ? { detail: choice } : {}),
  }
}

export function toSnapshot(run: MutableRun | RunSnapshot): RunSnapshot {
  const meta = "nodeMeta" in run ? run.nodeMeta : undefined
  return {
    id: run.id,
    workflow: run.workflow,
    status: run.status,
    cursor: run.cursor,
    startedAt: run.startedAt,
    input: run.input ?? null,
    outputs: run.outputs,
    ...(run.error ? { error: run.error } : {}),
    nodes: run.nodes.map((node) => publicNode(node.id, node.type, node.status, { ...node, ...meta?.[node.id] })),
    edges: run.edges ?? [],
  }
}

function snapshot(run: MutableRun): RunSnapshot {
  return toSnapshot(run)
}

function choiceOf(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined
  const choice = (output as { choice?: unknown }).choice
  return typeof choice === "string" ? choice : undefined
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
