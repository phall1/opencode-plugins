export type BundledSkill = {
  id: string
  name: string
  description: string
  content: string
}

export const bundledSkills: readonly BundledSkill[] = [
  {
    id: "workflows",
    name: "workflows",
    description:
      "Operate or author OpenCode workflows: list, start, status, cancel, answer, submit, and compose graphs.",
    content: `# Workflows

Use a workflow for multi-step work that needs explicit routing. Keep one-turn work outside a workflow.

The \`workflow\` tool is the authority for call shapes.

- \`list\` — discovered workflow names
- \`start\` — name plus complete input. Call once, then end the turn.
- \`status\` / \`cancel\` — active run, or \`runId\`
- \`submit\` — structured output for the current agent step
- \`answer\` — ordinary checkpoint. Do not answer a protected human gate.

After start, wait for the next step contract. When an agent step arrives, do the work, then submit or reply as the contract says.

Author graphs with \`defineWorkflow\`, \`agent\`, \`compute\`, \`decision\`, \`checkpoint\`, \`wait\`, and \`includeWorkflow\` from \`@phall1/opencode-workflows/dsl\`.
`,
  },
  {
    id: "autoplan",
    name: "autoplan",
    description:
      "Select the best practical in-scope solution and write an implementation plan. Use when the user asks to run autoplan.",
    content: `# Autoplan

Start the built-in \`autoplan\` workflow once with complete input:

- \`task\` / \`problem\` — the decision and observable end state
- \`scope\` — repositories and interfaces that may change
- \`constraints\` — array, empty if none

Then end the turn. Do not implement unless the user also asked for implementation.

The graph captures user intent, records 2–4 practical candidates plus the ideal, chooses without asking the user, writes a detailed plan, and shows a short assistant summary.
`,
  },
  {
    id: "autodoc",
    name: "autodoc",
    description: "Record an existing selected plan in canonical docs. Use when the user asks to run autodoc.",
    content: `# Autodoc

Start \`autodoc\` once. Pass the selected plan. Autodoc does not devise or implement. If no plan exists, stop and use autoplan.
`,
  },
  {
    id: "autoimplement",
    name: "autoimplement",
    description:
      "Implement an existing plan, verify it, and open or update a PR. Use when the user asks to run autoimplement.",
    content: `# Autoimplement

Start \`autoimplement\` once with the existing plan, repository path, and scope. Do not devise an initial plan. If evidence invalidates the plan, the graph can return to planning; do not start a second workflow yourself.
`,
  },
  {
    id: "sanity-check",
    name: "sanity-check",
    description:
      "Read-only review of whether a contribution is necessary, focused, and well supported. Use when the user asks for a sanity check.",
    content: `# Sanity Check

Start \`sanity-check\` once. It is read-only. It returns keep, simplify, refactor, drop, or needs_evidence.
`,
  },
  {
    id: "monitor",
    name: "monitor",
    description:
      "Watch a goal, act when authorized work is available, wait otherwise. Use when the user asks to monitor or watch something.",
    content: `# Monitor

Start \`monitor\` once with \`task\`, optional \`stopWhen\`, optional \`everyMinutes\` (default 30), optional \`maxChecks\`. Monitoring does not grant new authority.
`,
  },
]
