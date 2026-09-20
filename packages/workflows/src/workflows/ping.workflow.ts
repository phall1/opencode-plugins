import { compute, defineWorkflow } from "../dsl.ts"

/** Completes immediately. Use this to see a finished run. */
export default defineWorkflow({
  name: "ping",
  startAt: "pong",
  nodes: {
    pong: compute({
      run: ({ input }) => ({
        ok: true,
        echo: String((input as { task?: string }).task ?? "pong"),
      }),
    }),
  },
  edges: [],
})
