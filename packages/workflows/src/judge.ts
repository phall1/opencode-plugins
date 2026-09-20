import { Effect } from "effect"

export type Judgment = {
  choice: string
  confidence: number
  probabilities: Record<string, number>
  source: "jev" | "generate"
}

type ChoiceAnswer = {
  type: "choice"
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export const judgeChoice = (input: {
  prompt: string
  choices: readonly string[]
  state?: unknown
  apiKey?: string
  model?: string
}): Effect.Effect<Judgment, Error> => {
  const key = input.apiKey ?? process.env.TYPESAFE_API_KEY
  if (!key) {
    return Effect.fail(new Error("TYPESAFE_API_KEY is not set"))
  }
  const criteria = Object.fromEntries(input.choices.map((choice) => [choice, null]))
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model ?? "jev-latest",
          state: input.state ?? { prompt: input.prompt },
          questions: {
            route: {
              type: "choice",
              instructions: input.prompt,
              criteria,
            },
          },
        }),
      })
      if (!response.ok) {
        throw new Error(`Jev HTTP ${response.status}: ${await response.text()}`)
      }
      const body = (await response.json()) as { answers?: { route?: ChoiceAnswer } }
      const answer = body.answers?.route
      if (!answer || answer.type !== "choice" || !input.choices.includes(answer.choice)) {
        throw new Error("Jev did not return a valid choice")
      }
      return {
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        source: "jev" as const,
      }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

export function applyConfidence(judgment: Judgment, minConfidence?: number): Judgment {
  if (minConfidence === undefined || judgment.confidence >= minConfidence) return judgment
  return { ...judgment, choice: "uncertain" }
}
