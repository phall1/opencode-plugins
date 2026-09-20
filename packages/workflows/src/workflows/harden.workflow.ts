import { agent, compute, decision, defineWorkflow } from "../dsl.ts"

/** Dogfood the plugin: observe a UX/engine bug, Jev-route, fix, verify. */
export default defineWorkflow({
  name: "harden",
  startAt: "observe",
  maxSteps: 16,
  exits: {
    ready: { from: "done" },
    blocked: { from: "blocked" },
  },
  nodes: {
    observe: agent({
      session: "origin",
      prompt: ({ input }) => `Inspect this OpenCode workflows plugin and name ONE concrete defect to fix now.

Task: ${String((input as { task?: string }).task ?? "Fix the worst current UX or engine bug.")}

Look at packages/workflows (TUI slash, RPC location, panel close, decision host).
Return JSON: { "defect": "...", "file": "...", "whyNow": "..." }`,
    }),
    route: decision({
      prompt: ({ outputs }) =>
        `Given this defect, what should happen next? ${JSON.stringify(outputs.observe)}`,
      choices: ["fix", "blocked"],
      minConfidence: 0.65,
    }),
    fix: agent({
      prompt: ({ outputs }) => `Implement exactly this defect. Do not expand scope.

Defect: ${JSON.stringify(outputs.observe)}

Return JSON: { "changed": [], "summary": "..." }`,
    }),
    verify: agent({
      prompt: ({ outputs }) => `Verify the fix. Run the package tests if relevant.

Fix: ${JSON.stringify(outputs.fix)}
Defect: ${JSON.stringify(outputs.observe)}

Return JSON: { "passed": true | false, "notes": [] }`,
    }),
    done: compute({
      run: ({ outputs }) => ({ status: "ready", observe: outputs.observe, fix: outputs.fix, verify: outputs.verify }),
    }),
    blocked: compute({
      run: ({ outputs }) => ({ status: "blocked", observe: outputs.observe, route: outputs.route }),
    }),
  },
  edges: [
    { from: "observe", to: "route" },
    { from: "route.fix", to: "fix" },
    { from: "route.blocked", to: "blocked" },
    { from: "route.uncertain", to: "blocked" },
    { from: "fix", to: "verify" },
    { from: "verify", to: "done" },
  ],
})
