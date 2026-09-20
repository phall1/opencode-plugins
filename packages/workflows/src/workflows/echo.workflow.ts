import { agent, defineWorkflow } from "../dsl.ts"

export default defineWorkflow({
  name: "echo",
  startAt: "reply",
  nodes: {
    reply: agent({
      prompt: ({ input }) =>
        `Answer concisely: ${String((input as { task?: string }).task ?? "Summarize this repository in one sentence.")}`,
    }),
  },
  edges: [],
})
