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
/workflow autoplan <task>         start
/workflow status
/workflow cancel
/workflow answer { ... }
/workflow-graph                   session panel
```

The model uses the `workflow` tool (`list`, `start`, `status`, `cancel`,
`submit`, `answer`).

## Bundled workflows

| Name | What it does |
| --- | --- |
| `echo` | One agent step |
| `autoplan` | Intent → candidates → choose → plan → summary |
| `autodoc` | Record an existing plan in docs |
| `autoimplement` | Implement, verify, fix loop |
| `sanity-check` | Read-only keep/simplify/refactor/drop/needs_evidence |
| `monitor` | Observe → wait or act → loop |
| `ship` | `autoplan` → `autodoc` → `autoimplement` |

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

`agent` defaults to a child session. Use `session: "origin"` when the step
must keep the current conversation (autoplan does this). `decision` uses
`generate.text`. `wait` sleeps on the OpenCode service. `includeWorkflow`
runs a child graph and routes on named exits.
