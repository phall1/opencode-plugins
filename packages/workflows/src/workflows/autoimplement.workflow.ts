import { agent, compute, decision, defineWorkflow } from "../dsl.ts"

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
      prompt: ({ input }) => `Find the existing plan. Do not devise a new one.

Task: ${String((input as { task?: string }).task ?? "")}
Plan: ${JSON.stringify((input as { plan?: unknown }).plan ?? null)}
Repository: ${String((input as { repository?: string }).repository ?? ".")}
Scope: ${String((input as { scope?: string }).scope ?? "current repository, no merge or release")}

Return JSON: { "found": true | false, "plan": { "title": "...", "summary": "...", "steps": [] } }`,
    }),
    route: decision({
      prompt: ({ outputs }) => `Can we implement this plan? ${JSON.stringify(outputs.find)}`,
      choices: ["implement", "blocked"],
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
      prompt: ({ outputs }) => `Verify the implementation. Run the relevant tests. State what could not be tested.

Implementation: ${JSON.stringify(outputs.implement)}

Return JSON: { "passed": true | false, "commands": [{ "cmd": "...", "ok": true }], "untested": [] }`,
    }),
    review: decision({
      prompt: ({ outputs }) => `Did verification pass? ${JSON.stringify(outputs.verify)}`,
      choices: ["pass", "fix", "blocked"],
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
    { from: "find", to: "route" },
    { from: "route.implement", to: "implement" },
    { from: "route.blocked", to: "blocked" },
    { from: "implement", to: "verify" },
    { from: "verify", to: "review" },
    { from: "review.pass", to: "done" },
    { from: "review.fix", to: "fix" },
    { from: "review.blocked", to: "blocked" },
    { from: "fix", to: "verify" },
  ],
})
