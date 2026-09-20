import { agent, compute, defineWorkflow } from "../dsl.ts"

const taskOf = (input: unknown) => {
  const value = input as { task?: string; problem?: string }
  return value.problem ?? value.task ?? "Plan the current request."
}

export default defineWorkflow({
  name: "autoplan",
  startAt: "capture",
  maxSteps: 20,
  exits: {
    ready: { from: "summary" },
    blocked: { from: "blocked" },
  },
  nodes: {
    capture: agent({
      session: "origin",
      prompt: ({ input }) => `Capture the user's complete intended purpose from this conversation.

Problem: ${taskOf(input)}
Scope: ${String((input as { scope?: string }).scope ?? "the current repository")}
Constraints: ${JSON.stringify((input as { constraints?: string[] }).constraints ?? [])}

Return JSON:
{ "originalUserInstructions": "verbatim user intent, wording preserved", "problem": "...", "scope": "...", "constraints": [] }`,
    }),
    candidates: agent({
      session: "origin",
      prompt: ({ outputs }) => `Record two through four distinct practical candidates, then describe the Holy grail separately.

Context: ${JSON.stringify(outputs.capture)}

Return JSON:
{ "candidates": [{ "id": "a", "title": "...", "gist": "...", "solution": "...", "tradeoffs": "..." }], "holyGrail": { "title": "...", "gist": "...", "outsideAuthority": [] } }`,
    }),
    choose: agent({
      session: "origin",
      prompt: ({ outputs }) => `Choose the best practical in-scope option without asking the user.
Choose the Holy grail only when it is proportionate, production-ready, and implementable through interfaces we control.
Record one rejection reason for every other option.

Capture: ${JSON.stringify(outputs.capture)}
Options: ${JSON.stringify(outputs.candidates)}

Return JSON:
{ "selectedId": "...", "reason": "...", "rejections": [{ "id": "...", "reason": "..." }] }`,
    }),
    plan: agent({
      session: "origin",
      prompt: ({ outputs }) => `Write a detailed implementation plan for the selected option.
For each step: what changes, where, and how to verify.

Selection: ${JSON.stringify(outputs.choose)}
Candidates: ${JSON.stringify(outputs.candidates)}
Intent: ${JSON.stringify(outputs.capture)}

Return JSON:
{ "title": "...", "summary": "...", "steps": [{ "title": "...", "change": "...", "verify": "..." }], "verification": [] }`,
    }),
    summary: agent({
      session: "origin",
      output: "assistant",
      prompt: ({ outputs }) => `Write one short assistant message with:
- the selected plan and its main steps
- a one-line gist and rejection reason for every other candidate

Do not implement. Plan: ${JSON.stringify(outputs.plan)} Choice: ${JSON.stringify(outputs.choose)}`,
    }),
    blocked: compute({
      run: ({ outputs }) => ({ status: "blocked", capture: outputs.capture }),
    }),
  },
  edges: [
    { from: "capture", to: "candidates" },
    { from: "candidates", to: "choose" },
    { from: "choose", to: "plan" },
    { from: "plan", to: "summary" },
  ],
})
