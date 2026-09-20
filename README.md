# OpenCode Plugins

Plugins for [OpenCode](https://opencode.ai) V2.

This repo's `opencode.jsonc` loads the workflows plugin from source.

## Plugins

### [`@phall1/opencode-workflows`](./packages/workflows)

Typed workflow graphs that run as Effects on the OpenCode server. Agent steps
are sessions, decisions are `generate.text`, checkpoints are `Deferred`s, cancel
is fiber interrupt, and the live graph lives in a session panel.

```jsonc
{
  "plugins": ["@phall1/opencode-workflows"]
}
```

Bundled: `echo`, `autoplan`, `autodoc`, `autoimplement`, `sanity-check`,
`monitor`, `ship`.

```
/workflow
/workflow autoplan plan a timeout fallback for this plugin
/workflow-graph
```

## Local development

Open this directory in OpenCode. Project `opencode.jsonc` loads
`./packages/workflows`. Local plugins need `server.ts` / `tui.tsx` at the
package root (same layout as beads). The CLI picks `./tui` up automatically.
