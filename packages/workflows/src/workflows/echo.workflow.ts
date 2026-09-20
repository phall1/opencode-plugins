import { agent, defineWorkflow } from "../dsl.ts"

/** Runs in this conversation so you can see the step. */
export default defineWorkflow({
  name: "echo",
  startAt: "reply",
  nodes: {
    reply: agent({
      session: "origin",
      output: "assistant",
      prompt: ({ input }) =>
        `Answer concisely: ${String((input as { task?: string }).task ?? "Summarize this repository in one sentence.")}`,
    }),
  },
  edges: [],
})
