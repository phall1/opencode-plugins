# @phall1/opencode-teleport

Move a complete OpenCode session — and its whole child-session tree — from one
OpenCode server to another, from inside OpenCode, without leaving the TUI.

```jsonc
{
  "plugins": [
    {
      "package": "@phall1/opencode-teleport",
      "options": {
        "remotes": {
          "mini": {
            "url": "http://100.79.155.27:49374",
            "passwordEnv": "MINI_OPENCODE_PASSWORD"
          }
        }
      }
    }
  ]
}
```

```sh
opencode plugin add @phall1/opencode-teleport
```

## What actually transfers

A session is transferred as OpenCode's own projected transcript: session
metadata, every settled message (user, assistant with tool calls and results,
shell, synthetic, compaction, idle), inline media, and token/cost totals. Child
sessions created by agents are discovered through `parentID` and imported after
their parent, so a whole run moves as one unit.

What does not move: the working tree. The transcript arrives, the files do not.
Point the transfer at the checkout that should own the history
(`--directory`), exactly like `opencode session import --directory`.

Session IDs are preserved. Importing a session that already exists on the
destination is a conflict, never a silent overwrite. Export contains settled
messages, so an in-flight turn is not part of the transfer; pull it after the
turn finishes.

## Why this plugin exists

OpenCode 2.2 already ships the primitives: `experimental.session.export`,
`experimental.session.import`, and the `opencode session export|import` CLI.
Those move one session between a file and one server. Teleport is the
cross-server orchestration on top: remote discovery, health probes, the
child-session tree, location remapping, idempotent conflict handling, and
verification that the destination really holds the same messages.

## Surfaces

### Tool (agent-facing)

The `teleport` tool is only for explicit requests ("teleport this session to
the mini"), never for ordinary work.

| Action | Effect |
| --- | --- |
| `remotes` | probe every configured remote and the local server |
| `sessions` | list root sessions on a remote (or locally) |
| `pull` | copy a remote session and its children here |
| `push` | copy a session and its children to a remote |

```
teleport action=pull remote=mini sessionID=ses_... directory=/path/to/repo
teleport action=push remote=mini sessionID=ses_...
```

`push` defaults to the calling session, so "send this session to the mini"
needs only a remote. Conflicts fail by default; pass `onConflict: "skip"` to
make retries idempotent.

### Command

```
/teleport
/teleport remotes
/teleport sessions mini [query]
/teleport pull mini ses_123 --directory /repo
/teleport push mini ses_123 --no-children --skip-conflicts
```

### TUI

`/teleport` with no arguments walks a dialog: pull or push, which server, which
session (searchable), which destination directory. The imported session opens
in a tab. Failures and reports come back as dialogs, not as chat turns.

## Configuration

| Key | Meaning |
| --- | --- |
| `remotes` | `{ name: url }` or `{ name: { url, username?, password?, passwordEnv? } }` |
| `local` | optional override for this server: `url`, `username`, `passwordEnv` |
| `timeoutMs` | per-request timeout, default 30000, clamped to 1s–120s |

Remote passwords resolve in order: `password`, then `passwordEnv`, then
`OPENCODE_TELEPORT_<NAME>_PASSWORD`, then `OPENCODE_TELEPORT_PASSWORD`.
`OPENCODE_TELEPORT_REMOTES` accepts the same object as JSON, which is handy
when the config file is not yours:

```sh
export OPENCODE_TELEPORT_REMOTES='{"mini":{"url":"http://host:49374"}}'
export OPENCODE_TELEPORT_MINI_PASSWORD=...
```

The TUI reads the same entries back from the server config (OpenCode 2.2 does
not hand `options` to TUI plugins), so one entry configures both halves.

## Local server discovery

The server-side tool must talk to its own HTTP API to import. It resolves the
local endpoint as follows:

1. `options.local`
2. `OPENCODE_TELEPORT_LOCAL_URL` + `OPENCODE_TELEPORT_LOCAL_PASSWORD`
3. the `service*.json` registration in the XDG state directory whose `pid`
   matches this server process — the normal background-service path

`opencode serve` and `--standalone` write no registration and keep a random
password, so a plugin inside them cannot authenticate to itself. The TUI half
does not have this limitation: it uses the already-authenticated client, so
`/teleport` works in every mode.

## Semantics

- Parent sessions are imported before children; a missing parent fails that
  child only.
- `onConflict: "skip"` leaves the existing session untouched and still imports
  missing children. `"fail"` (default) aborts at the first conflict.
- After an import, the session is exported again and message IDs are compared.
  A mismatch is reported as `UNVERIFIED`, never as success.
- `--no-children` transfers exactly one session.
- Trees are capped at 200 sessions per transfer (internal safety limit) and
  report `truncated`.

## Development

```sh
bun run check       # typecheck + 73 tests
bun run e2e         # two real isolated OpenCode servers, real command-driven pull
```

The e2e writes fixture sessions to a source server, registers the destination
server's endpoint as its own service registration, and then runs
`/teleport pull` through the destination's registered command handler — plugin
loading, options, command registration, discovery, export, import, and
verification all execute for real. `KEEP_E2E=1` keeps the temp directory.

Validated against OpenCode 2.2.5, Effect 4.0.6, OpenTUI 0.8.0 and Solid
1.9.12.
