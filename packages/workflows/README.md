# @phall1/opencode-workflows

Workflow graphs for OpenCode V2. A workflow is a typed TypeScript graph. The
plugin runs it on the OpenCode server and draws it in the TUI.

## Install

```sh
opencode plugin add @phall1/opencode-workflows
```

Or in `opencode.jsonc`:

```jsonc
{
  "plugins": ["@phall1/opencode-workflows"]
}
```

## Author a workflow

Put a file in `.opencode/workflows/` (project) or `~/.config/opencode/workflows/`
(global):

```ts
// .opencode/workflows/echo.workflow.ts
import { agent, defineWorkflow } from "@phall1/opencode-workflows/dsl"

export default defineWorkflow({
  name: "echo",
  startAt: "reply",
  nodes: {
    reply: agent({
      prompt: ({ input }) => `Answer concisely: ${(input as { task?: string }).task}`,
    }),
  },
  edges: [],
})
```

Then, in any OpenCode session:

```
/workflow echo summarize this repository
```

`/workflow` lists discovered workflows. `/workflow status`, `/workflow cancel`,
and `/workflow answer` control the active run. `/workflow-graph` opens the
session panel.

## Node types

| Node | What it is on OpenCode |
| --- | --- |
| `agent` | Child session by default. `session: "origin"` reuses the current conversation. `output: "json"` (default) submits through the `workflow` tool; `output: "assistant"` takes the visible reply. |
| `decision` | `ctx.generate.text` — no session, no tools, just a classified choice. |
| `compute` | Pure TypeScript. |
| `checkpoint` | Parks the run until `/workflow answer`. |

Edges are explicit. Decision exits can be named: `{ from: "classify.greet", to: "greet" }`.

## What this is not

Not a port of [pi-workflows](https://github.com/osolmaz/pi-workflows). That
project had to build a host around Pi. OpenCode already is the host, so this
plugin is a graph runner plus a panel.

Out of v0 on purpose: resource managers, a sidecar SQLite server, a Rust
viewer, Telegram, composition/`includeWorkflow`, always-on queues.
