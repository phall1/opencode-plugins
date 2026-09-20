import { compute, defineWorkflow, includeWorkflow } from "../dsl.ts"
import autodoc from "./autodoc.workflow.ts"
import autoimplement from "./autoimplement.workflow.ts"
import autoplan from "./autoplan.workflow.ts"

export default defineWorkflow({
  name: "ship",
  startAt: "start",
  maxSteps: 80,
  includes: {
    autoplan: includeWorkflow(autoplan, {
      input: ({ input }) => input,
    }),
    autodoc: includeWorkflow(autodoc, {
      input: ({ input, outputs }) => ({
        ...(input as object),
        plan: (outputs.autoplan as { outputs?: unknown })?.outputs ?? outputs.autoplan,
      }),
    }),
    autoimplement: includeWorkflow(autoimplement, {
      input: ({ input, outputs }) => ({
        ...(input as object),
        plan: (outputs.autoplan as { outputs?: unknown })?.outputs ?? outputs.autoplan,
      }),
    }),
  },
  nodes: {
    start: compute({
      run: ({ input }) => ({ task: (input as { task?: string }).task ?? "" }),
    }),
    done: compute({
      run: ({ outputs }) => ({
        status: "ready",
        plan: outputs.autoplan,
        docs: outputs.autodoc,
        implementation: outputs.autoimplement,
      }),
    }),
    blocked: compute({
      run: ({ outputs }) => ({
        status: "blocked",
        plan: outputs.autoplan,
        docs: outputs.autodoc,
        implementation: outputs.autoimplement,
      }),
    }),
  },
  edges: [
    { from: "start", to: "autoplan" },
    { from: "autoplan.ready", to: "autodoc" },
    { from: "autoplan.blocked", to: "blocked" },
    { from: "autodoc.ready", to: "autoimplement" },
    { from: "autodoc.blocked", to: "blocked" },
    { from: "autoimplement.ready", to: "done" },
    { from: "autoimplement.blocked", to: "blocked" },
  ],
})
