import { agent, compute, decision, defineWorkflow, wait } from "../dsl.ts"

const minutesOf = (input: unknown) => {
  const value = (input as { everyMinutes?: number }).everyMinutes
  return typeof value === "number" && value > 0 ? value : 30
}

export default defineWorkflow({
  name: "monitor",
  startAt: "observe",
  maxSteps: 80,
  exits: {
    ready: { from: "stop" },
  },
  nodes: {
    observe: agent({
      prompt: ({ input, outputs }) => `Observe the target. Monitoring does not grant new authority.

Task: ${String((input as { task?: string }).task ?? "")}
Stop when: ${String((input as { stopWhen?: string }).stopWhen ?? "explicit user stop")}
Last action: ${JSON.stringify(outputs.act ?? null)}

Return JSON: { "route": "wait" | "act" | "stop", "report": "Monitor: ...", "reason": "..." }`,
    }),
    route: decision({
      prompt: ({ outputs }) => `Choose the monitor route. ${JSON.stringify(outputs.observe)}`,
      choices: ["wait", "act", "stop"],
    }),
    act: agent({
      prompt: ({ input, outputs }) => `Perform only the one safe authorized action from the observation.
Do not broaden scope.

Task: ${String((input as { task?: string }).task ?? "")}
Observation: ${JSON.stringify(outputs.observe)}

Return JSON: { "kind": "advance" | "recover" | "repair", "summary": "...", "blocked": false }`,
    }),
    pause: wait({
      ms: ({ input }) => minutesOf(input) * 60_000,
    }),
    stop: compute({
      run: ({ outputs }) => ({ status: "ready", observation: outputs.observe }),
    }),
  },
  edges: [
    { from: "observe", to: "route" },
    { from: "route.wait", to: "pause" },
    { from: "route.act", to: "act" },
    { from: "route.stop", to: "stop" },
    { from: "pause", to: "observe" },
    { from: "act", to: "observe" },
  ],
})
