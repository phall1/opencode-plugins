import { compute, defineWorkflow } from "../src/dsl.ts"

type EchoInput = {
  task?: string
}

export default defineWorkflow({
  name: "echo",
  startAt: "reply",
  nodes: {
    reply: compute({
      run: ({ input }) => {
        const task = (input as EchoInput).task ?? "hello"
        return { reply: task }
      },
    }),
  },
  edges: [],
})
