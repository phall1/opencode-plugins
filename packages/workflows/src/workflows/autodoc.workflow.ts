import { agent, compute, defineWorkflow } from "../dsl.ts"

export default defineWorkflow({
  name: "autodoc",
  startAt: "find",
  maxSteps: 12,
  exits: {
    ready: { from: "done" },
    blocked: { from: "blocked" },
  },
  nodes: {
    find: agent({
      validate: (output) => typeof output === "object" && output !== null && typeof (output as { found?: unknown }).found === "boolean",
      prompt: ({ input }) => `Find the already selected plan. Do not devise a new one.

Task: ${String((input as { task?: string }).task ?? "")}
Plan: ${JSON.stringify((input as { plan?: unknown }).plan ?? null)}
Documents: ${JSON.stringify((input as { documents?: string[] }).documents ?? [])}

Return JSON: { "found": true | false, "plan": { "title": "...", "summary": "..." }, "documents": [] }`,
    }),
    write: agent({
      prompt: ({ input, outputs }) => `Record the selected plan in canonical documentation. Do not implement.

Repository: ${String((input as { repository?: string }).repository ?? ".")}
Plan: ${JSON.stringify(outputs.find)}

Create or update the plan document. Return JSON: { "path": "...", "changed": true | false, "summary": "..." }`,
    }),
    done: compute({
      run: ({ outputs }) => ({ status: "ready", documentation: outputs.write, plan: outputs.find }),
    }),
    blocked: compute({
      run: ({ outputs }) => ({ status: "blocked", reason: "No clear selected plan", find: outputs.find }),
    }),
  },
  edges: [
    { from: "find", to: "write", when: ({ output }) => (output as { found?: boolean }).found === true },
    { from: "find", to: "blocked" },
    { from: "write", to: "done" },
  ],
})
