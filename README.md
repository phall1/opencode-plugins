# OpenCode Plugins

Plugins for [OpenCode](https://opencode.ai) V2.

## Plugins

### [`@phall1/opencode-workflows`](./packages/workflows)

Typed workflow graphs that run inside OpenCode. Agent steps are child sessions,
decisions are cheap `generate.text` calls, and the live graph lives in a session
panel — not a second TUI.

```jsonc
{
  "plugins": ["@phall1/opencode-workflows"]
}
```

## Local development

Point OpenCode at the package source so the TUI hot-reloads:

```jsonc
// opencode.jsonc
{
  "plugins": ["/Users/phall/workspace/opencode-plugins/packages/workflows/src/index.ts"]
}
```

```jsonc
// ~/.config/opencode/cli.json
{
  "plugins": ["/Users/phall/workspace/opencode-plugins/packages/workflows/src/tui.tsx"]
}
```

## Why this is not a pi-workflows port

pi-workflows is a workflow engine that had to invent a host: SQLite server,
custom protocol, Rust viewer, Herdr panes, resource managers. OpenCode already
has a background service, plugin RPC, sessions, tools, commands, storage, and
session panels. This repo keeps the graph DSL and throws the rest away.
