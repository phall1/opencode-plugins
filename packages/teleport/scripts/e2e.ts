/**
 * End-to-end proof against two real, isolated OpenCode servers:
 *
 *   A (source)      fixture sessions imported over the HTTP API
 *   B (destination) loads this plugin with A configured as a remote
 *
 * The pull runs through B's registered `/teleport` command, so this exercises
 * plugin loading, plugin options, command registration, local endpoint
 * discovery from a service registration, remote HTTP export and local import.
 */
import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { runAction } from "../src/actions.ts"
import { httpApi } from "../src/http.ts"
import type { Transfer } from "../src/types.ts"

const password = "e2e-secret"
const packageDirectory = resolve(import.meta.dir, "..")
const fixture = JSON.parse(
  readFileSync(join(packageDirectory, "test", "fixtures", "transcript.json"), "utf8"),
) as Transfer

const root = mkdtempSync(join(tmpdir(), "teleport-e2e-"))

type Server = {
  readonly name: string
  readonly url: string
  readonly pid: number
  readonly process: ReturnType<typeof Bun.spawn>
  readonly options: Record<string, unknown>
  readonly logs: () => string
}

function log(message: string): void {
  console.log(`• ${message}`)
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") })
  const port = probe.port
  if (port === undefined) throw new Error("could not reserve a port")
  probe.stop(true)
  return port
}

async function call(
  url: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const response = await fetch(new URL(path, url), {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : undefined }
}

async function startServer(name: string, plugins?: unknown): Promise<Server> {
  const directory = join(root, name)
  const configDirectory = join(directory, "config", "opencode")
  const configFile = join(directory, "config", "opencode.json")
  const workDirectory = join(directory, "work")
  mkdirSync(configDirectory, { recursive: true })
  mkdirSync(workDirectory, { recursive: true })
  if (plugins !== undefined) {
    writeFileSync(configFile, JSON.stringify({ plugins }, null, 2))
  }
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    XDG_DATA_HOME: join(directory, "data"),
    XDG_STATE_HOME: join(directory, "state"),
    XDG_CONFIG_HOME: join(directory, "config"),
    OPENCODE_CONFIG_DIR: configDirectory,
    OPENCODE_CONFIG: configFile,
    OPENCODE_PASSWORD: password,
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_FILEWATCHER_DISABLE: "1",
    OPENCODE_DISABLE_FFF: "1",
  }
  const child = Bun.spawn({
    cmd: [process.env.OPENCODE_BIN ?? "opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"],
    cwd: workDirectory,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  let output = ""
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) output += decoder.decode(chunk)
  }
  void drain(child.stdout as ReadableStream<Uint8Array>)
  void drain(child.stderr as ReadableStream<Uint8Array>)

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const info = await call(url, "GET", "/api/info")
      if (info.status === 200) {
        log(`${name} ready on ${url} (pid ${info.data.pid}, OpenCode ${info.data.version})`)
        return { name, url, pid: info.data.pid, process: child, options: { env, directory }, logs: () => output }
      }
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error(`${name} exited during startup:\n${output}`)
    await Bun.sleep(200)
  }
  child.kill()
  throw new Error(`${name} did not become ready:\n${output}`)
}

/** A registration file with the destination server's pid is what the plugin discovers inside that server. */
function registerDestination(server: Server): void {
  const directory = join((server.options.env as Record<string, string>).XDG_STATE_HOME!, "opencode")
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, "service.json"),
    JSON.stringify({ id: "e2e", version: "2.2.5", url: server.url, pid: server.pid, password }),
  )
}

function payload(id: string, options: { parentID?: string; title: string; messagePrefix: string; directory: string }): Transfer {
  return {
    info: {
      ...fixture.info,
      id,
      title: options.title,
      parentID: options.parentID,
      location: { directory: options.directory },
      time: { created: Date.now(), updated: Date.now(), idle: Date.now() },
    },
    messages: fixture.messages.map((message, index) => ({
      ...(message as Record<string, unknown>),
      id: `${options.messagePrefix}_${String(index).padStart(3, "0")}`,
    })),
  }
}

const servers: Server[] = []
try {
  const remote = await startServer("a-source")
  servers.push(remote)
  const local = await startServer("b-destination", [
    {
      package: packageDirectory,
      options: { remotes: { a: { url: remote.url, password } } },
    },
  ])
  servers.push(local)

  const workRemote = join(root, "work", "remote")
  const workLocal = join(root, "work", "local")
  mkdirSync(workRemote, { recursive: true })
  mkdirSync(workLocal, { recursive: true })

  const rootID = "ses_e2eRoot00000000000000001"
  const childID = "ses_e2eChild0000000000000001"
  const inserted = await call(
    remote.url,
    "POST",
    "/api/experimental/session/import",
    payload(rootID, { title: "E2E root", messagePrefix: "msg_e2e_root", directory: workRemote }),
  )
  assert.equal(inserted.status, 200, JSON.stringify(inserted.data))
  const insertedChild = await call(
    remote.url,
    "POST",
    "/api/experimental/session/import",
    payload(childID, {
      parentID: rootID,
      title: "E2E child",
      messagePrefix: "msg_e2e_child",
      directory: workRemote,
    }),
  )
  assert.equal(insertedChild.status, 200, JSON.stringify(insertedChild.data))
  log(`seeded ${rootID} and child ${childID} on the source server`)

  registerDestination(local)

  // Location services boot lazily on the first request for that directory, and
  // plugins register while booting. Poll instead of racing the first request.
  let teleport: { name: string; description?: string } | undefined
  const commandDeadline = Date.now() + 30_000
  let commands: Awaited<ReturnType<typeof call>> | undefined
  while (Date.now() < commandDeadline) {
    commands = await call(local.url, "GET", "/api/command")
    teleport = (commands.data.data as Array<{ name: string; description?: string }>).find(
      (command) => command.name === "teleport",
    )
    if (teleport) break
    await Bun.sleep(250)
  }
  assert.ok(teleport, `plugin command not registered: ${JSON.stringify(commands?.data)}`)
  log(`plugin loaded in the destination server and registered: ${teleport.description}`)

  const negative = await call(local.url, "POST", "/api/session", { title: "driver", location: { directory: workLocal } })
  assert.equal(negative.status, 200)
  const driverID = negative.data.data.id
  const absent = await call(local.url, "POST", `/api/session/${driverID}/command`, {
    name: "not-a-teleport-command",
    text: "",
  })
  assert.equal(absent.status, 404)
  log("unknown commands are still rejected by the server (404)")

  const invoked = await call(local.url, "POST", `/api/session/${driverID}/command`, {
    name: "teleport",
    text: `pull a ${rootID} --directory ${workLocal}`,
  })
  assert.equal(invoked.status, 204, JSON.stringify(invoked.data))

  const pulledRoot = await call(local.url, "GET", `/api/experimental/session/${rootID}/export`)
  assert.equal(pulledRoot.status, 200, JSON.stringify(pulledRoot.data))
  assert.equal(pulledRoot.data.data.messages.length, fixture.messages.length)
  assert.equal(pulledRoot.data.data.info.location.directory, workLocal)
  const pulledChild = await call(local.url, "GET", `/api/experimental/session/${childID}/export`)
  assert.equal(pulledChild.status, 200)
  assert.equal(pulledChild.data.data.info.parentID, rootID)
  log(`/teleport pull imported the root and its child into the destination server`)

  const localApi = httpApi({ name: "local", url: local.url, username: "opencode", password })
  const deps = {
    options: { remotes: { a: { url: remote.url, password } } },
    env: {},
    local: () => localApi,
    localReason: () => "e2e",
    defaultDirectory: workLocal,
  }

  const remotes = await runAction({ action: "remotes" }, deps)
  assert.equal(remotes.ok, true, remotes.text)
  assert.match(remotes.text, /a\s+http:\/\/127\.0\.0\.1:\d+\s+OpenCode/)
  assert.match(remotes.text, /local\s+http:\/\/127\.0\.0\.1:\d+\s+OpenCode 2\.2\.5/)
  log("remotes probe reported both servers")

  const sessions = await runAction({ action: "sessions", remote: "a" }, deps)
  assert.equal(sessions.ok, true, sessions.text)
  assert.match(sessions.text, /E2E root/)
  assert.equal(sessions.metadata.count, 1)
  log(`sessions listed the remote roots (${String(sessions.metadata.count)} row)`)

  const pushedSession = await call(local.url, "POST", "/api/session", {
    title: "E2E pushed",
    location: { directory: workLocal },
  })
  assert.equal(pushedSession.status, 200)
  const pushedID = pushedSession.data.data.id
  const pushed = await runAction(
    { action: "push", remote: "a", sessionID: pushedID, includeChildren: true, onConflict: "fail" },
    deps,
  )
  assert.equal(pushed.ok, true, pushed.text)
  const pushedExport = await call(remote.url, "GET", `/api/experimental/session/${pushedID}/export`)
  assert.equal(pushedExport.status, 200)
  log(`push created ${pushedID} on the remote server`)

  const conflict = await runAction(
    { action: "push", remote: "a", sessionID: rootID, includeChildren: false, onConflict: "skip" },
    deps,
  )
  assert.equal(conflict.ok, true, conflict.text)
  assert.match(conflict.text, /1 skipped/)
  log("push honoured --skip-conflicts for an existing session")

  const direct = await runAction(
    { action: "pull", remote: "a", sessionID: childID, includeChildren: false, onConflict: "fail", directory: workLocal },
    deps,
  )
  assert.equal(direct.ok, false)
  assert.match(direct.text, /already exists|conflict/i)
  log("pulling a child alone reports the missing/duplicate parent instead of corrupting state")

  console.log("\nE2E passed")
} finally {
  for (const server of servers) {
    server.process.kill()
    await server.process.exited
  }
  if (process.env.KEEP_E2E === "1") {
    console.log(`kept ${root}`)
  } else {
    rmSync(root, { recursive: true, force: true })
  }
}
