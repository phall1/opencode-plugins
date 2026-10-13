import type { Plugin } from "@opencode/plugin"
import { alreadyShown, availableTools, catalog, renderTools, requestCatalog } from "./catalog"
import { routingState } from "./context"
import { createCredential } from "./credentials"
import { readOptions } from "./options"
import { Router, type Route } from "./router"

export const RouterRpc = {
  id: "phall.router",
  methods: {
    status: { input: { type: "object" }, output: { type: "object" } },
    catalog: { input: { type: "object" }, output: { type: "object" } },
  },
  events: {},
} as const

export default {
  id: "phall.router",
  async setup(ctx) {
    const options = readOptions(ctx.options)
    const router = new Router(options, { key: createCredential(options.apiKeyCommand) })
    const sessions = new Map<string, Route>()
    const counters = createCounters()
    await ctx.rpc.register(RouterRpc, {
      status: async () => ({ enabled: options.enabled, model: options.model, counters, sessions: Object.fromEntries(sessions) }),
      catalog: async () => ({ tools: catalog(await ctx.tool.list()) }),
    })
    if (!options.enabled) return () => router.dispose()
    await ctx.session.hook("context", async (event) => {
      if (!event.tools.execute) return
      try {
        const texts = [
          ...event.system.map((part) => part.text),
          ...event.messages.filter((message) => message.role === "system").flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text)),
        ]
        const native = requestCatalog(texts)
        // Registry reads are not session-filtered. Only consider namespaces the
        // host actually advertises in this request; execution still checks permission.
        if (!native) return
        const tools = availableTools(await ctx.tool.list(), native)
        if (tools.every((tool) => alreadyShown(tool, native))) return
        const state = routingState(event.messages, options.maxContextChars)
        const shown = tools.filter((tool) => alreadyShown(tool, native)).map((tool) => tool.id)
        const result = await router.route(state, tools, shown)
        recordRoute(counters, result)
        sessions.set(event.sessionID, result)
        if (sessions.size > 64) sessions.delete(sessions.keys().next().value!)
        const selected = result.selected.flatMap((id) => tools.filter((tool) => tool.id === id && !alreadyShown(tool, native)))
        const text = renderTools(selected, options.maxContextChars)
        if (text) {
          event.system.push({ type: "text", text })
          counters.injectedChars += text.length
        }
      } catch {
        // Discovery cannot break the agent loop, remove tools, or approve actions.
        counters.unavailable++
      }
    })
    return () => {
      router.dispose()
      sessions.clear()
    }
  },
} satisfies Plugin.Plugin

function createCounters() {
  return { requests: 0, selected: 0, none: 0, unavailable: 0, cached: 0, inputTokens: 0, outputTokens: 0, injectedChars: 0, durationMs: 0 }
}

function recordRoute(counters: ReturnType<typeof createCounters>, route: Route) {
  counters.requests++
  counters.inputTokens += route.inputTokens
  counters.outputTokens += route.outputTokens
  counters.durationMs += route.durationMs
  if (route.cached) counters.cached++
  if (route.reason === "selected") counters.selected++
  if (route.reason === "none") counters.none++
  if (route.reason === "unavailable") counters.unavailable++
}
