import { agent, compute, defineWorkflow } from "../dsl.ts"

export default defineWorkflow({
  name: "autoimplement",
  startAt: "find",
  maxSteps: 40,
  exits: {
    ready: { from: "done" },
    blocked: { from: "blocked" },
  },
  nodes: {
    find: agent({
      validate: (output) => typeof output === "object" && output !== null && typeof (output as { found?: unknown }).found === "boolean",
      prompt: ({ input }) => `Find the existing plan. Do not devise a new one.

Task: ${String((input as { task?: string }).task ?? "")}
Plan: ${JSON.stringify((input as { plan?: unknown }).plan ?? null)}
Repository: ${String((input as { repository?: string }).repository ?? ".")}
Scope: ${String((input as { scope?: string }).scope ?? "current repository, no merge or release")}

Return JSON: { "found": true | false, "plan": { "title": "...", "summary": "...", "steps": [] } }`,
    }),
    implement: agent({
      prompt: ({ input, outputs }) => `Implement the given plan end to end in the authorized scope.
Do not take longer than necessary. Open or update a PR if publication is in scope.

Plan: ${JSON.stringify(outputs.find)}
Scope: ${String((input as { scope?: string }).scope ?? "current repository")}
Merge authorized: ${String((input as { merge?: boolean }).merge ?? false)}

Return JSON: { "summary": "...", "files": [], "pr": null | "...", "notes": [] }`,
    }),
    verify: agent({
      validate: (output) => typeof output === "object" && output !== null && typeof (output as { passed?: unknown }).passed === "boolean",
      prompt: ({ outputs }) => `Verify the implementation. Run the relevant tests. State what could not be tested.

Implementation: ${JSON.stringify(outputs.implement)}
Latest fix: ${JSON.stringify(outputs.fix ?? null)}

Return JSON: { "passed": true | false, "commands": [{ "cmd": "...", "ok": true }], "untested": [] }`,
    }),
    fix: agent({
      prompt: ({ outputs }) => `Fix the verification failures. Stay in scope.

Failures: ${JSON.stringify(outputs.verify)}
Implementation: ${JSON.stringify(outputs.implement)}

Return JSON: { "summary": "...", "files": [] }`,
    }),
    done: compute({
      run: ({ outputs }) => ({
        status: "ready",
        implementation: outputs.implement,
        verification: outputs.verify,
      }),
    }),
    blocked: compute({
      run: ({ outputs }) => ({ status: "blocked", find: outputs.find, verify: outputs.verify }),
    }),
  },
  edges: [
    { from: "find", to: "implement", when: ({ output }) => (output as { found?: boolean }).found === true },
    { from: "find", to: "blocked" },
    { from: "implement", to: "verify" },
    { from: "verify", to: "done", when: ({ output }) => (output as { passed?: boolean }).passed === true },
    { from: "verify", to: "fix", when: ({ outputs }) => !outputs.fix },
    { from: "verify", to: "blocked" },
    { from: "fix", to: "verify" },
  ],
})
