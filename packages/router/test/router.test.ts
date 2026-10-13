import { expect, test } from "bun:test"
import { alreadyShown, availableTools, catalog, renderTools, requestCatalog, toolPath, type CatalogTool } from "../src/catalog"
import { routingState } from "../src/context"
import { rank, Router } from "../src/router"
import { readOptions } from "../src/options"
import { Schema } from "effect"
import type { SessionContext } from "@opencode/plugin/promise/session"

const options = readOptions({})
const tools: CatalogTool[] = [
  { id: "phux_panes", path: "tools.phux_panes", description: "Discover panes", input: { type: "object" } },
  { id: "phux_snapshot", path: "tools.phux_snapshot", description: "Read terminal output", input: { type: "object" } },
]
const selection = { relevance: 0.95, probabilities: { none: 0.01, phux_panes: 0.75, phux_snapshot: 0.24 }, inputTokens: 30, outputTokens: 10 }
const state = { request: "which worker panes are open?", recent: [] }

test("paths follow namespace, normalized name and bracket semantics", () => {
  expect(toolPath({ name: "read-file", options: { namespace: "acme.tools" } })).toBe('tools.acme.tools["read-file"]')
  expect(toolPath({ name: "hello.world" })).toBe("tools.hello_world")
  expect(toolPath({ name: "list", options: { namespace: "odd-name.2tools" } })).toBe('tools["odd-name"]["2tools"].list')
})

test("request catalog scopes registry tools to advertised namespaces and latest update", () => {
  const text = "The Code Mode tool catalog below is partial.\n## Available tools\n- phux_panes (1 tool)\n  - tools.phux_panes({}): Promise<string>\n- blackbird (1 tool, none shown)\n- strange-name (1 tool, none shown)"
  const registered = [
    ...tools.map((tool) => ({ ...tool, name: tool.id })),
    { ...tools[0]!, id: "blackbird_read", name: "read", options: { namespace: "blackbird" } },
    { ...tools[0]!, id: "other", name: "read", options: { namespace: "browser" } },
    { ...tools[0]!, id: "odd", name: "read", options: { namespace: "strange-name" } },
  ]
  expect(availableTools(registered, text).map((tool) => tool.id)).toEqual(["blackbird_read", "odd", "phux_panes"])
  expect(alreadyShown(tools[0]!, text)).toBe(true)
  expect(alreadyShown(tools[1]!, text)).toBe(false)
  expect(requestCatalog([text, "New Code Mode catalog\n## Available tools\n- updated (1 tool)"])).toContain("updated")
  expect(requestCatalog(["No catalog here"])).toBeUndefined()
  expect(requestCatalog([text, "The Code Mode tool catalog has changed.\nThe following tool namespaces are no longer available and must not be used: `phux_panes`."])).toBeUndefined()
  expect(requestCatalog([text, "The Code Mode tool catalog has changed.\nNew tools are available in addition to those previously listed:"])).toBeUndefined()
  expect(requestCatalog([text, "The Code Mode tool catalog has changed.\nChanged tool listings supersede the previously listed ones:"])).toBeUndefined()
  expect(requestCatalog([text, "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools."])).toBeUndefined()
})

test("permission-filtered or changed namespace inventory is not enriched", () => {
  const registered = [
    { ...tools[0]!, id: "acme_allowed", name: "allowed", options: { namespace: "acme" } },
    { ...tools[0]!, id: "acme_denied", name: "denied", options: { namespace: "acme" } },
  ]
  expect(availableTools(registered, "- acme (1 tool, none shown)")).toEqual([])
  expect(availableTools(registered, "- acme (2 tools, none shown)")).toHaveLength(2)
  registered[0]!.input = { "~standard": { vendor: "unsupported" } }
  expect(availableTools(registered, "- acme (1 tool, none shown)")).toEqual([])
})

test("catalog converts schemas and leaves unsupported/direct tools to the host", () => {
  const registered = [
    { id: "one", name: "one", description: "one", input: Schema.Struct({ name: Schema.String }) },
    { id: "direct", name: "direct", description: "", input: {}, options: { codemode: false } },
    { id: "unsupported", name: "unsupported", description: "", input: { "~standard": { vendor: "custom" } } },
    { id: "standard", name: "standard", description: "", input: { "~standard": { jsonSchema: { input: () => ({ type: "object" }) } } } },
  ]
  const result = catalog(registered)
  expect(result.map((tool) => tool.id)).toEqual(["one", "standard"])
  expect(result[0]!.input.properties).toHaveProperty("name")
})

test("rendering never truncates a schema, obeys its budget and labels fallback", () => {
  const text = renderTools(tools, 6000)
  expect(text).toContain("tools.phux_panes")
  expect(text).toContain("Use search for other tools")
  expect(text).toContain("not an instruction to act or permission")
  expect(renderTools(tools, 10)).toBe("")
  expect(renderTools([{ ...tools[0]!, input: { large: "x".repeat(6000) } }, tools[1]!], 1200)).toContain("tools.phux_snapshot")
  for (const line of text.split("\n").filter((line) => line.startsWith("{"))) expect(() => JSON.parse(line)).not.toThrow()
})

test("bounded state omits system secrets, media and reasoning, retains latest tool observations", () => {
  const messages = [
    { role: "system", content: [{ type: "text", text: "SYSTEM_SECRET" }] },
    { role: "user", content: [{ type: "text", text: "Observe the worker" }, { type: "media", media: "MEDIA_SECRET" }] },
    { role: "assistant", content: [{ type: "reasoning", text: "REASONING_SECRET" }, { type: "tool-call", name: "phux_panes", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", name: "phux_panes", result: { type: "text", value: "@42 working" } }] },
    { role: "tool", content: [{ type: "tool-result", name: "read", result: { type: "content", value: [{ type: "file", uri: "data:image/png;base64,MEDIA_SECRET", mime: "image/png" }, { type: "text", text: "Read image" }] } }] },
    { role: "tool", content: [{ type: "tool-result", name: "execute", result: { type: "json", value: { files: [{ uri: "data:image/png;base64,MEDIA_SECRET" }], image: "IMAGE_SECRET", output: "worker @42 working" } } }] },
  ] as SessionContext["messages"]
  const result = routingState(messages, 500)
  expect(result.request).toBe("Observe the worker")
  expect(JSON.stringify(result)).toContain("@42 working")
  expect(JSON.stringify(result)).not.toContain("SECRET")
  expect(result.request.length + result.recent.reduce((total, item) => total + item.text.length, 0)).toBeLessThanOrEqual(500)
})

test("relevance and no-match gate selections, probabilities admit multiple useful tools", () => {
  expect(rank(selection, tools, options).map((tool) => tool.id)).toEqual(["phux_panes", "phux_snapshot"])
  expect(rank({ ...selection, relevance: 0.2 }, tools, options)).toEqual([])
  expect(rank({ ...selection, probabilities: { none: 0.8, phux_panes: 0.2 } }, tools, options)).toEqual([])
})

test("concurrent identical requests share judgments; changed observation or catalog invalidates", async () => {
  let calls = 0
  const router = new Router(options, { key: async () => "secret", evaluate: async () => { calls++; return selection } })
  const [first, second] = await Promise.all([router.route(state, tools), router.route(state, tools)])
  expect(calls).toBe(1)
  expect(first.selected).toEqual(["phux_panes", "phux_snapshot"])
  expect(second.cached).toBe(true)
  expect(second.inputTokens).toBe(0)
  await router.route({ ...state, recent: ["worker is blocked"] }, tools)
  await router.route(state, [{ ...tools[0]!, description: "New description" }])
  expect(calls).toBe(3)
  router.dispose()
})

test("already-shown tools do not crowd out hidden tools or reuse an incompatible cached selection", async () => {
  const router = new Router(readOptions({ maxTools: 1 }), { key: async () => "secret", evaluate: async () => selection })
  expect((await router.route(state, tools)).selected).toEqual(["phux_panes"])
  expect((await router.route(state, tools, ["phux_panes"])).selected).toEqual(["phux_snapshot"])
  router.dispose()
})

test("service failures fail open with cooldown, then recover", async () => {
  let now = 0
  let calls = 0
  const router = new Router(options, { key: async () => "secret", now: () => now, evaluate: async () => { calls++; if (calls === 1) throw new Error("secret body"); return selection } })
  expect((await router.route(state, tools)).reason).toBe("unavailable")
  expect((await router.route(state, tools)).reason).toBe("cooldown")
  now = 30_001
  expect((await router.route(state, tools)).reason).toBe("selected")
  router.dispose()
})

test("deadlines abort fetch and bound a stuck credential command", async () => {
  let signal: AbortSignal | undefined
  const router = new Router(readOptions({ timeoutMs: 100 }), { key: async () => "secret", evaluate: async (input) => {
    signal = input.signal
    return new Promise(() => {})
  } })
  expect((await router.route(state, tools)).reason).toBe("unavailable")
  expect(signal!.aborted).toBe(true)
  const stuck = new Router(readOptions({ timeoutMs: 100 }), { key: () => new Promise(() => {}) })
  const started = Date.now()
  expect((await stuck.route(state, tools)).reason).toBe("unavailable")
  expect(Date.now() - started).toBeLessThan(500)
  router.dispose()
  stuck.dispose()
})

test("unload cancels outstanding judgments", async () => {
  const router = new Router(options, { key: async () => "secret", evaluate: async () => new Promise(() => {}) })
  const pending = router.route(state, tools)
  router.dispose()
  expect((await pending).reason).toBe("unavailable")
})

test("large catalogs are completely covered using API-bounded chunks", async () => {
  const chunks: number[] = []
  const large = Array.from({ length: 300 }, (_, index) => ({ ...tools[0]!, id: `tool_${index}` }))
  const router = new Router(options, { key: async () => "secret", evaluate: async ({ candidates }) => {
    chunks.push(candidates.length)
    return { ...selection, probabilities: Object.fromEntries([ ["none", 0], ...candidates.map((candidate, index) => [candidate.id, index === 0 ? 1 : 0]) ]) }
  } })
  expect((await router.route(state, large)).selected).toEqual(["tool_0", "tool_254"])
  expect(chunks).toEqual([254, 46])
  router.dispose()
})

test("oversized catalog fails open without a paid request", async () => {
  const router = new Router(readOptions({ maxCatalogChars: 1000 }), { key: async () => { throw new Error("must not request key") } })
  expect((await router.route(state, Array.from({ length: 50 }, (_, index) => ({ ...tools[0]!, id: String(index) })))).reason).toBe("catalog-budget")
  router.dispose()
})
