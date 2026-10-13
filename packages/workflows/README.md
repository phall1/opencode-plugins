# @phall1/opencode-workflows

Workflow graphs for OpenCode V2. A run is an Effect. The plugin is an Effect
plugin. Checkpoints are deferred values. Cancel interrupts the fiber.

## Install

```sh
opencode plugin add @phall1/opencode-workflows
```

Or load the package from this repo:

```jsonc
{
  "plugins": ["./packages/workflows"]
}
```

The CLI loads `./tui` from the same package. Do not add it to `cli.json`.

## Commands

```
/workflow                         list
/workflow ping hi                 start (finishes immediately)
/workflow echo hi                 talks in this session
/workflow autoplan <task>         start
/workflow status
/workflow cancel
/workflow answer { ... }
/workflow-graph                   session panel
```

The model uses the `workflow` tool (`list`, `start`, `status`, `cancel`,
`submit`, `answer`) **only when you explicitly request a workflow**. Ordinary
planning, implementation, and review requests stay in the current conversation.

## Bundled workflows

| Name | What it does |
| --- | --- |
| `ping` | Compute-only. Finishes in this chat so you can see a `done` run. |
| `echo` | One agent step in this session |
| `wire` | Add this plugin to ~/dotfiles OpenCode config, apply, prove it loads |
| `autoplan` | Intent → candidates → choose → plan → summary |
| `autodoc` | Record an existing plan in docs |
| `autoimplement` | Implement, verify, fix loop |
| `sanity-check` | Read-only keep/simplify/refactor/drop/needs_evidence |
| `monitor` | Observe → wait or act → loop |
| `ship` | `autoplan` → `autodoc` → `autoimplement` |
| `harden` | Inspect one plugin defect, fix, verify |

Project files in `.opencode/workflows/*.workflow.ts` override bundled names.

## Author

```ts
import { agent, defineWorkflow, includeWorkflow } from "@phall1/opencode-workflows/dsl"

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

`/workflow` kicks off a run and returns. Agent steps default to a **child
session**. Use `session: "origin"` only when a step must read this conversation
(autoplan capture); that step will write into this chat. The panel shows nested
steps, prompts, outputs, decisions and the model source; select a step for its
details, enter opens its session, `a` answers a checkpoint, `x` stops. The
footer chip opens it. `f` opens the graph for long runs (the step list works
even when the optional diagram renderer is unavailable). `decision` uses Jev
Choice when `TYPESAFE_API_KEY` is set, otherwise `generate.text`. The fallback
is **uncalibrated** and can never pass a `minConfidence` gate: it routes to
`uncertain` instead. Graphs must handle that branch. `wait` sleeps on the
OpenCode service. `includeWorkflow` runs a child graph and routes on declared
named exits. Invalid routes fail rather than returning a partial green run.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
