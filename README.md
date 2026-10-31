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

### [`@phall1/opencode-teleport`](./packages/teleport)

Move a complete session and its child-session tree between OpenCode servers.
Builds on OpenCode 2.2's `experimental.session.export`/`import` primitives and
adds remote discovery, the session tree, location remapping, idempotent
conflict handling, and post-import verification. Agent tool, `/teleport`
command, and an interactive TUI flow.

```jsonc
{
  "plugins": [
    {
      "package": "github:phall1/opencode-plugins#<commit>::path:packages/teleport",
      "options": { "remotes": { "mini": { "url": "http://host:49374", "passwordEnv": "MINI_PASSWORD" } } }
    }
  ]
}
```

```
/teleport                                   pull or push, guided
/teleport pull mini ses_123 --directory .   explicit
/teleport remotes                           probe servers
```

Transfers the transcript, not the working tree. Session IDs are preserved and
existing sessions are never overwritten. See the
[package README](./packages/teleport/README.md) for discovery, conflicts and
verification semantics.

### [`@phall1/opencode-router`](./packages/router)

Jev-powered automatic Code Mode discovery. Preloads relevant exact tool paths
and input schemas before the main model call, avoiding a search round trip.
Native search, permissions, and phux terminal ownership remain authoritative.
Includes bounded routing, runtime diagnostics, and a verified standalone bundle
for global deployment without npm preparation. See the package's
[evaluation evidence](./packages/router/EVALUATION.md).

## Local development

Router `0.1.1` and workflows `0.0.2` are validated with Bun `1.4.3`,
OpenCode/SDK `2.0.32` and Effect `4.0.1`. Teleport `0.2.0` targets OpenCode
`2.2.5` and Effect `4.0.6` because session transfer endpoints appear there.
Teleport pins OpenTUI `0.8.0` to match OpenCode `2.2.5`; workflows stays on
`0.5.17`. Solid `1.9.12` is shared. Keep each package aligned with its target
host. TypeScript stays at `5.9.3` because
`opentui-spinner` and `bun-ffi-structs` require the `^5` peer range.
The root overrides pair `seroval`/`seroval-plugins` at `1.6.9` for security
and keep `@effect/platform-node-shared` at `4.0.1`: `4.0.5` requires Effect
`^4.0.5` and fails Drive startup against the stable host runtime.

Validate releases with `bun install --frozen-lockfile`, `bun run check`,
`bun run --cwd packages/workflows test:tui`, and `bun audit`.
Builds regenerate committed artifacts without install lifecycle hooks;
`npm pack --dry-run` in each package previews publication contents.

For local plugin development, temporarily disable the global pinned workflows
entry and add `./packages/workflows` to this project's `opencode.jsonc`.
Local plugins need `server.ts` / `tui.tsx` at the package root (same layout as
beads). The CLI picks `./tui` up automatically.
