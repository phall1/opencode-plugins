import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { For, Show } from "solid-js"
import type { RunSnapshot } from "./engine.ts"
import { Workflows } from "./rpc.ts"

type CallOpts = { location?: { directory?: string } }

type Rpc = {
  list: (input?: object, options?: CallOpts) => Promise<{ workflows: Array<{ name: string; nodes: string[] }> }>
  start: (input: { name: string; task?: string; sessionID?: string }, options?: CallOpts) => Promise<{ run: RunSnapshot }>
  status: (input?: { runId?: string }, options?: CallOpts) => Promise<{ run?: RunSnapshot }>
  cancel: (input?: { runId?: string }, options?: CallOpts) => Promise<{ run?: RunSnapshot }>
  events: { on: (name: string, handler: (event: { data: { run: RunSnapshot } }) => void) => () => void }
}

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
        if (result.run) {
          setActive((draft) => {
            draft.run = result.run ?? null
          })
        }
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
        <Show when={panel.name === "phall.workflows"}>
          <Graph run={active.run} panel={panel} />
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
        run: () => {
          const current = context.ui.panel.current()
          if (current?.name === "phall.workflows") {
            context.ui.panel.close()
            return
          }
          if (!context.ui.panel.open("phall.workflows")) {
            context.ui.toast.show({ message: "Open a session first", variant: "warning" })
          }
        },
      },
    ],
  }))
  return null
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
      const run = (await rpc.status({ runId: rest[0] }, opts)).run
      context.ui.panel.open("phall.workflows")
      await context.ui.dialog.alert({
        title: run ? `${run.workflow} · ${run.status}` : "Workflow",
        message: run ? formatRun(run) : "No workflow run.",
      })
      return
    }
    if (head === "cancel") {
      const run = (await rpc.cancel({ runId: rest[0] }, opts)).run
      context.ui.toast.show({
        message: run ? `${run.workflow} cancelled` : "No run to cancel",
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
              description: workflow.nodes.join(" → "),
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

    const started = await rpc.start({ name, task: rest.join(" ") || undefined, sessionID }, opts)
    const [, update] = context.storage.memory("active-run", {
      initial: { run: null as RunSnapshot | null },
    })
    update((draft) => {
      draft.run = started.run
    })
    context.ui.panel.open("phall.workflows")
    context.ui.toast.show({ title: name, message: started.run.status, variant: "success" })
  } catch (error) {
    context.ui.toast.show({
      title: "Workflow",
      message: errorMessage(error),
      variant: "error",
    })
  }
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

function formatRun(run: RunSnapshot): string {
  const nodes = run.nodes.map((node) => `${node.status} ${node.id}`).join("\n")
  return [run.id, nodes, run.error ?? ""].filter(Boolean).join("\n")
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

function Graph(props: { run: RunSnapshot | null; panel: PanelInput }) {
  const context = usePlugin()
  context.keymap.layer(() => ({
    enabled: () => props.panel.focused,
    commands: [
      {
        id: "phall.workflows.panel.close",
        title: "Close workflow graph",
        bind: "escape",
        run: () => props.panel.close(),
      },
    ],
  }))
  return (
    <box paddingLeft={1} paddingRight={1} paddingTop={1} gap={1}>
      <text fg={context.theme.text.muted}>esc closes · /workflow-graph toggles</text>
      <Show when={props.run} fallback={<text fg={context.theme.text.muted}>No run yet. /workflow to start one.</text>}>
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
