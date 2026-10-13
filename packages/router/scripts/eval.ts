import { parseArgs } from "node:util"
import { createCredential } from "../src/credentials"
import { readOptions } from "../src/options"
import { Router } from "../src/router"
import type { CatalogTool } from "../src/catalog"
import { cases } from "./cases"

const { values } = parseArgs({ options: {
  catalog: { type: "string" }, config: { type: "string" }, output: { type: "string" },
} })
if (!values.catalog) throw new Error("Provide --catalog with the router catalog RPC response")
const response = await Bun.file(values.catalog).json()
const tools: CatalogTool[] = response.output.tools
const config = values.config ? await Bun.file(values.config).json() : {}
const options = readOptions(config.plugins?.find((plugin: { package?: string }) => plugin.package?.includes("router"))?.options ?? {})
const key = createCredential(options.apiKeyCommand)
await key()
const results = []
// Separate routers keep a transient failure in one case from masking all others.
for (const scenario of cases) {
  const router = new Router(options, { key })
  const state = { request: scenario.request, recent: "recent" in scenario ? [...scenario.recent] : [] }
  const route = await router.route(state, tools)
  const passed = scenario.expected.length === 0
    ? route.selected.length === 0 && route.reason === "none"
    : scenario.expected.some((id) => route.selected.includes(id))
  results.push({ name: scenario.name, expected: scenario.expected, passed, ...route })
  console.log(`${passed ? "PASS" : "FAIL"} ${scenario.name}: ${route.selected.join(", ") || route.reason} (${route.durationMs}ms)`)
  router.dispose()
}
const durations = results.map((result) => result.durationMs).sort((a, b) => a - b)
const report = {
  model: options.model, catalogTools: tools.length, cases: results.length,
  passed: results.filter((result) => result.passed).length,
  p50Ms: durations[Math.floor(durations.length * 0.5)], p95Ms: durations[Math.floor(durations.length * 0.95)],
  inputTokens: results.reduce((sum, result) => sum + result.inputTokens, 0),
  outputTokens: results.reduce((sum, result) => sum + result.outputTokens, 0), results,
}
console.log(JSON.stringify({ ...report, results: undefined }, null, 2))
if (values.output) await Bun.write(values.output, `${JSON.stringify(report, null, 2)}\n`)
if (report.passed !== report.cases) process.exitCode = 1
