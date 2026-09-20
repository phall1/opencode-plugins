import { Plugin } from "@opencode/plugin"
import { discoverWorkflows } from "./discover.ts"
import { RESERVED_WORKFLOW_NAMES, type Workflow } from "./dsl.ts"
import type { RunSnapshot } from "./engine.ts"
import { RunRegistry } from "./registry.ts"
import { Workflows } from "./rpc.ts"
import { startRun } from "./runner.ts"

export { agent, checkpoint, compute, decision, defineWorkflow } from "./dsl.ts"
export type { Edge, Workflow, WorkflowNode } from "./dsl.ts"
export { Workflows } from "./rpc.ts"

const registry = new RunRegistry()

export default Plugin.define({
  id: "phall.workflows",
  async setup(ctx) {
    let workflows: Workflow[] = []
    const reload = async () => {
      workflows = await discoverWorkflows(ctx.location.directory)
    }
    await reload()

    let emit = async (_run: RunSnapshot) => {}
    const launch = (workflow: Workflow, input: unknown, originSessionID?: string) =>
      startRun({ workflow, input, ctx, registry, originSessionID, emit })

    const rpc = await ctx.rpc.register(Workflows, {
      list: async () => {
        await reload()
        return { workflows: summaries(workflows) }
      },
      start: async (input, context) => {
        await reload()
        const workflow = workflows.find((item) => item.name === input.name)
        if (!workflow) return context.error("not_found", `Unknown workflow "${input.name}"`, { name: input.name })
        const busy = registry.busy()
        if (busy) return context.error("busy", `Workflow ${busy.id} is still ${busy.status}`, { runId: busy.id })
        return { run: launch(workflow, { task: input.task }, input.sessionID) }
      },
      status: async (input) => ({ run: registry.get((input as { runId?: string }).runId) }),
      cancel: async (input) => {
        const run = registry.get((input as { runId?: string }).runId)
        return { run: run ? registry.cancel(run.id) : undefined }
      },
      answer: async (input, context) => {
        const run = registry.get((input as { runId?: string }).runId)
        if (!run) return context.error("not_waiting", "No workflow is waiting", { runId: "" })
        const pending = registry.checkpoints.get(run.id)
        if (!pending) return context.error("not_waiting", `Run ${run.id} is not waiting`, { runId: run.id })
        pending.resolve((input as { value: unknown }).value)
        return { run: registry.get(run.id) ?? run }
      },
    })

    emit = async (run: RunSnapshot) => {
      registry.put(run)
      await rpc.events.emit("updated", { run })
    }

    await ctx.command.transform((editor) => {
      editor.add({
        name: "workflow",
        description: "List, start, or control a workflow",
        execute: async ({ sessionID, prompt }) => {
          await reload()
          const text = handleCommand(prompt.text.trim(), sessionID, workflows, launch)
          await ctx.session.synthetic({ sessionID, text })
        },
      })
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "workflow",
        description: "List, start, inspect, cancel, or submit output for a workflow run",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list", "start", "status", "cancel", "submit"] },
            name: { type: "string" },
            task: { type: "string" },
            runId: { type: "string" },
            result: {},
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          await reload()
          return { content: await handleTool(input, context, workflows, launch) }
        },
      })
    })
  },
})

function prepare(
  name: string,
  workflows: Workflow[],
):
  | { workflow: Workflow }
  | { error: "not_found"; message: string; data: { name: string } }
  | { error: "busy"; message: string; data: { runId: string } } {
  const workflow = workflows.find((item) => item.name === name)
  if (!workflow) return { error: "not_found", message: `Unknown workflow "${name}"`, data: { name } }
  const busy = registry.busy()
  if (busy) return { error: "busy", message: `Workflow ${busy.id} is still ${busy.status}`, data: { runId: busy.id } }
  return { workflow }
}

function handleCommand(
  text: string,
  sessionID: string,
  workflows: Workflow[],
  launch: (workflow: Workflow, input: unknown, originSessionID?: string) => RunSnapshot,
): string {
  const [head, ...rest] = text.split(/\s+/).filter(Boolean)
  if (!head || head === "list") return formatList(workflows)
  if (head === "status") {
    const run = registry.get(rest[0])
    return run ? formatRun(run) : "No workflow run."
  }
  if (head === "cancel") {
    const run = registry.get(rest[0])
    if (!run) return "No workflow run to cancel."
    return formatRun(registry.cancel(run.id) ?? run)
  }
  if (head === "answer") {
    const run = registry.busy()
    if (!run) return "No workflow is waiting for an answer."
    const pending = registry.checkpoints.get(run.id)
    if (!pending) return `Run ${run.id} is not waiting.`
    pending.resolve(parseAnswer(rest.join(" ")))
    return `Answered ${run.id}.`
  }
  if (RESERVED_WORKFLOW_NAMES.has(head)) return `Unknown workflow command "${head}".`

  const workflow = workflows.find((item) => item.name === head)
  if (!workflow) return `Unknown workflow "${head}".\n\n${formatList(workflows)}`
  const busy = registry.busy()
  if (busy) return `Busy: ${busy.id} is ${busy.status}`
  return formatRun(launch(workflow, { task: rest.join(" ") || undefined }, sessionID))
}

async function handleTool(
  input: unknown,
  context: unknown,
  workflows: Workflow[],
  launch: (workflow: Workflow, input: unknown, originSessionID?: string) => RunSnapshot,
): Promise<string> {
  const body = input as { action: string; name?: string; task?: string; runId?: string; result?: unknown }
  if (body.action === "list") return JSON.stringify(summaries(workflows), null, 2)
  if (body.action === "start") {
    const prepared = prepare(body.name ?? "", workflows)
    if ("error" in prepared) return prepared.message
    return JSON.stringify(launch(prepared.workflow, { task: body.task }, sessionIDOf(context)), null, 2)
  }
  if (body.action === "status") return JSON.stringify(registry.get(body.runId) ?? null, null, 2)
  if (body.action === "cancel") {
    const run = registry.get(body.runId)
    if (!run) return "No active run"
    return JSON.stringify(registry.cancel(run.id), null, 2)
  }
  if (body.action === "submit") {
    const agent = sessionIDOf(context) ? registry.agents.get(sessionIDOf(context)!) : undefined
    if (!agent) return "No agent step is waiting for submit in this session"
    agent.resolve(body.result ?? {})
    return "submitted"
  }
  return `Unknown action "${body.action}"`
}

function summaries(workflows: Workflow[]) {
  return workflows.map((workflow) => ({
    name: workflow.name,
    startAt: workflow.startAt,
    nodes: Object.keys(workflow.nodes),
  }))
}

function sessionIDOf(context: unknown): string | undefined {
  if (typeof context !== "object" || context === null) return undefined
  const sessionID = (context as { sessionID?: unknown }).sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function formatList(workflows: Workflow[]): string {
  if (workflows.length === 0) {
    return "No workflows found. Put files in .opencode/workflows/*.workflow.ts"
  }
  return workflows.map((workflow) => `${workflow.name}  (${Object.keys(workflow.nodes).join(" → ")})`).join("\n")
}

function formatRun(run: RunSnapshot): string {
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
