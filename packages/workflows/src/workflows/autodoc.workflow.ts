import { agent, compute, decision, defineWorkflow } from "../dsl.ts"

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
      prompt: ({ input }) => `Find the already selected plan. Do not devise a new one.

Task: ${String((input as { task?: string }).task ?? "")}
Plan: ${JSON.stringify((input as { plan?: unknown }).plan ?? null)}
Documents: ${JSON.stringify((input as { documents?: string[] }).documents ?? [])}

Return JSON: { "found": true | false, "plan": { "title": "...", "summary": "..." }, "documents": [] }`,
    }),
    route: decision({
      prompt: ({ outputs }) => `Is there a clear selected plan to record? ${JSON.stringify(outputs.find)}`,
      choices: ["write", "blocked"],
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
    { from: "find", to: "route" },
    { from: "route.write", to: "write" },
    { from: "route.blocked", to: "blocked" },
    { from: "write", to: "done" },
  ],
})
