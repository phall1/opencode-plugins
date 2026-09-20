import { agent, compute, decision, defineWorkflow } from "../dsl.ts"

export default defineWorkflow({
  name: "sanity-check",
  startAt: "evidence",
  maxSteps: 12,
  exits: {
    ready: { from: "report" },
  },
  nodes: {
    evidence: agent({
      prompt: ({ input }) => `Collect read-only evidence for the current contribution.
Base: ${String((input as { baseRef?: string }).baseRef ?? "origin/main")}
Mode: ${String((input as { mode?: string }).mode ?? "serial")}

Use git diff, status, and PR metadata if available. Do not edit.

Return JSON: { "baseRef": "...", "summary": "...", "files": [], "intent": "..." }`,
    }),
    review: agent({
      prompt: ({ outputs }) => `Review necessity, duplication, contracts, and scope/tests.
Cite exact files and symbols. Give the strongest case for accepting the current design.

Evidence: ${JSON.stringify(outputs.evidence)}

Return JSON: { "necessity": "...", "duplication": "...", "contracts": "...", "scope": "...", "acceptCase": "..." }`,
    }),
    verdict: decision({
      prompt: ({ outputs }) => `Verified verdict from this review: ${JSON.stringify(outputs.review)}`,
      choices: ["keep", "simplify", "refactor", "drop", "needs_evidence"],
    }),
    report: agent({
      output: "assistant",
      prompt: ({ outputs }) => `Write the full detailed report, then a short plain-language summary.
Verdict: ${JSON.stringify(outputs.verdict)}
Review: ${JSON.stringify(outputs.review)}
Stay read-only. Do not implement.`,
    }),
    done: compute({
      run: ({ outputs }) => ({ status: "ready", verdict: outputs.verdict, review: outputs.review }),
    }),
  },
  edges: [
    { from: "evidence", to: "review" },
    { from: "review", to: "verdict" },
    { from: "verdict", to: "report" },
    { from: "report", to: "done" },
  ],
})
