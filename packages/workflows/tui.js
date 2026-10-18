// @bun
// src/tui.tsx
import { effect as _$effect2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { Plugin, usePlugin as usePlugin2 } from "@opencode/plugin/tui";
import { createSignal as createSignal2, Show as Show2 } from "solid-js";

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
var Node = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  status: Schema.String,
  startedAt: Schema.optionalKey(Schema.Number),
  finishedAt: Schema.optionalKey(Schema.Number),
  sessionID: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  choices: Schema.optionalKey(Schema.Array(Schema.String)),
  prompt: Schema.optionalKey(Schema.String),
  output: Schema.optionalKey(Schema.Unknown),
  decision: Schema.optionalKey(Schema.Struct({
    source: Schema.Literals(["jev", "generate"]),
    confidence: Schema.Number,
    probabilities: Schema.Record(Schema.String, Schema.Number)
  })),
  child: Schema.optionalKey(Schema.Unknown)
});
var Edge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  label: Schema.optionalKey(Schema.String)
});
var Run = Schema.Struct({
  id: Schema.String,
  workflow: Schema.String,
  status: Schema.Literals(["running", "waiting", "done", "failed", "cancelled"]),
  cursor: Schema.String,
  startedAt: Schema.Number,
  input: Schema.Unknown,
  outputs: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge)
});
var WorkflowSummary = Schema.Struct({
  name: Schema.String,
  startAt: Schema.String,
  nodes: Schema.Array(Schema.String)
});
var RunId = Schema.Struct({
  runId: Schema.optionalKey(Schema.String)
});
var MaybeRun = Schema.Struct({
  run: Schema.optionalKey(Run)
});
var Workflows = Rpc.define({
  id: "phall.workflows",
  methods: {
    list: {
      input: Schema.Struct({}),
      output: Schema.Struct({ workflows: Schema.Array(WorkflowSummary) })
    },
    start: {
      input: Schema.Struct({
        name: Schema.String,
        task: Schema.optionalKey(Schema.String),
        sessionID: Schema.optionalKey(Schema.String),
        input: Schema.optionalKey(Schema.Unknown)
      }),
      output: Schema.Struct({ run: Run }),
      errors: {
        not_found: Schema.Struct({ name: Schema.String }),
        busy: Schema.Struct({ runId: Schema.String })
      }
    },
    status: {
      input: RunId,
      output: MaybeRun
    },
    cancel: {
      input: RunId,
      output: MaybeRun
    },
    answer: {
      input: Schema.Struct({
        value: Schema.Unknown,
        runId: Schema.optionalKey(Schema.String)
      }),
      output: Schema.Struct({ run: Run }),
      errors: {
        not_waiting: Schema.Struct({ runId: Schema.String })
      }
    }
  },
  events: {
    updated: {
      schema: Schema.Struct({ run: Run })
    }
  }
});

// src/panel.tsx
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { usePlugin } from "@opencode/plugin/tui";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";

// src/commands.ts
import { Deferred as Deferred3, Effect as Effect5 } from "effect";

// src/dsl.ts
var RESERVED_WORKFLOW_NAMES = new Set([
  "answer",
  "cancel",
  "help",
  "list",
  "pause",
  "resume",
  "status"
]);

// src/format.ts
function glyph(status) {
  switch (status) {
    case "done":
      return "\u2713";
    case "running":
      return "\u25B6";
    case "waiting":
      return "\u23F8";
    case "failed":
    case "cancelled":
      return "\u2715";
    default:
      return "\xB7";
  }
}

// src/runner.ts
import { Deferred as Deferred2, Duration as Duration2, Effect as Effect4, Fiber } from "effect";

// src/engine.ts
import { Effect } from "effect";

// src/host.ts
import { Deferred, Duration, Effect as Effect3 } from "effect";

// src/judge.ts
import { Effect as Effect2 } from "effect";
// src/commands.ts
function parseAnswer(text) {
  if (!text)
    return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// src/diagram.ts
var MERMAN = "../../../../opencode/packages/merman/src/markdown.ts";
var PALETTE = "../../../../opencode/packages/merman/src/palette.ts";
async function loadWorkflowDiagram(ctx, options) {
  try {
    const [markdown, palette] = await Promise.all([import(MERMAN), import(PALETTE)]);
    return markdown.createMermaidMarkdownRenderer(ctx, () => diagramOptions(palette, options()));
  } catch {
    return;
  }
}
function diagramOptions(palette, options) {
  return {
    compact: true,
    layoutMaxWidth: Math.max(24, options.width),
    colors: palette.resolveOpenCodeDiagramPalette(options.theme, options.mode)
  };
}

// src/graph.ts
var ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
function workflowMermaid(run) {
  const lines = ["flowchart TD"];
  const reserved = new Set(run.nodes.filter((node) => ID_RE.test(node.id)).map((node) => node.id));
  const ids = new Map;
  run.nodes.forEach((node, index) => {
    if (ID_RE.test(node.id)) {
      ids.set(node.id, node.id);
      return;
    }
    let id = `wf_node_${index}`;
    while (reserved.has(id))
      id = `_${id}`;
    reserved.add(id);
    ids.set(node.id, id);
  });
  for (const node of run.nodes)
    lines.push(`  ${nodeToken(node, ids.get(node.id))}`);
  for (const edge of run.edges)
    lines.push(`  ${edgeToken(edge, ids)}`);
  lines.push("  classDef active stroke-width:3px", "  classDef complete stroke-width:2px");
  for (const node of run.nodes) {
    if (node.id === run.cursor && (run.status === "running" || run.status === "waiting"))
      lines.push(`  class ${ids.get(node.id)} active`);
    else if (node.status === "done")
      lines.push(`  class ${ids.get(node.id)} complete`);
  }
  return lines.join(`
`);
}
function nodeToken(node, id) {
  const label = escapeLabel(node.id);
  switch (node.type) {
    case "decision":
      return `${id}{"${label}"}`;
    case "checkpoint":
    case "include":
      return `${id}[["${label}"]]`;
    case "wait":
      return `${id}(["${label}"])`;
    case "agent":
      return `${id}("${label}")`;
    default:
      return `${id}["${label}"]`;
  }
}
function edgeToken(edge, ids) {
  const from = ids.get(edge.from) ?? safeId(edge.from);
  const to = ids.get(edge.to) ?? safeId(edge.to);
  if (!edge.label)
    return `${from} --> ${to}`;
  return `${from} -->|"${escapeLabel(edge.label)}"| ${to}`;
}
function safeId(id) {
  return ID_RE.test(id) ? id : `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}
function escapeLabel(value) {
  return value.replaceAll('"', "'").replaceAll(`
`, " ");
}

// src/view.ts
function footerText(run) {
  if (run.status === "waiting")
    return `${glyph(run.status)} ${run.workflow} \xB7 waiting`;
  return `${glyph(run.status)} ${run.workflow} \xB7 ${run.cursor}`;
}
function formatElapsed(startedAt, finishedAt = Date.now()) {
  const seconds = Math.floor(Math.max(0, finishedAt - startedAt) / 1000);
  if (seconds < 60)
    return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60)
    return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function typeGlyph(type) {
  switch (type) {
    case "agent":
      return "\u25CF";
    case "compute":
      return "\u0192";
    case "decision":
      return "\u25C7";
    case "checkpoint":
      return "\u25C6";
    case "wait":
      return "\u25CB";
    case "include":
      return "\u25A3";
    default:
      return "\xB7";
  }
}
function rowTail(node, now = Date.now()) {
  if (node.decision)
    return `${node.output && typeof node.output === "object" && "choice" in node.output ? String(node.output.choice) : "?"} \xB7 ${node.decision.source}${node.decision.source === "jev" ? ` ${Math.round(node.decision.confidence * 100)}%` : " (uncalibrated)"}`;
  if ((node.status === "failed" || node.status === "waiting") && node.detail)
    return clip(node.detail, 36) ?? "";
  if (!node.startedAt)
    return "";
  return formatElapsed(node.startedAt, node.finishedAt ?? (node.status === "running" ? now : node.startedAt));
}
function visibleSteps(run, depth = 0) {
  return run.nodes.flatMap((node) => [
    { node, label: node.id, depth },
    ...node.child ? visibleSteps(node.child, depth + 1) : []
  ]);
}
function stepDetail(node) {
  const parts = [`${node.type} \xB7 ${node.status}`];
  if (node.sessionID)
    parts.push(`Session: ${node.sessionID} (enter to open)`);
  if (node.prompt)
    parts.push(`Prompt:
${node.prompt}`);
  if (node.decision)
    parts.push(`Route: ${node.decision.source} \xB7 ${node.decision.source === "jev" ? `${Math.round(node.decision.confidence * 100)}% confidence` : "uncalibrated fallback"}
Probabilities: ${JSON.stringify(node.decision.probabilities)}`);
  if (node.output !== undefined)
    parts.push(`Output:
${formatDetail(node.output)}`);
  if (node.detail && !node.prompt)
    parts.push(`Detail: ${node.detail}`);
  return parts.join(`

`);
}
function formatDetail(output) {
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2) ?? String(output);
  return text.length > 8000 ? `${text.slice(0, 8000)}
\u2026 truncated` : text;
}
function runTitle(run) {
  const task = taskOf(run.input);
  return task ? clip(task, 72) : undefined;
}
function showGraph(presentation, nodes) {
  if (nodes === 0)
    return false;
  if (presentation === "fullscreen")
    return true;
  return nodes <= 4;
}
function panelHints(input) {
  return [
    "\u2191\u2193",
    input.openable ? "enter" : undefined,
    input.waiting ? "a answer" : undefined,
    input.stoppable ? "x stop" : undefined,
    input.fullscreen ? "f list" : "f graph",
    "esc"
  ].filter(Boolean).join("  ");
}
function runElapsed(run, now = Date.now()) {
  const live = run.status === "running" || run.status === "waiting";
  const end = live ? now : latestFinish(run) ?? now;
  return formatElapsed(run.startedAt, end);
}
function latestFinish(run) {
  return run.nodes.reduce((latest, node) => {
    if (!node.finishedAt)
      return latest;
    if (latest === undefined || node.finishedAt > latest)
      return node.finishedAt;
    return latest;
  }, undefined);
}
function taskOf(input) {
  if (typeof input === "string")
    return input.trim() || undefined;
  if (typeof input !== "object" || input === null || !("task" in input))
    return;
  const task = input.task;
  return typeof task === "string" ? task.trim() || undefined : undefined;
}
function clip(value, max = 42) {
  if (!value)
    return;
  return value.length <= max ? value : `${value.slice(0, max - 1)}\u2026`;
}

// src/panel.tsx
import"opentui-spinner/solid";
function WorkflowPanel(props) {
  const context = usePlugin();
  const [selected, setSelected] = createSignal(0);
  const [pinned, setPinned] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const [renderNode, setRenderNode] = createSignal();
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
    loadWorkflowDiagram(context.renderer, () => ({
      theme: context.theme,
      mode: context.themeMode,
      width: Math.max(24, props.panel.width - 4)
    })).then((renderer) => {
      if (renderer)
        setRenderNode(() => renderer);
    });
  });
  createEffect(() => {
    const run = props.run;
    if (!run || pinned())
      return;
    const steps = visibleSteps(run);
    const index = steps.findIndex((step) => step.node.id === run.cursor && step.depth === 0);
    const childIndex = steps.findLastIndex((step) => step.node.status === "running" || step.node.status === "waiting");
    setSelected(childIndex >= 0 ? childIndex : Math.max(0, index));
  });
  context.keymap.layer(() => ({
    enabled: () => props.panel.focused,
    commands: panelCommands({
      close: () => props.panel.close(),
      move: (delta) => move(props.run, selected(), setSelected, setPinned, delta),
      open: () => openSelected(context, props.run, selected()),
      answer: () => void answerSelected(context, props.rpc, props.run),
      cancel: () => void cancelRun2(context, props.rpc, props.run),
      fullscreen: () => props.panel.toggleFullscreen()
    })
  }));
  let scroll;
  const run = () => props.run;
  const steps = () => run() ? visibleSteps(run()) : [];
  const nodes = () => run()?.nodes ?? [];
  const selectedNode = () => steps()[selected()]?.node;
  createEffect(() => {
    const index = selected();
    if (!scroll)
      return;
    if (index >= scroll.scrollTop + scroll.viewport.height)
      scroll.scrollTo(index - scroll.viewport.height + 1);
    if (index < scroll.scrollTop)
      scroll.scrollTo(index);
  });
  return (() => {
    var _el$ = _$createElement("box");
    _$setProp(_el$, "paddingLeft", 1);
    _$setProp(_el$, "paddingRight", 1);
    _$setProp(_el$, "paddingTop", 1);
    _$setProp(_el$, "gap", 1);
    _$setProp(_el$, "height", "100%");
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return run();
      },
      get fallback() {
        return (() => {
          var _el$6 = _$createElement("text");
          _$insertNode(_el$6, _$createTextNode(`No workflow running`));
          _$effect((_$p) => _$setProp(_el$6, "fg", context.theme.text.muted, _$p));
          return _el$6;
        })();
      },
      get children() {
        return [_$createComponent(RunHeader, {
          get run() {
            return run();
          },
          get now() {
            return now();
          }
        }), _$createComponent(Show, {
          get when() {
            return showGraph(props.panel.presentation, nodes().length);
          },
          get children() {
            return _$createComponent(WorkflowGraph, {
              get run() {
                return run();
              },
              get renderNode() {
                return renderNode();
              },
              get fullscreen() {
                return props.panel.presentation === "fullscreen";
              }
            });
          }
        }), (() => {
          var _el$2 = _$createElement("scrollbox");
          _$use((value) => scroll = value, _el$2);
          _$setProp(_el$2, "flexGrow", 1);
          _$setProp(_el$2, "scrollbarOptions", {
            visible: false
          });
          _$insert(_el$2, _$createComponent(For, {
            get each() {
              return steps();
            },
            children: (step, index) => _$createComponent(NodeRow, {
              get node() {
                return step.node;
              },
              get label() {
                return `${"  ".repeat(step.depth)}${step.label}`;
              },
              get active() {
                return index() === selected();
              },
              get live() {
                return step.node.status === "running";
              },
              get now() {
                return now();
              },
              onChoose: () => setSelected(index()),
              onOpen: () => {
                setPinned(true);
                setSelected(index());
                openSelected(context, run(), index());
              }
            })
          }));
          return _el$2;
        })(), _$createComponent(Show, {
          get when() {
            return selectedNode();
          },
          get children() {
            var _el$3 = _$createElement("scrollbox"), _el$4 = _$createElement("text");
            _$insertNode(_el$3, _el$4);
            _$setProp(_el$3, "scrollbarOptions", {
              visible: true
            });
            _$setProp(_el$4, "wrapMode", "word");
            _$insert(_el$4, () => stepDetail(selectedNode()));
            _$effect((_p$) => {
              var _v$ = props.panel.presentation === "fullscreen" ? 16 : 8, _v$2 = context.theme.text.muted;
              _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "maxHeight", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp(_el$4, "fg", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$3;
          }
        }), (() => {
          var _el$5 = _$createElement("text");
          _$setProp(_el$5, "wrapMode", "none");
          _$insert(_el$5, () => panelHints({
            fullscreen: props.panel.presentation === "fullscreen",
            waiting: steps().some((step) => step.node.status === "waiting"),
            stoppable: run().status === "running" || run().status === "waiting",
            openable: Boolean(selectedNode()?.sessionID)
          }));
          _$effect((_$p) => _$setProp(_el$5, "fg", context.theme.text.muted, _$p));
          return _el$5;
        })()];
      }
    }));
    return _el$;
  })();
}
function panelCommands(actions) {
  return [{
    id: "phall.workflows.panel.close",
    title: "Close workflow",
    bind: "escape",
    run: actions.close
  }, {
    id: "phall.workflows.panel.up",
    title: "Previous step",
    bind: "up",
    run: () => actions.move(-1)
  }, {
    id: "phall.workflows.panel.up.vim",
    title: "Previous step",
    bind: "k",
    run: () => actions.move(-1)
  }, {
    id: "phall.workflows.panel.down",
    title: "Next step",
    bind: "down",
    run: () => actions.move(1)
  }, {
    id: "phall.workflows.panel.down.vim",
    title: "Next step",
    bind: "j",
    run: () => actions.move(1)
  }, {
    id: "phall.workflows.panel.open",
    title: "Open step",
    bind: "return",
    run: actions.open
  }, {
    id: "phall.workflows.panel.answer",
    title: "Answer checkpoint",
    bind: "a",
    run: actions.answer
  }, {
    id: "phall.workflows.panel.cancel",
    title: "Stop workflow",
    bind: "x",
    run: actions.cancel
  }, {
    id: "phall.workflows.panel.fullscreen",
    title: "Toggle workflow graph",
    bind: "f",
    run: actions.fullscreen
  }];
}
function move(run, selected, setSelected, setPinned, delta) {
  const count = run ? visibleSteps(run).length : 0;
  if (count === 0)
    return;
  setPinned(true);
  setSelected((selected + delta + count) % count);
}
function RunHeader(props) {
  const context = usePlugin();
  const title = () => runTitle(props.run);
  return (() => {
    var _el$8 = _$createElement("box"), _el$9 = _$createElement("box"), _el$0 = _$createElement("text"), _el$1 = _$createElement("text"), _el$10 = _$createElement("text"), _el$11 = _$createElement("text");
    _$insertNode(_el$8, _el$9);
    _$setProp(_el$8, "gap", 0);
    _$insertNode(_el$9, _el$0);
    _$insertNode(_el$9, _el$1);
    _$insertNode(_el$9, _el$10);
    _$insertNode(_el$9, _el$11);
    _$setProp(_el$9, "flexDirection", "row");
    _$setProp(_el$9, "gap", 1);
    _$setProp(_el$0, "wrapMode", "none");
    _$insert(_el$0, () => glyph(props.run.status));
    _$setProp(_el$1, "wrapMode", "none");
    _$insert(_el$1, () => props.run.workflow);
    _$setProp(_el$10, "wrapMode", "none");
    _$insert(_el$10, () => props.run.status);
    _$setProp(_el$11, "wrapMode", "none");
    _$insert(_el$11, () => runElapsed(props.run, props.now));
    _$insert(_el$8, _$createComponent(Show, {
      get when() {
        return title();
      },
      get children() {
        var _el$12 = _$createElement("text");
        _$setProp(_el$12, "wrapMode", "none");
        _$insert(_el$12, title);
        _$effect((_$p) => _$setProp(_el$12, "fg", context.theme.text.muted, _$p));
        return _el$12;
      }
    }), null);
    _$insert(_el$8, _$createComponent(Show, {
      get when() {
        return props.run.error;
      },
      get children() {
        var _el$13 = _$createElement("text");
        _$setProp(_el$13, "wrapMode", "word");
        _$insert(_el$13, () => props.run.error);
        _$effect((_$p) => _$setProp(_el$13, "fg", context.theme.text.feedback.error.base, _$p));
        return _el$13;
      }
    }), null);
    _$effect((_p$) => {
      var _v$3 = statusColor(context.theme, props.run.status), _v$4 = context.theme.text.base, _v$5 = TextAttributes.BOLD, _v$6 = statusColor(context.theme, props.run.status), _v$7 = context.theme.text.muted;
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$0, "fg", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$1, "fg", _v$4, _p$.t));
      _v$5 !== _p$.a && (_p$.a = _$setProp(_el$1, "attributes", _v$5, _p$.a));
      _v$6 !== _p$.o && (_p$.o = _$setProp(_el$10, "fg", _v$6, _p$.o));
      _v$7 !== _p$.i && (_p$.i = _$setProp(_el$11, "fg", _v$7, _p$.i));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$8;
  })();
}
function WorkflowGraph(props) {
  const context = usePlugin();
  return _$createComponent(Show, {
    get when() {
      return props.renderNode;
    },
    get fallback() {
      return (() => {
        var _el$16 = _$createElement("text");
        _$insertNode(_el$16, _$createTextNode(`Diagram unavailable \xB7 step list remains available`));
        _$effect((_$p) => _$setProp(_el$16, "fg", context.theme.text.muted, _$p));
        return _el$16;
      })();
    },
    get children() {
      var _el$14 = _$createElement("scrollbox"), _el$15 = _$createElement("markdown");
      _$insertNode(_el$14, _el$15);
      _$setProp(_el$14, "scrollbarOptions", {
        visible: false
      });
      _$effect((_p$) => {
        var _v$8 = props.fullscreen ? 18 : 12, _v$9 = context.theme.text.base, _v$0 = SyntaxStyle.fromTheme([]), _v$1 = "```mermaid\n" + workflowMermaid(props.run) + "\n```", _v$10 = props.renderNode;
        _v$8 !== _p$.e && (_p$.e = _$setProp(_el$14, "maxHeight", _v$8, _p$.e));
        _v$9 !== _p$.t && (_p$.t = _$setProp(_el$15, "fg", _v$9, _p$.t));
        _v$0 !== _p$.a && (_p$.a = _$setProp(_el$15, "syntaxStyle", _v$0, _p$.a));
        _v$1 !== _p$.o && (_p$.o = _$setProp(_el$15, "content", _v$1, _p$.o));
        _v$10 !== _p$.i && (_p$.i = _$setProp(_el$15, "renderNode", _v$10, _p$.i));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined
      });
      return _el$14;
    }
  });
}
function NodeRow(props) {
  const context = usePlugin();
  const fg = () => props.active ? context.theme.text.action.primary.focused : rowColor(context.theme, props.node, props.live);
  return (() => {
    var _el$18 = _$createElement("box"), _el$19 = _$createElement("box"), _el$21 = _$createElement("text"), _el$22 = _$createElement("text"), _el$23 = _$createElement("text");
    _$insertNode(_el$18, _el$19);
    _$insertNode(_el$18, _el$21);
    _$insertNode(_el$18, _el$22);
    _$insertNode(_el$18, _el$23);
    _$setProp(_el$18, "flexDirection", "row");
    _$setProp(_el$18, "paddingLeft", 1);
    _$setProp(_el$18, "paddingRight", 1);
    _$setProp(_el$18, "gap", 1);
    _$setProp(_el$19, "width", 2);
    _$setProp(_el$19, "flexShrink", 0);
    _$insert(_el$19, _$createComponent(Show, {
      get when() {
        return props.node.status === "running";
      },
      get fallback() {
        return (() => {
          var _el$24 = _$createElement("text");
          _$setProp(_el$24, "wrapMode", "none");
          _$insert(_el$24, () => glyph(props.node.status));
          _$effect((_$p) => _$setProp(_el$24, "fg", props.active ? fg() : statusColor(context.theme, props.node.status), _$p));
          return _el$24;
        })();
      },
      get children() {
        var _el$20 = _$createElement("spinner");
        _$effect((_$p) => _$setProp(_el$20, "color", props.active ? fg() : context.theme.text.action.primary.base, _$p));
        return _el$20;
      }
    }));
    _$setProp(_el$21, "flexShrink", 0);
    _$setProp(_el$21, "wrapMode", "none");
    _$insert(_el$21, () => typeGlyph(props.node.type));
    _$setProp(_el$22, "flexGrow", 1);
    _$setProp(_el$22, "wrapMode", "none");
    _$insert(_el$22, () => props.label);
    _$setProp(_el$23, "wrapMode", "none");
    _$insert(_el$23, () => rowTail(props.node, props.now));
    _$effect((_p$) => {
      var _v$11 = props.active ? context.theme.background.action.primary.focused : undefined, { onChoose: _v$12, onOpen: _v$13 } = props, _v$14 = props.active ? fg() : context.theme.text.muted, _v$15 = fg(), _v$16 = props.active ? TextAttributes.BOLD : undefined, _v$17 = props.active ? fg() : context.theme.text.muted;
      _v$11 !== _p$.e && (_p$.e = _$setProp(_el$18, "backgroundColor", _v$11, _p$.e));
      _v$12 !== _p$.t && (_p$.t = _$setProp(_el$18, "onMouseMove", _v$12, _p$.t));
      _v$13 !== _p$.a && (_p$.a = _$setProp(_el$18, "onMouseUp", _v$13, _p$.a));
      _v$14 !== _p$.o && (_p$.o = _$setProp(_el$21, "fg", _v$14, _p$.o));
      _v$15 !== _p$.i && (_p$.i = _$setProp(_el$22, "fg", _v$15, _p$.i));
      _v$16 !== _p$.n && (_p$.n = _$setProp(_el$22, "attributes", _v$16, _p$.n));
      _v$17 !== _p$.s && (_p$.s = _$setProp(_el$23, "fg", _v$17, _p$.s));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined
    });
    return _el$18;
  })();
}
function rowColor(theme, node, live) {
  if (node.status === "failed")
    return theme.text.feedback.error.base;
  if (node.status === "waiting")
    return theme.text.feedback.warning.base;
  if (live || node.status === "running")
    return theme.text.action.primary.base;
  if (node.status === "done")
    return theme.text.base;
  return theme.text.muted;
}
function statusColor(theme, status) {
  switch (status) {
    case "done":
      return theme.text.feedback.success.base;
    case "failed":
    case "cancelled":
      return theme.text.feedback.error.base;
    case "waiting":
      return theme.text.feedback.warning.base;
    case "running":
      return theme.text.action.primary.base;
    default:
      return theme.text.muted;
  }
}
function openSelected(context, run, index) {
  const node = run ? visibleSteps(run)[index]?.node : undefined;
  if (!node?.sessionID)
    return;
  context.ui.router.navigate({
    type: "session",
    sessionID: node.sessionID
  });
}
async function answerSelected(context, rpc, run) {
  if (!run)
    return;
  const node = visibleSteps(run).find((step) => step.node.status === "waiting")?.node;
  if (!node)
    return;
  const value = await context.ui.dialog.prompt({
    title: `Answer ${node.id}`,
    placeholder: "answer"
  });
  if (!value)
    return;
  await rpc.answer({
    runId: run.id,
    value: parseAnswer(value)
  }, callOpts(context));
}
async function cancelRun2(context, rpc, run) {
  if (!run)
    return;
  const cancelled = (await rpc.cancel({
    runId: run.id
  }, callOpts(context))).run;
  if (cancelled)
    remember(context, cancelled);
  context.ui.toast.show({
    message: cancelled ? `${cancelled.workflow} ${cancelled.status}` : "No run to stop",
    variant: cancelled?.status === "cancelled" ? "success" : "warning"
  });
}
function remember(context, run) {
  const [, update] = context.storage.memory("active-run", {
    initial: {
      run: null
    }
  });
  update((draft) => {
    draft.run = run;
  });
}
function callOpts(context) {
  const directory = context.location?.directory ?? context.data.location.default()?.directory;
  return directory ? {
    location: {
      directory
    }
  } : {};
}

// src/tui.tsx
var PANEL = "phall.workflows";
var tui_default = Plugin.define({
  id: "phall.workflows.cli",
  setup(context) {
    const rpc = context.client.rpc(Workflows);
    const [active, setActive] = context.storage.memory("active-run", {
      initial: {
        run: null
      }
    });
    let stop = () => {};
    let gotEvent = false;
    try {
      stop = rpc.events.on("updated", (event) => {
        gotEvent = true;
        setActive((draft) => {
          draft.run = event.data.run;
        });
      });
    } catch {}
    rpc.status({}, callOpts2(context)).then((result) => {
      if (!result.run || gotEvent)
        return;
      setActive((draft) => {
        draft.run = result.run ?? null;
      });
    }, () => {
      return;
    });
    const unslotCommands = context.ui.slot({
      append: "app",
      render: () => _$createComponent2(WorkflowCommands, {
        rpc
      })
    });
    const unslotStatus = context.ui.slot({
      append: "prompt.footer.status",
      render: () => _$createComponent2(Status, {
        get run() {
          return active.run;
        }
      })
    });
    const unslotPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => _$createComponent2(Show2, {
        get when() {
          return panel.name === PANEL;
        },
        get children() {
          return _$createComponent2(WorkflowPanel, {
            get run() {
              return active.run;
            },
            panel,
            rpc
          });
        }
      })
    });
    return () => {
      stop();
      unslotCommands();
      unslotStatus();
      unslotPanel();
    };
  }
});
function WorkflowCommands(props) {
  const context = usePlugin2();
  context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "phall.workflows.run",
      title: "Workflow",
      description: "Start a workflow",
      group: "Workflows",
      palette: true,
      slash: {
        name: "workflow",
        arguments: true
      },
      run: (input) => {
        runWorkflowCommand(context, props.rpc, input);
      }
    }, {
      id: "phall.workflows.panel",
      title: "Workflow graph",
      description: "Toggle the workflow panel",
      group: "Workflows",
      palette: true,
      slash: {
        name: "workflow-graph"
      },
      run: () => togglePanel(context)
    }]
  }));
  return null;
}
function Status(props) {
  const context = usePlugin2();
  const [hover, setHover] = createSignal2(false);
  return _$createComponent2(Show2, {
    get when() {
      return props.run;
    },
    get children() {
      var _el$ = _$createElement2("box"), _el$2 = _$createElement2("text");
      _$insertNode2(_el$, _el$2);
      _$setProp2(_el$, "onMouseOver", () => setHover(true));
      _$setProp2(_el$, "onMouseOut", () => setHover(false));
      _$setProp2(_el$, "onMouseUp", () => togglePanel(context));
      _$setProp2(_el$2, "wrapMode", "none");
      _$insert2(_el$2, () => footerText(props.run));
      _$effect2((_$p) => _$setProp2(_el$2, "fg", hover() ? context.theme.text.base : footerColor(context.theme, props.run.status), _$p));
      return _el$;
    }
  });
}
function footerColor(theme, status) {
  if (status === "waiting")
    return theme.text.feedback.warning.base;
  if (status === "failed" || status === "cancelled")
    return theme.text.feedback.error.base;
  if (status === "done")
    return theme.text.muted;
  return theme.text.action.primary.base;
}
function togglePanel(context) {
  if (context.ui.panel.current()?.name === PANEL) {
    context.ui.panel.close();
    return;
  }
  showPanel(context);
}
function showPanel(context) {
  if (context.ui.panel.current()?.name === PANEL)
    return;
  if (!context.ui.panel.open(PANEL)) {
    context.ui.toast.show({
      message: "Open a session first",
      variant: "warning"
    });
  }
}
async function runWorkflowCommand(context, rpc, input) {
  const opts = callOpts2(context);
  try {
    const [head, ...rest] = (input ?? "").trim().split(/\s+/).filter(Boolean);
    if (head === "status") {
      showPanel(context);
      return;
    }
    if (head === "cancel") {
      const run = (await rpc.cancel({
        runId: rest[0]
      }, opts)).run;
      context.ui.toast.show({
        message: run ? `${run.workflow} ${run.status}` : "No run to stop",
        variant: run?.status === "cancelled" ? "success" : "warning"
      });
      return;
    }
    const workflows = (await rpc.list({}, opts)).workflows ?? [];
    const name = head && head !== "list" ? head : await context.ui.dialog.select({
      title: "Start workflow",
      options: workflows.map((workflow) => ({
        title: workflow.name,
        value: workflow.name,
        description: workflow.nodes.join(", ")
      }))
    });
    if (!name)
      return;
    const sessionID = sessionIDOf(context);
    if (!sessionID) {
      await context.ui.dialog.alert({
        title: "Workflow",
        message: "Open a session first, then run /workflow."
      });
      return;
    }
    const task = rest.join(" ");
    const started = await rpc.start({
      name,
      ...task ? {
        task
      } : {},
      sessionID
    }, opts);
    remember2(context, started.run);
    showPanel(context);
    context.ui.toast.show({
      title: started.run.workflow,
      message: started.run.status === "done" ? "done" : `${started.run.status} \xB7 ${started.run.cursor}`,
      variant: started.run.status === "failed" ? "error" : "success"
    });
  } catch (error) {
    context.ui.toast.show({
      title: "Workflow",
      message: errorMessage(error),
      variant: "error"
    });
  }
}
function remember2(context, run) {
  const [, update] = context.storage.memory("active-run", {
    initial: {
      run: null
    }
  });
  update((draft) => {
    draft.run = run;
  });
}
function callOpts2(context) {
  const directory = context.location?.directory ?? context.data.location.default()?.directory;
  return directory ? {
    location: {
      directory
    }
  } : {};
}
function sessionIDOf(context) {
  const route = context.ui.router.current();
  if (route?.type === "session")
    return route.sessionID;
  return context.ui.tabs.list().find((tab) => tab.active)?.sessionID;
}
function errorMessage(error) {
  if (error instanceof Error)
    return error.message;
  if (typeof error === "object" && error !== null) {
    const body = error;
    if (typeof body.message === "string") {
      return typeof body.type === "string" ? `${body.type}: ${body.message}` : body.message;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown workflow error";
  }
}
export {
  tui_default as default
};
