export type Options = {
  enabled: boolean
  model: string
  timeoutMs: number
  maxTools: number
  maxContextChars: number
  maxCatalogChars: number
  minRelevance: number
  minProbability: number
  apiKeyCommand?: string[]
}

export function readOptions(value: Record<string, unknown>): Options {
  return {
    enabled: value.enabled !== false,
    model: typeof value.model === "string" ? value.model : "jev-latest",
    timeoutMs: integer(value.timeoutMs, 1500, 100, 10_000),
    maxTools: integer(value.maxTools, 3, 1, 12),
    maxContextChars: integer(value.maxContextChars, 6000, 1000, 20_000),
    maxCatalogChars: integer(value.maxCatalogChars, 64_000, 1000, 200_000),
    minRelevance: probability(value.minRelevance, 0.55),
    minProbability: probability(value.minProbability, 0.2),
    apiKeyCommand: command(value.apiKeyCommand),
  }
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Router option must be an integer between ${min} and ${max}`)
  }
  return value
}

function probability(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Router probability option must be between 0 and 1")
  }
  return value
}

function command(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || !value.every((part) => typeof part === "string" && part.length > 0)) {
    throw new Error("apiKeyCommand must be a non-empty argv array")
  }
  return value as string[]
}
