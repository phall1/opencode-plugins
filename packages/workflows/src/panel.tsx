/** @jsxImportSource @opentui/solid */
import { ScrollBoxRenderable, SyntaxStyle, TextAttributes, type MarkdownOptions } from "@opentui/core"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { usePlugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { parseAnswer } from "./commands.ts"
import { loadWorkflowDiagram } from "./diagram.ts"
import type { NodeSnapshot, RunSnapshot } from "./engine.ts"
import { glyph } from "./format.ts"
import { workflowMermaid } from "./graph.ts"
import { panelHints, rowTail, runElapsed, runTitle, showGraph, stepDetail, typeGlyph, visibleSteps } from "./view.ts"
import "opentui-spinner/solid"

export type WorkflowRpc = {
  answer: (input: { runId: string; value: unknown }, options?: { location?: { directory?: string } }) => Promise<{ run: RunSnapshot }>
  cancel: (input?: { runId?: string }, options?: { location?: { directory?: string } }) => Promise<{ run?: RunSnapshot }>
}

export function WorkflowPanel(props: { run: RunSnapshot | null; panel: PanelInput; rpc: WorkflowRpc }) {
  const context = usePlugin()
  const [selected, setSelected] = createSignal(0)
  const [pinned, setPinned] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const [renderNode, setRenderNode] = createSignal<MarkdownOptions["renderNode"]>()

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
    void loadWorkflowDiagram(context.renderer, () => ({
      theme: context.theme,
      mode: context.themeMode,
      width: Math.max(24, props.panel.width - 4),
    })).then((renderer) => {
      if (renderer) setRenderNode(() => renderer)
    })
  })

  createEffect(() => {
    const run = props.run
    if (!run || pinned()) return
    const steps = visibleSteps(run)
    const index = steps.findIndex((step) => step.node.id === run.cursor && step.depth === 0)
    const childIndex = steps.findLastIndex((step) => step.node.status === "running" || step.node.status === "waiting")
    setSelected(childIndex >= 0 ? childIndex : Math.max(0, index))
  })

  context.keymap.layer(() => ({
    enabled: () => props.panel.focused,
    commands: panelCommands({
      close: () => props.panel.close(),
      move: (delta) => move(props.run, selected(), setSelected, setPinned, delta),
      open: () => openSelected(context, props.run, selected()),
      answer: () => void answerSelected(context, props.rpc, props.run),
      cancel: () => void cancelRun(context, props.rpc, props.run),
      fullscreen: () => props.panel.toggleFullscreen(),
    }),
  }))

  let scroll: ScrollBoxRenderable | undefined
  const run = () => props.run
  const steps = () => run() ? visibleSteps(run()!) : []
  const nodes = () => run()?.nodes ?? []
  const selectedNode = () => steps()[selected()]?.node

  createEffect(() => {
    const index = selected()
    if (!scroll) return
    if (index >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(index - scroll.viewport.height + 1)
    if (index < scroll.scrollTop) scroll.scrollTo(index)
  })

  return (
    <box paddingLeft={1} paddingRight={1} paddingTop={1} gap={1} height="100%">
      <Show when={run()} fallback={<text fg={context.theme.text.subdued}>No workflow running</text>}>
        <RunHeader run={run()!} now={now()} />
        <Show when={showGraph(props.panel.presentation, nodes().length)}>
          <WorkflowGraph
            run={run()!}
            renderNode={renderNode()}
            fullscreen={props.panel.presentation === "fullscreen"}
          />
        </Show>
        <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }} ref={(value: ScrollBoxRenderable) => (scroll = value)}>
          <For each={steps()}>
            {(step, index) => (
              <NodeRow
                node={step.node}
                label={`${"  ".repeat(step.depth)}${step.label}`}
                active={index() === selected()}
                live={step.node.status === "running"}
                now={now()}
                onChoose={() => setSelected(index())}
                onOpen={() => {
                  setPinned(true)
                  setSelected(index())
                  openSelected(context, run(), index())
                }}
              />
            )}
          </For>
        </scrollbox>
        <Show when={selectedNode()}>
          <scrollbox maxHeight={props.panel.presentation === "fullscreen" ? 16 : 8} scrollbarOptions={{ visible: true }}>
            <text fg={context.theme.text.subdued} wrapMode="word">{stepDetail(selectedNode()!)}</text>
          </scrollbox>
        </Show>
        <text fg={context.theme.text.subdued} wrapMode="none">
          {panelHints({
            fullscreen: props.panel.presentation === "fullscreen",
            waiting: steps().some((step) => step.node.status === "waiting"),
            stoppable: run()!.status === "running" || run()!.status === "waiting",
            openable: Boolean(selectedNode()?.sessionID),
          })}
        </text>
      </Show>
    </box>
  )
}

function panelCommands(actions: {
  close: () => void
  move: (delta: number) => void
  open: () => void
  answer: () => void
  cancel: () => void
  fullscreen: () => void
}) {
  return [
    { id: "phall.workflows.panel.close", title: "Close workflow", bind: "escape", run: actions.close },
    { id: "phall.workflows.panel.up", title: "Previous step", bind: "up", run: () => actions.move(-1) },
    { id: "phall.workflows.panel.up.vim", title: "Previous step", bind: "k", run: () => actions.move(-1) },
    { id: "phall.workflows.panel.down", title: "Next step", bind: "down", run: () => actions.move(1) },
    { id: "phall.workflows.panel.down.vim", title: "Next step", bind: "j", run: () => actions.move(1) },
    { id: "phall.workflows.panel.open", title: "Open step", bind: "return", run: actions.open },
    { id: "phall.workflows.panel.answer", title: "Answer checkpoint", bind: "a", run: actions.answer },
    { id: "phall.workflows.panel.cancel", title: "Stop workflow", bind: "x", run: actions.cancel },
    { id: "phall.workflows.panel.fullscreen", title: "Toggle workflow graph", bind: "f", run: actions.fullscreen },
  ]
}

function move(
  run: RunSnapshot | null,
  selected: number,
  setSelected: (value: number) => void,
  setPinned: (value: boolean) => void,
  delta: number,
) {
  const count = run ? visibleSteps(run).length : 0
  if (count === 0) return
  setPinned(true)
  setSelected((selected + delta + count) % count)
}

function RunHeader(props: { run: RunSnapshot; now: number }) {
  const context = usePlugin()
  const title = () => runTitle(props.run)
  return (
    <box gap={0}>
      <box flexDirection="row" gap={1}>
        <text fg={statusColor(context.theme, props.run.status)} wrapMode="none">
          {glyph(props.run.status)}
        </text>
        <text fg={context.theme.text.default} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.run.workflow}
        </text>
        <text fg={statusColor(context.theme, props.run.status)} wrapMode="none">
          {props.run.status}
        </text>
        <text fg={context.theme.text.subdued} wrapMode="none">
          {runElapsed(props.run, props.now)}
        </text>
      </box>
      <Show when={title()}>
        <text fg={context.theme.text.subdued} wrapMode="none">
          {title()}
        </text>
      </Show>
      <Show when={props.run.error}>
        <text fg={context.theme.text.feedback.error.default} wrapMode="word">
          {props.run.error}
        </text>
      </Show>
    </box>
  )
}

function WorkflowGraph(props: {
  run: RunSnapshot
  renderNode: MarkdownOptions["renderNode"]
  fullscreen: boolean
}) {
  const context = usePlugin()
  return (
    <Show when={props.renderNode} fallback={<text fg={context.theme.text.subdued}>Diagram unavailable · step list remains available</text>}>
      <scrollbox maxHeight={props.fullscreen ? 18 : 12} scrollbarOptions={{ visible: false }}>
        <markdown
          fg={context.theme.text.default}
          syntaxStyle={SyntaxStyle.fromTheme([])}
          content={"```mermaid\n" + workflowMermaid(props.run) + "\n```"}
          renderNode={props.renderNode}
        />
      </scrollbox>
    </Show>
  )
}

function NodeRow(props: {
  node: NodeSnapshot
  label: string
  active: boolean
  live: boolean
  now: number
  onChoose: () => void
  onOpen: () => void
}) {
  const context = usePlugin()
  const fg = () => (props.active ? context.theme.text.action.primary.focused : rowColor(context.theme, props.node, props.live))
  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      gap={1}
      backgroundColor={props.active ? context.theme.background.action.primary.focused : undefined}
      onMouseMove={props.onChoose}
      onMouseUp={props.onOpen}
    >
      <box width={2} flexShrink={0}>
        <Show
          when={props.node.status === "running"}
          fallback={
            <text fg={props.active ? fg() : statusColor(context.theme, props.node.status)} wrapMode="none">
              {glyph(props.node.status)}
            </text>
          }
        >
          <spinner color={props.active ? fg() : context.theme.text.status.running} />
        </Show>
      </box>
      <text flexShrink={0} wrapMode="none" fg={props.active ? fg() : context.theme.text.subdued}>
        {typeGlyph(props.node.type)}
      </text>
      <text flexGrow={1} wrapMode="none" fg={fg()} attributes={props.active ? TextAttributes.BOLD : undefined}>
        {props.label}
      </text>
      <text wrapMode="none" fg={props.active ? fg() : context.theme.text.subdued}>
        {rowTail(props.node, props.now)}
      </text>
    </box>
  )
}

function rowColor(theme: ReturnType<typeof usePlugin>["theme"], node: NodeSnapshot, live: boolean) {
  if (node.status === "failed") return theme.text.feedback.error.default
  if (node.status === "waiting") return theme.text.status.question
  if (live || node.status === "running") return theme.text.status.running
  if (node.status === "done") return theme.text.default
  return theme.text.subdued
}

function statusColor(
  theme: ReturnType<typeof usePlugin>["theme"],
  status: string,
) {
  switch (status) {
    case "done":
      return theme.text.feedback.success.default
    case "failed":
    case "cancelled":
      return theme.text.feedback.error.default
    case "waiting":
      return theme.text.status.question
    case "running":
      return theme.text.status.running
    default:
      return theme.text.subdued
  }
}

function openSelected(
  context: ReturnType<typeof usePlugin>,
  run: RunSnapshot | null,
  index: number,
) {
  const node = run ? visibleSteps(run)[index]?.node : undefined
  if (!node?.sessionID) return
  context.ui.router.navigate({ type: "session", sessionID: node.sessionID })
}

async function answerSelected(
  context: ReturnType<typeof usePlugin>,
  rpc: WorkflowRpc,
  run: RunSnapshot | null,
) {
  if (!run) return
  const node = visibleSteps(run).find((step) => step.node.status === "waiting")?.node
  if (!node) return
  const value = await context.ui.dialog.prompt({
    title: `Answer ${node.id}`,
    placeholder: "answer",
  })
  if (!value) return
  await rpc.answer({ runId: run.id, value: parseAnswer(value) }, callOpts(context))
}

async function cancelRun(
  context: ReturnType<typeof usePlugin>,
  rpc: WorkflowRpc,
  run: RunSnapshot | null,
) {
  if (!run) return
  const cancelled = (await rpc.cancel({ runId: run.id }, callOpts(context))).run
  if (cancelled) remember(context, cancelled)
  context.ui.toast.show({
    message: cancelled ? `${cancelled.workflow} ${cancelled.status}` : "No run to stop",
    variant: cancelled?.status === "cancelled" ? "success" : "warning",
  })
}

function remember(context: ReturnType<typeof usePlugin>, run: RunSnapshot) {
  const [, update] = context.storage.memory("active-run", {
    initial: { run: null as RunSnapshot | null },
  })
  update((draft) => {
    draft.run = run
  })
}

function callOpts(context: ReturnType<typeof usePlugin>) {
  const directory = context.location?.directory ?? context.data.location.default()?.directory
  return directory ? { location: { directory } } : {}
}
