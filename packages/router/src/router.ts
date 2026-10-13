import { createHash } from "node:crypto"
import type { CatalogTool } from "./catalog"
import { evaluate, type Candidate, type Selection } from "./judge"
import type { Options } from "./options"

export type Route = { selected: string[]; reason: string; durationMs: number; inputTokens: number; outputTokens: number; cached: boolean }
type State = { request: string; recent: unknown[] }
type Dependencies = { key: () => Promise<string>; evaluate?: typeof evaluate; now?: () => number }

export class Router {
  private readonly cache = new Map<string, Promise<Route>>()
  private readonly controller = new AbortController()
  private retryAt = 0
  private readonly now: () => number
  private readonly judge: typeof evaluate

  constructor(private readonly options: Options, private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now
    this.judge = dependencies.evaluate ?? evaluate
  }

  dispose() {
    this.controller.abort()
    this.cache.clear()
  }

  async route(state: State, tools: readonly CatalogTool[], shown: readonly string[] = []): Promise<Route> {
    if (!state.request || tools.length === 0) return empty("no-candidates")
    if (this.now() < this.retryAt) return empty("cooldown")
    const candidates = tools.map((tool) => ({ id: tool.id, description: tool.description.slice(0, 600) }))
    if (JSON.stringify(candidates).length > this.options.maxCatalogChars) return empty("catalog-budget")
    const key = createHash("sha256").update(JSON.stringify({ state, candidates, shown })).digest("hex")
    const previous = this.cache.get(key)
    if (previous) return { ...await previous, cached: true, durationMs: 0, inputTokens: 0, outputTokens: 0 }
    const pending = this.classify(state, candidates, new Set(shown))
    this.cache.set(key, pending)
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
    const result = await pending
    if (result.reason === "unavailable") this.cache.delete(key)
    return result
  }

  private async classify(state: State, candidates: Candidate[], shown: ReadonlySet<string>): Promise<Route> {
    const started = this.now()
    try {
      const selections = await bounded(this.options.timeoutMs, this.controller.signal, async (signal) => {
        const key = await this.dependencies.key()
        // Independent bounded chunks avoid dropping tools from large MCP catalogs.
        const chunks = Array.from({ length: Math.ceil(candidates.length / 254) }, (_, index) => candidates.slice(index * 254, (index + 1) * 254))
        return Promise.all(chunks.map(async (chunk) => ({
          candidates: chunk,
          selection: await this.judge({ state, candidates: chunk, key, model: this.options.model, signal }),
        })))
      })
      const ranked = selections.flatMap(({ candidates, selection }) => rank(selection, candidates, this.options))
        .filter((tool) => !shown.has(tool.id))
        .sort((left, right) => right.weight - left.weight)
      return {
        selected: ranked.slice(0, this.options.maxTools).map((tool) => tool.id),
        reason: ranked.length ? "selected" : "none", durationMs: this.now() - started,
        inputTokens: selections.reduce((total, result) => total + result.selection.inputTokens, 0),
        outputTokens: selections.reduce((total, result) => total + result.selection.outputTokens, 0), cached: false,
      }
    } catch {
      this.retryAt = this.now() + 30_000
      return { ...empty("unavailable"), durationMs: this.now() - started }
    }
  }
}

export function rank(selection: Selection, candidates: readonly Candidate[], options: Options) {
  if (selection.relevance < options.minRelevance) return []
  const none = selection.probabilities.none ?? 1
  return candidates.flatMap(({ id }) => {
    const probability = selection.probabilities[id] ?? 0
    if (probability < options.minProbability || probability <= none) return []
    return [{ id, weight: probability * selection.relevance }]
  })
}

function empty(reason: string): Route {
  return { selected: [], reason, durationMs: 0, inputTokens: 0, outputTokens: 0, cached: false }
}

async function bounded<T>(timeoutMs: number, parent: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const signal = AbortSignal.any([parent, controller.signal])
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let abort: () => void = () => {}
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Router interrupted"))
    if (signal.aborted) return abort()
    signal.addEventListener("abort", abort, { once: true })
  })
  try {
    return await Promise.race([run(signal), interrupted])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", abort)
  }
}
