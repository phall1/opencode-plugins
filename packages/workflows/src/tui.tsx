import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import type { RunSnapshot } from "./engine.ts"
import { Workflows } from "./rpc.ts"

export default Plugin.define({
  id: "phall.workflows.cli",
  setup(context) {
    const rpc = context.client.rpc(Workflows as any)
    const [active, setActive] = context.storage.memory("active-run", {
      initial: { run: null as RunSnapshot | null },
    })

    const stop = rpc.events.on("updated", (event) => {
      setActive((draft) => {
        draft.run = event.data.run as RunSnapshot
      })
    })

    void rpc.status?.({})?.then((result: { run?: RunSnapshot }) => {
      if (result.run) {
        setActive((draft) => {
          draft.run = result.run as RunSnapshot
        })
      }
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
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
