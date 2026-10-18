# @phall1/opencode-router

Automatic tool discovery for OpenCode V2. Before an agent-loop model call, Jev
selects relevant Code Mode tools and the plugin supplies their exact paths and
complete input schemas. The main model can call them without spending a turn on
`search`. Native discovery remains available when the suggestion is wrong or
Jev is unavailable. Requires OpenCode 2.0.27 or newer.

## Load globally

Add one entry to `~/.config/opencode/opencode.jsonc`, preserving other plugins:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "/absolute/path/to/packages/router", "options": {} }
  ]
}
```

Use `TYPESAFE_API_KEY` in the server environment, or `options.apiKeyCommand` as
an argv array for an existing credential manager. The command must print only
the key. It is executed with a three-second deadline, never with model-derived
arguments. No key is written into configuration, telemetry, or session history.
The successful credential is cached in memory for up to five minutes, so
credential-command rotation recovers without restarting the service.

For portable installs, pin this repository's commit. **OpenCode 2.0.27's
bundled-npm Git preparation can fail before plugin loading.** The verified
workstation deployment uses a native Chezmoi `file` external instead: fetch the
committed `server.js` at an immutable commit, verify its SHA256, materialize it
under `~/.config/opencode/vendor/jev-router/server.js`, and load
`./vendor/jev-router` with the credential-command options above. The bundle is
the complete server plugin; it needs no npm install or runtime SDK.

Release `0.1.1` is verified against OpenCode/SDK `2.0.32` and Effect `4.0.1`.
Checked-in `server.js` SHA256:
`4d097e10091822a2bfa15e7f1927b2cc74aa5d90653a5321015b6d24b4502a68`.

Where the host's Git package installer works, this form is also supported:

```jsonc
{
  "plugins": [
    "github:phall1/opencode-plugins#<verified-commit>::path:packages/router"
  ]
}
```

No terminal companion or MCP server is required. Existing phux and MCP plugins
continue to own their tools. Global loading applies across projects and clients
using that OpenCode service. Other machines need the same configuration and a
resolvable TypeSafe credential.

## Behavior and safety

- Routes every primary step using the latest user request and bounded recent
  text/tool observations. Does not classify titles, compaction, or generation.
- A Choice includes `none`. `1 - P(none)` gates relevance; this is not permission
  or a guarantee of correctness. Up to three options with probability at least
  0.2 and above `P(none)` are offered. The model still chooses what to execute.
- Ordinary builds, tests, git and background jobs stay on native shell. Phux is
  for interactive programs, explicitly watched panes, and existing agent panes.
- Only namespaces advertised in the current native catalog are considered, and
  their advertised tool count must match the registry. Ambiguous inventories
  and compact catalog deltas disable enrichment rather than reusing stale state.
  Registry listing is not an exact permission-filtered snapshot: a hidden tool
  in an advertised namespace may still be denied or unavailable. Native runtime
  validation and permission checks remain authoritative; search is the fallback.
- Leaves native tools, permissions, transcript, and the original catalog intact.
  Schemas already shown are not repeated. An oversized schema is skipped whole.
- Identical bounded state/catalog requests share an in-memory judgment. Changed
  tool observations or descriptions trigger a new judgment. No transcript cache
  is persisted; cache and per-session diagnostics are capped at 64 entries.
- A 1.5-second classifier deadline bounds added latency, including credential
  waiting. Failures preserve normal behavior and start a 30-second cooldown.
  Plugin unload aborts fetches. The Promise hook has no session cancellation
  signal; interrupting a session may leave a classifier running until its deadline.
- The bounded latest request, recent tool text and tool descriptions are sent to
  TypeSafe. System prompts, reasoning and media payloads are not intentionally
  sent. Text may contain sensitive data: set `enabled: false` in sensitive
  environments. There is no local-model fallback or additional logging service.

Options: `enabled`, `model`, `apiKeyCommand`, `timeoutMs`, `maxTools`,
`maxContextChars` (6000), `maxCatalogChars` (64000), `minRelevance` (0.55), and
`minProbability` (0.2). Budgets and thresholds are validated. Large catalogs are
split into independent Choices of at most 254 tools plus `none`; oversized
catalogs fail open rather than silently dropping candidates.

## Observe

```sh
opencode api post /api/rpc/phall.router/status --data '{"input":{}}'
```

Returns per-location counters, token use, total routing time and latest selected
IDs per session—never prompts or credentials. `catalog` returns registered
convertible Code Mode metadata for evaluation (not a permission-filtered list).

## Verify and evaluate

```sh
bun run check
opencode api post /api/rpc/phall.router/catalog --data '{"input":{}}' > catalog.json
bun run scripts/eval.ts --catalog catalog.json --config /path/to/test/opencode.jsonc --output eval.json
bun run scripts/runtime.ts --config /path/to/test/opencode.jsonc --directory /path/to/disposable/project --output runtime.json
```

The live eval uses the actual registered catalog and representative positive,
negative, continuation and untrusted-output cases. It is a development smoke
set, not a held-out generalization benchmark. Runtime evaluation compares the
same main model with/without the router and executes only a harmless fixture
echo. It deletes its test sessions; fixture projects remain for inspection.
Use an isolated directory and the existing credential-command configuration.
Do not commit catalog dumps or prompts. API location headers scope RPC calls;
session creation additionally supplies `location.directory` explicitly.

`server.js` is the bundled deployment artifact. Build changes before publishing;
the package does not depend on the checkout's SDK at runtime.
