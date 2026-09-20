import { Deferred, Effect } from "effect"
import { RESERVED_WORKFLOW_NAMES, type Workflow } from "./dsl.ts"
import type { RunSnapshot } from "./engine.ts"
import type { RunRegistry } from "./registry.ts"
import { cancelRun } from "./runner.ts"

export function summaries(workflows: Workflow[]) {
  return workflows.map((workflow) => ({
    name: workflow.name,
    startAt: workflow.startAt,
    nodes: [...Object.keys(workflow.nodes), ...Object.keys(workflow.includes ?? {})],
  }))
}

export const handleCommand = (options: {
  text: string
  sessionID: string
  workflows: Workflow[]
  registry: RunRegistry
  launch: (workflow: Workflow, input: unknown, originSessionID?: string) => Effect.Effect<RunSnapshot>
}): Effect.Effect<string> =>
  Effect.gen(function* () {
    const [head, ...rest] = options.text.split(/\s+/).filter(Boolean)
    if (!head || head === "list") return formatList(options.workflows)
    if (head === "status") {
      const run = options.registry.get(rest[0])
      return run ? formatRun(run) : "No workflow run."
    }
    if (head === "cancel") {
      const run = options.registry.get(rest[0])
      if (!run) return "No workflow run to cancel."
      const cancelled = yield* cancelRun(options.registry, run.id)
      return formatRun(cancelled ?? run)
    }
    if (head === "answer") {
      const run = options.registry.busy()
      if (!run) return "No workflow is waiting for an answer."
      const pending = options.registry.checkpoints.get(run.id)
      if (!pending) return `Run ${run.id} is not waiting.`
      yield* Deferred.succeed(pending, parseAnswer(rest.join(" ")))
      return `Answered ${run.id}.`
    }
    if (RESERVED_WORKFLOW_NAMES.has(head)) return `Unknown workflow command "${head}".`

    const workflow = options.workflows.find((item) => item.name === head)
    if (!workflow) return `Unknown workflow "${head}".\n\n${formatList(options.workflows)}`
    const busy = options.registry.busy()
    if (busy) return `Busy: ${busy.id} is ${busy.status}`
    const run = yield* options.launch(workflow, { task: rest.join(" ") || undefined }, options.sessionID)
    return formatRun(run)
  })

export const handleTool = (options: {
  action: string
  name?: string
  task?: string
  runId?: string
  result?: unknown
  value?: unknown
  sessionID?: string
  workflows: Workflow[]
  registry: RunRegistry
  launch: (workflow: Workflow, input: unknown, originSessionID?: string) => Effect.Effect<RunSnapshot>
}): Effect.Effect<string> =>
  Effect.gen(function* () {
    if (options.action === "list") return JSON.stringify(summaries(options.workflows), null, 2)
    if (options.action === "start") {
      const workflow = options.workflows.find((item) => item.name === options.name)
      if (!workflow) return `Unknown workflow "${options.name ?? ""}"`
      const busy = options.registry.busy()
      if (busy) return `Busy: ${busy.id} is ${busy.status}`
      const run = yield* options.launch(workflow, { task: options.task }, options.sessionID)
      return JSON.stringify(run, null, 2)
    }
    if (options.action === "status") {
      return JSON.stringify(options.registry.get(options.runId) ?? null, null, 2)
    }
    if (options.action === "cancel") {
      const run = options.registry.get(options.runId)
      if (!run) return "No active run"
      return JSON.stringify(yield* cancelRun(options.registry, run.id), null, 2)
    }
    if (options.action === "submit") {
      const agent = options.sessionID ? options.registry.agents.get(options.sessionID) : undefined
      if (!agent) return "No agent step is waiting for submit in this session"
      yield* Deferred.succeed(agent.deferred, options.result ?? {})
      options.registry.agents.delete(options.sessionID!)
      return "submitted"
    }
    if (options.action === "answer") {
      const run = options.registry.get(options.runId)
      if (!run) return "No workflow is waiting"
      const pending = options.registry.checkpoints.get(run.id)
      if (!pending) return `Run ${run.id} is not waiting.`
      yield* Deferred.succeed(pending, options.value ?? options.result ?? {})
      return `Answered ${run.id}.`
    }
    return `Unknown action "${options.action}"`
  })

export function formatList(workflows: Workflow[]): string {
  if (workflows.length === 0) {
    return "No workflows found. Put files in .opencode/workflows/*.workflow.ts"
  }
  return workflows
    .map((workflow) => `${workflow.name}  (${Object.keys(workflow.nodes).join(" → ")})`)
    .join("\n")
}

export function formatRun(run: RunSnapshot): string {
  const nodes = run.nodes.map((node) => `${glyph(node.status)} ${node.id}`).join("\n")
  return [`${run.workflow}  ${run.status}  ${run.id}`, nodes, run.error ?? ""].filter(Boolean).join("\n")
}

function glyph(status: string): string {
  switch (status) {
    case "done":
      return "✓"
    case "running":
      return "▶"
    case "waiting":
      return "⏸"
    case "failed":
      return "✕"
    default:
      return "·"
  }
}

function parseAnswer(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}
