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
}

export type DecisionNode = {
  type: "decision"
  prompt: string | ((ctx: NodeCtx) => string | Promise<string>)
  choices: readonly string[]
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
  }
}

export function decision(spec: Omit<DecisionNode, "type">): DecisionNode {
  return { type: "decision", prompt: spec.prompt, choices: spec.choices }
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
  if (!workflow.name.trim()) throw new Error("Workflow name is required")
  if (RESERVED_WORKFLOW_NAMES.has(workflow.name)) {
    throw new Error(`Workflow name "${workflow.name}" is reserved`)
  }
  if (!hasStart(workflow)) {
    throw new Error(`startAt "${workflow.startAt}" is not a node or include in "${workflow.name}"`)
  }
  return workflow
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
