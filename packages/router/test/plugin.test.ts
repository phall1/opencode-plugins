import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import plugin from "../src/plugin"

function harness(options: Record<string, unknown> = {}) {
  let hook: ((event: SessionContext) => Promise<void>) | undefined
  let handlers: Record<string, (input: unknown) => Promise<unknown>> = {}
  const registered = [
    { id: "phux_spawn", name: "phux_spawn", description: "Open an interactive terminal", input: { type: "object", properties: { command: { type: "array", items: { type: "string" } } } } },
    { id: "hidden_tool", name: "hidden_tool", description: "Not advertised to this request", input: {} },
  ]
  const ctx = {
    options, tool: { list: async () => registered },
    rpc: { register: async (_definition: unknown, value: typeof handlers) => { handlers = value } },
    session: { hook: async (_name: string, callback: typeof hook) => { hook = callback } },
  } as unknown as Plugin.Context
  return { ctx, registered, run: (event: SessionContext) => hook!(event), status: () => handlers.status!({}) }
}

function event(sessionID = "ses_test"): SessionContext {
  return {
    sessionID, agent: "build", model: { providerID: "openai", id: "test" },
    system: [{ type: "text", text: "The Code Mode tool catalog below is partial.\n## Available tools\n- phux_spawn (1 tool, none shown)" }],
    messages: [{ role: "user", content: [{ type: "text", text: "Open an interactive debugger in a sibling terminal" }] }],
    tools: { execute: { description: "Code Mode", input: { type: "object" } } }, options: {},
  } as unknown as SessionContext
}

test("actual plugin hook injects only catalog-derived data, leaves tools/history/permissions unchanged", async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.TYPESAFE_API_KEY
  process.env.TYPESAFE_API_KEY = "test-only-key"
  const requested: unknown[] = []
  globalThis.fetch = Object.assign(async (_url: unknown, input: RequestInit) => {
    const body = JSON.parse(input.body as string)
    requested.push(body)
    expect(body.questions.tool.criteria).not.toHaveProperty("hidden_tool")
    return Response.json({ answers: { needed: { type: "noul", noul: 0.99 }, tool: { type: "choice", choice: "phux_spawn", probabilities: { none: 0.01, phux_spawn: 0.99 } } } })
  }, { preconnect: originalFetch.preconnect }) as typeof fetch
  const harnessed = harness()
  const cleanup = await plugin.setup(harnessed.ctx)
  try {
    const first = event()
    const before = JSON.stringify({ tools: first.tools, messages: first.messages, options: first.options })
    await harnessed.run(first)
    expect(first.system).toHaveLength(2)
    expect(first.system[1]!.text).toContain("tools.phux_spawn")
    expect(first.system[1]!.text).toContain('"command"')
    expect(JSON.stringify({ tools: first.tools, messages: first.messages, options: first.options })).toBe(before)
    const second = event("ses_other")
    second.messages = [{ role: "user", content: [{ type: "text", text: "Different request" }] }] as SessionContext["messages"]
    await harnessed.run(second)
    expect(requested).toHaveLength(2)
    expect(JSON.stringify(await harnessed.status())).not.toContain("test-only-key")
    expect(JSON.stringify(await harnessed.status())).not.toContain("interactive debugger")
    const removed = event()
    removed.tools = {}
    await harnessed.run(removed)
    expect(removed.system).toHaveLength(1)
  } finally {
    await cleanup!()
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = originalKey
  }
})

test("disabled plugin does not install a classifier hook", async () => {
  const harnessed = harness({ enabled: false })
  const cleanup = await plugin.setup(harnessed.ctx)
  expect((await harnessed.status() as { enabled: boolean }).enabled).toBe(false)
  await cleanup!()
})
