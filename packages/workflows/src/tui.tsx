import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import type { RunSnapshot } from "./engine.ts"
import { Workflows } from "./rpc.ts"

type WorkflowSummary = {
  name: string
  startAt: string
  nodes: string[]
}

type Rpc = {
  list: (input?: object) => Promise<{ workflows: WorkflowSummary[] }>
  start: (input: { name: string; task?: string; sessionID?: string }) => Promise<{ run: RunSnapshot }>
  status: (input?: { runId?: string }) => Promise<{ run?: RunSnapshot }>
  cancel: (input?: { runId?: string }) => Promise<{ run?: RunSnapshot }>
  answer: (input: { value: unknown; runId?: string }) => Promise<{ run: RunSnapshot }>
  events: { on: (name: string, handler: (event: { data: { run: RunSnapshot } }) => void) => () => void }
}

export default Plugin.define({
  id: "phall.workflows.cli",
  setup(context) {
    const rpc = context.client.rpc(Workflows as any) as unknown as Rpc
    const [active, setActive] = context.storage.memory("active-run", {
      initial: { run: null as RunSnapshot | null },
    })

    const stop = rpc.events.on("updated", (event) => {
      setActive((draft) => {
        draft.run = event.data.run
      })
    })

    void rpc.status({}).then((result) => {
      if (result.run) {
        setActive((draft) => {
          draft.run = result.run ?? null
        })
      }
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "phall.workflows.run",
          title: "Workflow",
          group: "Workflows",
          palette: true,
          slash: { name: "workflow", arguments: true },
          run: (input) => {
            void handleSlash(context, rpc, input)
          },
        },
        {
          id: "phall.workflows.panel",
          title: "Workflow graph",
          group: "Workflows",
          slash: { name: "workflow-graph" },
          run: () => {
            context.ui.panel.open("phall.workflows")
          },
        },
      ],
    }))

    const unslotStatus = context.ui.slot({
      append: "prompt.footer.status",
      render: () => <Status run={active.run} />,
    })

    const unslotPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "phall.workflows"}>
          <Graph run={active.run} />
        </Show>
      ),
    })

    return () => {
      stop()
      unslotStatus()
      unslotPanel()
    }
  },
})

async function handleSlash(
  context: ReturnType<typeof usePlugin>,
  rpc: Rpc,
  input?: string,
): Promise<void> {
  const [head, ...rest] = (input ?? "").trim().split(/\s+/).filter(Boolean)
  const sessionID = sessionIDOf(context)

  if (head === "status") {
    const result = await rpc.status({ runId: rest[0] })
    const run = result.run
    context.ui.panel.open("phall.workflows")
    await context.ui.dialog.alert({
      title: run ? `${run.workflow} · ${run.status}` : "Workflow",
      message: run ? formatRun(run) : "No workflow run.",
    })
    return
  }

  if (head === "cancel") {
    const result = await rpc.cancel({ runId: rest[0] })
    context.ui.toast.show({
      title: "Workflow",
      message: result.run ? `${result.run.workflow} cancelled` : "No run to cancel",
      variant: result.run ? "success" : "warning",
    })
    return
  }

  if (head === "answer") {
    await rpc.answer({ value: parseAnswer(rest.join(" ")) })
    context.ui.toast.show({ title: "Workflow", message: "Answered", variant: "success" })
    return
  }

  const listed = await rpc.list({})
  const workflows = listed.workflows ?? []
  const name = head && head !== "list" ? head : await pickWorkflow(context, workflows)
  if (!name) return

  const task = rest.join(" ") || (head ? undefined : await promptTask(context, name))
  if (task === undefined && !head) return

  if (!sessionID) {
    await context.ui.dialog.alert({
      title: "Workflow",
      message: "Open a session first, then run /workflow.",
    })
    return
  }

  try {
    const started = await rpc.start({ name, task: task || undefined, sessionID })
    setActiveRun(context, started.run)
    context.ui.panel.open("phall.workflows")
    context.ui.toast.show({
      title: name,
      message: started.run.status,
      variant: "success",
    })
  } catch (error) {
    context.ui.toast.show({
      title: "Workflow",
      message: error instanceof Error ? error.message : String(error),
      variant: "error",
    })
  }
}

async function pickWorkflow(
  context: ReturnType<typeof usePlugin>,
  workflows: WorkflowSummary[],
): Promise<string | undefined> {
  if (workflows.length === 0) {
    await context.ui.dialog.alert({
      title: "Workflow",
      message: "No workflows found.",
    })
    return undefined
  }
  return context.ui.dialog.select({
    title: "Start workflow",
    options: workflows.map((workflow) => ({
      title: workflow.name,
      value: workflow.name,
      description: workflow.nodes.join(" → "),
    })),
  })
}

async function promptTask(context: ReturnType<typeof usePlugin>, name: string): Promise<string | undefined> {
  return context.ui.dialog.prompt({
    title: name,
    description: "Optional task / input. Leave empty to start without one.",
    placeholder: "what should it do?",
  })
}

function sessionIDOf(context: ReturnType<typeof usePlugin>): string | undefined {
  const route = context.ui.router.current()
  return route?.type === "session" ? route.sessionID : undefined
}

function setActiveRun(context: ReturnType<typeof usePlugin>, run: RunSnapshot): void {
  const [, update] = context.storage.memory("active-run", {
    initial: { run: null as RunSnapshot | null },
  })
  update((draft) => {
    draft.run = run
  })
}

function formatRun(run: RunSnapshot): string {
  const nodes = run.nodes.map((node) => `${node.status} ${node.id}`).join("\n")
  return [run.id, nodes, run.error ?? ""].filter(Boolean).join("\n")
}

function parseAnswer(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

function Status(props: { run: RunSnapshot | null }) {
  const context = usePlugin()
  return (
    <Show when={props.run}>
      <text fg={context.theme.text.muted}>
        {props.run?.workflow}:{props.run?.cursor} {props.run?.status}
      </text>
    </Show>
  )
}

function Graph(props: { run: RunSnapshot | null }) {
  const context = usePlugin()
  return (
    <box paddingLeft={1} paddingRight={1} paddingTop={1} gap={1}>
      <Show when={props.run} fallback={<text fg={context.theme.text.muted}>No workflow run yet. Use /workflow.</text>}>
        <text fg={context.theme.text.base}>
          {props.run?.workflow} · {props.run?.status} · {props.run?.id}
        </text>
        <For each={props.run?.nodes ?? []}>
          {(node) => (
            <text fg={context.theme.text.base}>
              {glyph(node.status)} {node.id} · {node.type}
            </text>
          )}
        </For>
      </Show>
    </box>
  )
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
