import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import type { RunSnapshot } from "./engine.ts"
import { Workflows } from "./rpc.ts"
import { WorkflowPanel, type WorkflowRpc } from "./panel.tsx"
import { footerText } from "./view.ts"

type CallOpts = { location?: { directory?: string } }

type Rpc = WorkflowRpc & {
  list: (input?: object, options?: CallOpts) => Promise<{ workflows: Array<{ name: string; nodes: string[] }> }>
  start: (input: { name: string; task?: string; sessionID?: string }, options?: CallOpts) => Promise<{ run: RunSnapshot }>
  status: (input?: { runId?: string }, options?: CallOpts) => Promise<{ run?: RunSnapshot }>
  events: { on: (name: string, handler: (event: { data: { run: RunSnapshot } }) => void) => () => void }
}

const PANEL = "phall.workflows"

export default Plugin.define({
  id: "phall.workflows.cli",
  setup(context) {
    const rpc = context.client.rpc(Workflows as any) as unknown as Rpc
    const [active, setActive] = context.storage.memory("active-run", {
      initial: { run: null as RunSnapshot | null },
    })

    let stop = () => {}
    try {
      stop = rpc.events.on("updated", (event) => {
        setActive((draft) => {
          draft.run = event.data.run
        })
      })
    } catch {
      // RPC may not be up yet at CLI plugin setup.
    }

    void rpc.status({}, callOpts(context)).then(
      (result) => {
        if (!result.run) return
        setActive((draft) => {
          draft.run = result.run ?? null
        })
      },
      () => undefined,
    )

    const unslotCommands = context.ui.slot({
      append: "app",
      render: () => <WorkflowCommands rpc={rpc} />,
    })

    const unslotStatus = context.ui.slot({
      append: "prompt.footer.status",
      render: () => <Status run={active.run} />,
    })

    const unslotPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL}>
          <WorkflowPanel run={active.run} panel={panel} rpc={rpc} />
        </Show>
      ),
    })

    return () => {
      stop()
      unslotCommands()
      unslotStatus()
      unslotPanel()
    }
  },
})

function WorkflowCommands(props: { rpc: Rpc }) {
  const context = usePlugin()
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "phall.workflows.run",
        title: "Workflow",
        description: "Start a workflow",
        group: "Workflows",
        palette: true,
        slash: { name: "workflow", arguments: true },
        run: (input) => {
          void runWorkflowCommand(context, props.rpc, input)
        },
      },
      {
        id: "phall.workflows.panel",
        title: "Workflow graph",
        description: "Toggle the workflow panel",
        group: "Workflows",
        palette: true,
        slash: { name: "workflow-graph" },
        run: () => togglePanel(context),
      },
    ],
  }))
  return null
}

function Status(props: { run: RunSnapshot | null }) {
  const context = usePlugin()
  const [hover, setHover] = createSignal(false)
  return (
    <Show when={props.run}>
      <box
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => togglePanel(context)}
      >
        <text fg={hover() ? context.theme.text.default : footerColor(context.theme, props.run!.status)} wrapMode="none">
          {footerText(props.run!)}
        </text>
      </box>
    </Show>
  )
}

function footerColor(theme: ReturnType<typeof usePlugin>["theme"], status: string) {
  if (status === "waiting") return theme.text.status.question
  if (status === "failed" || status === "cancelled") return theme.text.feedback.error.default
  if (status === "done") return theme.text.subdued
  return theme.text.status.running
}

function togglePanel(context: ReturnType<typeof usePlugin>) {
  if (context.ui.panel.current()?.name === PANEL) {
    context.ui.panel.close()
    return
  }
  showPanel(context)
}

function showPanel(context: ReturnType<typeof usePlugin>) {
  if (context.ui.panel.current()?.name === PANEL) return
  if (!context.ui.panel.open(PANEL)) {
    context.ui.toast.show({ message: "Open a session first", variant: "warning" })
  }
}

async function runWorkflowCommand(
  context: ReturnType<typeof usePlugin>,
  rpc: Rpc,
  input?: string,
): Promise<void> {
  const opts = callOpts(context)
  try {
    const [head, ...rest] = (input ?? "").trim().split(/\s+/).filter(Boolean)
    if (head === "status") {
      showPanel(context)
      return
    }
    if (head === "cancel") {
      const run = (await rpc.cancel({ runId: rest[0] }, opts)).run
      context.ui.toast.show({
        message: run ? `${run.workflow} stopped` : "No run to stop",
        variant: run ? "success" : "warning",
      })
      return
    }

    const workflows = (await rpc.list({}, opts)).workflows ?? []
    const name =
      head && head !== "list"
        ? head
        : await context.ui.dialog.select({
            title: "Start workflow",
            options: workflows.map((workflow) => ({
              title: workflow.name,
              value: workflow.name,
              description: workflow.nodes.join(", "),
            })),
          })
    if (!name) return

    const sessionID = sessionIDOf(context)
    if (!sessionID) {
      await context.ui.dialog.alert({
        title: "Workflow",
        message: "Open a session first, then run /workflow.",
      })
      return
    }

    const task = rest.join(" ")
    const started = await rpc.start({ name, ...(task ? { task } : {}), sessionID }, opts)
    remember(context, started.run)
    showPanel(context)
    context.ui.toast.show({
      title: started.run.workflow,
      message: started.run.status === "done" ? "done" : `${started.run.status} · ${started.run.cursor}`,
      variant: started.run.status === "failed" ? "error" : "success",
    })
  } catch (error) {
    context.ui.toast.show({
      title: "Workflow",
      message: errorMessage(error),
      variant: "error",
    })
  }
}

function remember(context: ReturnType<typeof usePlugin>, run: RunSnapshot) {
  const [, update] = context.storage.memory("active-run", {
    initial: { run: null as RunSnapshot | null },
  })
  update((draft) => {
    draft.run = run
  })
}

function callOpts(context: ReturnType<typeof usePlugin>): CallOpts {
  const directory = context.location?.directory ?? context.data.location.default()?.directory
  return directory ? { location: { directory } } : {}
}

function sessionIDOf(context: ReturnType<typeof usePlugin>): string | undefined {
  const route = context.ui.router.current()
  if (route?.type === "session") return route.sessionID
  return context.ui.tabs.list().find((tab) => tab.active)?.sessionID
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const body = error as { type?: unknown; message?: unknown }
    if (typeof body.message === "string") {
      return typeof body.type === "string" ? `${body.type}: ${body.message}` : body.message
    }
  }
  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown workflow error"
  }
}
