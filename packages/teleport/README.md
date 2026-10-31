# @phall1/opencode-teleport

Move a complete OpenCode session — and its whole child-session tree — from one
OpenCode server to another, from inside OpenCode, without leaving the TUI.

Pin the package from this repo, the same way the other plugins are installed:

```jsonc
{
  "plugins": [
    {
      "package": "github:phall1/opencode-plugins#<commit>::path:packages/teleport",
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

`opencode plugin add "github:phall1/opencode-plugins#<commit>::path:packages/teleport"`
writes the same entry. The package is not published to npm.

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

## Transport and authentication

Teleport is a client of OpenCode's own HTTP API; there is no side channel and no
custom server component.

```
  /teleport pull            ┌──────────────┐        ┌──────────────┐
  server plugin / TUI ─────►│  this server │        │ remote server│
                            │  /api/session│        │  /api/session│
                            │  export/import        │  export/import
                            └──────┬───────┘        └──────▲───────┘
                                   │  export transcript    │ import transcript
                                   └─────── HTTP(S) ────────┘
```

| Call | Endpoint |
| --- | --- |
| health | `GET /api/info` |
| session metadata (plan) | `GET /api/session/:id` |
| tree listing | `GET /api/session?parentID=…` |
| export | `GET /api/experimental/session/:id/export` |
| import | `POST /api/experimental/session/import` |

Bodies are JSON. Media travels inline inside the transcript, so a large image
makes a large request; the default per-request timeout is 30 seconds and is
configurable. The local server is only contacted over HTTP by the server-side
tool; the TUI uses the already-authenticated in-process client instead.

Authentication is the server's normal HTTP Basic lease credential, username
`opencode`. There are no forged tokens and no separate teleport secret. A
remote password resolves in this order:

1. `password` in the remote definition
2. `passwordEnv` (an error if the variable is missing)
3. `passwordCommand`: stdout of a command, trimmed. A string runs through
   `sh -c`; an array runs directly. This keeps secrets out of config files.
4. `OPENCODE_TELEPORT_<NAME>_PASSWORD`
5. `OPENCODE_TELEPORT_PASSWORD`

Extra `headers` are sent with every request, which covers reverse proxies and
Cloudflare Access service tokens; an explicit `Authorization` header replaces
Basic auth. TLS is whatever the URL gives you: an `https://` tunnel or proxy is
encrypted, a bare `http://tailnet-ip:port` is not.

Failures map to the real cause: `401/403` credentials, `404` a missing session
or a server too old to expose the transfer endpoints, `409` an existing
session, a transport error unreachable. Passwords are never logged or printed.

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

Pass `dryRun` (or `--plan` on the command) to get the same tree preview the TUI
confirmation uses, without moving data.

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
/teleport pull mini ses_123 --directory "/Users/me/My Repo"
/teleport push mini ses_123 --no-children --skip-conflicts
/teleport pull --plan mini ses_123      # preview the tree, move nothing
```

Quote a path containing spaces, exactly as the flags line in `/teleport`
help says.

### TUI

`/teleport` with no arguments walks a dialog: pull or push, which server, which
session (searchable), which destination directory. Before anything moves it
shows a plan — every session in the tree, the destination — and waits for
confirmation. The imported session opens in a tab. Failures and reports come
back as dialogs, not as chat turns. Pushing lists sessions from the current
project first.

## Configuration

| Key | Meaning |
| --- | --- |
| `remotes` | `{ name: url }` or `{ name: { url, username?, password?, passwordEnv?, passwordCommand?, headers? } }` |
| `local` | optional override for this server: `url`, `username`, `passwordEnv` |
| `timeoutMs` | per-request timeout, default 30000, clamped to 1s–120s |

```jsonc
{
  "remotes": {
    "mini": {
      "url": "https://mini.tailnet.ts.net:49374",
      "passwordCommand": ["op", "read", "op://Private/opencode-mini/password"],
      "headers": { "cf-access-client-id": "…" }
    }
  }
}
```

Remote passwords resolve in order: `password`, then `passwordEnv`, then
`passwordCommand` (stdout, trimmed), then `OPENCODE_TELEPORT_<NAME>_PASSWORD`,
then `OPENCODE_TELEPORT_PASSWORD`.
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
bun run check       # typecheck + 95 tests
bun run e2e         # two real isolated OpenCode servers, real command-driven pull
```

The e2e writes fixture sessions to a source server, registers the destination
server's endpoint as its own service registration, and then runs
`/teleport pull` through the destination's registered command handler — plugin
loading, options, command registration, discovery, export, import, and
verification all execute for real. `KEEP_E2E=1` keeps the temp directory.

Validated against OpenCode 2.2.5, Effect 4.0.6, OpenTUI 0.8.0 and Solid
1.9.12.
