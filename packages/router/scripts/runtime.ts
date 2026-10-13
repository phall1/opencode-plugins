import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"

const { values } = parseArgs({ options: { config: { type: "string" }, directory: { type: "string" }, output: { type: "string" } } })
if (!values.config || !values.directory) throw new Error("Provide --config (credential options) and --directory (disposable project root)")
const config = await Bun.file(values.config).json()
const credentialOptions = config.plugins.find((plugin: { package?: string }) => plugin.package?.includes("router"))?.options ?? {}
const executable = process.env.OPENCODE_BIN ?? "opencode"
const pluginPath = fileURLToPath(new URL("../", import.meta.url))
const fixturePath = fileURLToPath(new URL("../test/fixture/", import.meta.url))
const results = []

function api(method: string, path: string, directory: string, body?: unknown): any {
  const args = ["api", method, path, "--header", `x-opencode-directory:${directory}`]
  if (body !== undefined) args.push("--data", JSON.stringify(body))
  const output = execFileSync(executable, args, { encoding: "utf8", maxBuffer: 2_000_000, timeout: 180_000 }).trim()
  return output ? JSON.parse(output) : undefined
}

for (const enabled of [false, true]) {
  const directory = `${values.directory}/${enabled ? "enabled" : "baseline"}`
  await Bun.write(`${directory}/opencode.jsonc`, JSON.stringify({
    plugins: [fixturePath, { package: pluginPath, options: { ...credentialOptions, enabled } }],
  }, null, 2))
  const statusBefore = api("post", "/api/rpc/phall.router/status", directory, { input: {} })
  const fixtureBefore = api("post", "/api/rpc/phall.router.fixture/status", directory, { input: {} }).output.calls
  const created = api("post", "/api/session", directory, { title: `Router ${enabled ? "enabled" : "baseline"} self-eval`, location: { directory } })
  const id = created.data.id
  try {
    const started = Date.now()
    api("post", `/api/session/${id}/prompt`, directory, { text: "Use the router_fixture echo tool to echo the marker ROUTER_SMOKE. This is a harmless runtime test. Do not use shell, edit files, or control terminals. After the tool returns, reply with its result." })
    api("post", `/api/experimental/session/${id}/wait`, directory, {})
    const messages = api("get", `/api/session/${id}/context`, directory).data
    const assistants = messages.filter((message: { type: string }) => message.type === "assistant")
    const calls = assistants.flatMap((message: { content: any[] }) => message.content.filter((part) => part.type === "tool"))
    const searches = calls.filter((call: any) => /\bsearch\s*\(/.test(call.state.input.code ?? ""))
    const echoes = calls.filter((call: any) => /router_fixture.*echo/.test(call.state.input.code ?? "") && call.state.status === "completed" && JSON.stringify(call.state.content).includes("fixture echo: ROUTER_SMOKE"))
    const fixtureAfter = api("post", "/api/rpc/phall.router.fixture/status", directory, { input: {} }).output.calls
    const status = api("post", "/api/rpc/phall.router/status", directory, { input: {} }).output
    const result = { enabled, sessionID: id, durationMs: Date.now() - started, model: assistants[0]?.model, assistantSteps: assistants.length, executeCalls: calls.length, searchCalls: searches.length, successfulEchoes: echoes.length, router: status, baselineCounters: statusBefore.output.counters }
    results.push(result)
    console.log(JSON.stringify(result, null, 2))
    if (echoes.length === 0 || fixtureAfter <= fixtureBefore) throw new Error("Runtime did not successfully execute the fixture echo")
    if (enabled && searches.length > 0) throw new Error("Enabled router still required tool search")
    if (enabled && status.counters.injectedChars <= statusBefore.output.counters.injectedChars) throw new Error("Router did not preload a schema")
  } finally {
    api("delete", `/api/session/${id}`, directory)
  }
}

// A native deny must remove the fixture from discovery and prevent execution.
const deniedDirectory = `${values.directory}/enabled`
const callsBefore = api("post", "/api/rpc/phall.router.fixture/status", deniedDirectory, { input: {} }).output.calls
const denied = api("post", "/api/session", deniedDirectory, {
  title: "Router denied-tool self-eval", location: { directory: deniedDirectory },
  permissions: [{ action: "router_fixture", resource: "*", effect: "deny" }],
}).data.id
try {
  api("post", `/api/session/${denied}/prompt`, deniedDirectory, { text: "Use the router_fixture echo tool with ROUTER_SMOKE if available. If this tool is unavailable or denied, report that and stop. Do not use shell, edits, terminal tools, or substitutes." })
  api("post", `/api/experimental/session/${denied}/wait`, deniedDirectory, {})
  const callsAfter = api("post", "/api/rpc/phall.router.fixture/status", deniedDirectory, { input: {} }).output.calls
  const status = api("post", "/api/rpc/phall.router/status", deniedDirectory, { input: {} }).output
  if (callsAfter !== callsBefore) throw new Error("Permission-denied fixture executed")
  if (status.sessions[denied]?.selected.includes("router_fixture_echo")) throw new Error("Permission-denied fixture advertised by router")
  results.push({ permissionDeny: "passed", fixtureExecutions: callsAfter - callsBefore })
  console.log("PASS permission-denied tool was neither preloaded nor executed")
} finally {
  api("delete", `/api/session/${denied}`, deniedDirectory)
}
if (values.output) await Bun.write(values.output, `${JSON.stringify(results, null, 2)}\n`)
