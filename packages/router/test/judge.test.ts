import { describe, expect, test } from "bun:test"
import { evaluate, parseSelection, questions } from "../src/judge"
import { readOptions } from "../src/options"
import { createCredential } from "../src/credentials"

const candidates = [{ id: "phux_panes", description: "Discover pane identities" }]
const valid = () => ({ answers: { needed: { type: "noul", noul: 0.9 }, tool: { type: "choice", choice: "phux_panes", probabilities: { none: 0.1, phux_panes: 0.9 } } }, usage: { input_tokens: 40, output_tokens: 10 } })

describe("Jev boundary", () => {
  test("closed-set selection has an explicit no-match option", () => {
    expect(questions(candidates).tool.criteria).toHaveProperty("none")
    expect(parseSelection(valid(), candidates)).toEqual({ relevance: 0.9, probabilities: { none: 0.1, phux_panes: 0.9 }, inputTokens: 40, outputTokens: 10 })
  })

  test("rejects missing, invented, incomplete and invalid judgments", () => {
    for (const value of [null, {}, { answers: {} }]) expect(() => parseSelection(value, candidates)).toThrow()
    for (const probabilities of [{ none: 0.1, invented: 0.9 }, { phux_panes: 1 }, { none: 0, phux_panes: NaN }, { none: 0, phux_panes: 0.1 }]) {
      const body = valid()
      body.answers.tool.probabilities = probabilities as never
      expect(() => parseSelection(body, candidates)).toThrow()
    }
    const body = valid()
    body.answers.tool.type = "noul"
    expect(() => parseSelection(body, candidates)).toThrow()
    body.answers.tool.type = "choice"
    body.answers.tool.choice = "invented"
    expect(() => parseSelection(body, candidates)).toThrow()
  })

  test("sends credentials only to the fixed TypeSafe endpoint", async () => {
    let request: Request | undefined
    const mockFetch = async (url: string, init: RequestInit) => {
      request = new Request(url as string, init)
      return Response.json(valid())
    }
    await evaluate({ state: { request: "what panes are open?" }, candidates, key: "secret", model: "jev-latest", signal: AbortSignal.timeout(1000), fetch: mockFetch })
    expect(request!.url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(request!.headers.get("authorization")).toBe("Bearer secret")
    expect((await request!.json()).questions.tool.criteria).toHaveProperty("none")
  })

  test("does not leak error response bodies", async () => {
    const mockFetch = async () => new Response("sensitive prompt and key", { status: 401 })
    await expect(evaluate({ state: "secret", candidates, key: "secret", model: "jev-latest", signal: AbortSignal.timeout(1000), fetch: mockFetch })).rejects.toThrow("Router Jev HTTP 401")
  })

  test("limits API option count", async () => {
    await expect(evaluate({ state: "", candidates: Array.from({ length: 255 }, (_, i) => ({ id: String(i), description: "" })), key: "", model: "jev-latest", signal: AbortSignal.timeout(1000) })).rejects.toThrow("255 options")
  })
})

describe("configuration and credentials", () => {
  test("uses bounded defaults and rejects invalid budgets", () => {
    expect(readOptions({}).maxTools).toBe(3)
    for (const options of [{ timeoutMs: 0 }, { maxTools: 20 }, { minProbability: NaN }, { apiKeyCommand: "echo secret" }]) {
      expect(() => readOptions(options)).toThrow()
    }
  })

  test("environment wins without running a command", async () => {
    expect(await createCredential(["missing-command"], { TYPESAFE_API_KEY: "env-key" })()).toBe("env-key")
  })

  test("command is cached, errors are redacted, absent key is recoverable", async () => {
    const get = createCredential(["/bin/sh", "-c", "printf command-key"], {})
    const first = get()
    expect(get()).toBe(first)
    expect(await first).toBe("command-key")
    await expect(createCredential(["/bin/sh", "-c", "echo SECRET >&2; exit 1"], {})()).rejects.toThrow("Router credential unavailable")
    const environment: NodeJS.ProcessEnv = {}
    const missing = createCredential(undefined, environment)
    await expect(missing()).rejects.toThrow()
    environment.TYPESAFE_API_KEY = "now-available"
    expect(await missing()).toBe("now-available")
  })

  test("credential TTL is fixed, not extended by requests; rotation refreshes it", async () => {
    let now = 0
    const command = ["/bin/sh", "-c", "printf first-key"]
    const get = createCredential(command, {}, () => now)
    expect(await get()).toBe("first-key")
    command[2] = "printf rotated-key"
    now = 299_999
    expect(await get()).toBe("first-key")
    now = 300_000
    expect(await get()).toBe("rotated-key")
  })
})
