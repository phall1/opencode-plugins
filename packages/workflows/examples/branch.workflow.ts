import { compute, decision, defineWorkflow } from "../src/dsl.ts"

export default defineWorkflow({
  name: "branch",
  startAt: "classify",
  nodes: {
    classify: decision({
      prompt: ({ input }) => `Is this a greeting? ${String((input as { task?: string }).task ?? "")}`,
      choices: ["greet", "other"],
    }),
    greet: compute({
      run: () => ({ reply: "hello" }),
    }),
    other: compute({
      run: ({ input }) => ({ reply: (input as { task?: string }).task ?? "ok" }),
    }),
  },
  edges: [
    { from: "classify.greet", to: "greet" },
    { from: "classify.other", to: "other" },
  ],
})
