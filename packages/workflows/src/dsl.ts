export const RESERVED_WORKFLOW_NAMES = new Set([
  "answer",
  "cancel",
  "help",
  "list",
  "pause",
  "resume",
  "status",
])

export type NodeCtx<I = unknown> = {
  input: I
  outputs: Record<string, unknown>
}

export type ComputeNode = {
  type: "compute"
  run: (ctx: NodeCtx) => unknown | Promise<unknown>
}

export type AgentNode = {
  type: "agent"
  prompt: string | ((ctx: NodeCtx) => string | Promise<string>)
  output: "json" | "assistant"
  session: "child" | "origin"
  validate?: (output: unknown) => boolean
}

export type DecisionNode = {
  type: "decision"
  prompt: string | ((ctx: NodeCtx) => string | Promise<string>)
  choices: readonly string[]
  minConfidence?: number
}

export type CheckpointNode = {
  type: "checkpoint"
  prompt: string | ((ctx: NodeCtx) => string | Promise<string>)
}

export type WaitNode = {
  type: "wait"
  ms: number | ((ctx: NodeCtx) => number)
}

export type WorkflowNode = ComputeNode | AgentNode | DecisionNode | CheckpointNode | WaitNode

export type Edge = {
  from: string
  to: string
  when?: (ctx: NodeCtx & { output: unknown }) => boolean
}

export type IncludeSpec = {
  workflow: Workflow
  input: (ctx: NodeCtx) => unknown
}

export type Workflow = {
  name: string
  startAt: string
  nodes: Record<string, WorkflowNode>
  edges: readonly Edge[]
  includes?: Record<string, IncludeSpec>
  exits?: Record<string, { from: string }>
  maxSteps?: number
}

export function compute(spec: { run: ComputeNode["run"] }): ComputeNode {
  return { type: "compute", run: spec.run }
}

export function agent(
  spec: Omit<AgentNode, "type" | "output" | "session"> & {
    output?: AgentNode["output"]
    session?: AgentNode["session"]
  },
): AgentNode {
  return {
    type: "agent",
    prompt: spec.prompt,
    output: spec.output ?? "json",
    session: spec.session ?? "child",
    validate: spec.validate,
  }
}

export function decision(spec: Omit<DecisionNode, "type">): DecisionNode {
  return {
    type: "decision",
    prompt: spec.prompt,
    choices: spec.choices,
    minConfidence: spec.minConfidence,
  }
}

export function checkpoint(spec: Omit<CheckpointNode, "type">): CheckpointNode {
  return { type: "checkpoint", prompt: spec.prompt }
}

export function wait(spec: { ms: WaitNode["ms"] }): WaitNode {
  return { type: "wait", ms: spec.ms }
}

export function includeWorkflow(workflow: Workflow, spec: { input: IncludeSpec["input"] }): IncludeSpec {
  return { workflow, input: spec.input }
}

export function defineWorkflow<W extends Workflow>(workflow: W): W {
  validateWorkflow(workflow)
  return workflow
}

export function validateWorkflow(workflow: Workflow): void {
  if (!workflow.name.trim()) throw new Error("Workflow name is required")
  if (RESERVED_WORKFLOW_NAMES.has(workflow.name)) {
    throw new Error(`Workflow name "${workflow.name}" is reserved`)
  }
  if (!hasStart(workflow)) {
    throw new Error(`startAt "${workflow.startAt}" is not a node or include in "${workflow.name}"`)
  }
  const ids = new Set([...Object.keys(workflow.nodes), ...Object.keys(workflow.includes ?? {})])
  if (ids.size !== Object.keys(workflow.nodes).length + Object.keys(workflow.includes ?? {}).length) {
    throw new Error(`Node and include names overlap in "${workflow.name}"`)
  }
  for (const edge of workflow.edges) {
    const from = edge.from.split(".")[0]!
    if (!ids.has(from) || !ids.has(edge.to)) {
      throw new Error(`Invalid edge ${edge.from} → ${edge.to} in "${workflow.name}"`)
    }
    const choices = workflow.nodes[from]?.type === "decision"
      ? (workflow.nodes[from] as DecisionNode).choices
      : workflow.includes?.[from]?.workflow.exits
        ? Object.keys(workflow.includes[from]!.workflow.exits!)
        : undefined
    const label = edge.from.slice(from.length + 1)
    if (edge.from !== from && choices && !choices.includes(label) && label !== "uncertain") {
      throw new Error(`Unknown route "${edge.from}" in "${workflow.name}"`)
    }
  }
  for (const [id, node] of Object.entries(workflow.nodes)) {
    if (node.type !== "decision") continue
    if (node.minConfidence !== undefined && (!Number.isFinite(node.minConfidence) || node.minConfidence < 0 || node.minConfidence > 1)) {
      throw new Error(`Decision "${id}" has invalid minConfidence`)
    }
    const direct = workflow.edges.some((edge) => edge.from === id)
    for (const choice of [...node.choices, ...(node.minConfidence === undefined ? [] : ["uncertain"])]) {
      if (!direct && !workflow.edges.some((edge) => edge.from === `${id}.${choice}`)) {
        throw new Error(`Decision "${id}" has no route for "${choice}"`)
      }
    }
  }
  for (const [id, include] of Object.entries(workflow.includes ?? {})) {
    const direct = workflow.edges.some((edge) => edge.from === id)
    for (const exit of Object.keys(include.workflow.exits ?? { done: {} })) {
      if (!direct && !workflow.edges.some((edge) => edge.from === `${id}.${exit}`)) {
        throw new Error(`Include "${id}" has no route for "${exit}"`)
      }
    }
  }
  for (const [name, exit] of Object.entries(workflow.exits ?? {})) {
    if (!ids.has(exit.from) || workflow.edges.some((edge) => edge.from === exit.from || edge.from.startsWith(`${exit.from}.`))) {
      throw new Error(`Exit "${name}" must point to a terminal node in "${workflow.name}"`)
    }
  }
}

export function isWorkflow(value: unknown): value is Workflow {
  if (typeof value !== "object" || value === null) return false
  const workflow = value as Partial<Workflow>
  return (
    typeof workflow.name === "string" &&
    typeof workflow.startAt === "string" &&
    typeof workflow.nodes === "object" &&
    workflow.nodes !== null &&
    Array.isArray(workflow.edges)
  )
}

export async function resolvePrompt(
  prompt: string | ((ctx: NodeCtx) => string | Promise<string>),
  ctx: NodeCtx,
): Promise<string> {
  return typeof prompt === "string" ? prompt : prompt(ctx)
}

function hasStart(workflow: Workflow): boolean {
  return Boolean(workflow.nodes[workflow.startAt] || workflow.includes?.[workflow.startAt])
}
