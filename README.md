# OpenCode Plugins

Plugins for [OpenCode](https://opencode.ai) V2.

The workflows plugin is loaded from the user's global OpenCode configuration.
The project config does not auto-load a second copy from source.

## Plugins

### [`@phall1/opencode-workflows`](./packages/workflows)

Opt-in typed workflow graphs that run as Effects on the OpenCode server. Agent
steps are sessions, decisions use Jev Choice with an uncalibrated `generate.text`
fallback, checkpoints are `Deferred`s, cancel interrupts the fiber and child
session, and the live graph and per-step details live in a session panel.

```jsonc
{
  "plugins": ["@phall1/opencode-workflows"]
}
```

Bundled: `ping`, `echo`, `wire`, `autoplan`, `autodoc`, `autoimplement`,
`sanity-check`, `monitor`, `ship`, `harden`. Ordinary requests do not auto-start
workflows; ask for one explicitly or use `/workflow`.

```
/workflow
/workflow autoplan plan a timeout fallback for this plugin
/workflow-graph
```

## Local development

For local plugin development, temporarily disable the global pinned workflows
entry and add `./packages/workflows` to this project's `opencode.jsonc`.
Local plugins need `server.ts` / `tui.tsx` at the package root (same layout as
beads). The CLI picks `./tui` up automatically.
