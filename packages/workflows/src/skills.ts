export type BundledSkill = {
  id: string
  name: string
  description: string
  content: string
}

const kickoff = `Call the \`workflow\` tool with action \`start\` once, complete input, then **end the turn**. Do not wait. Do not do the graph's work in this conversation. Child sessions run the steps.`

export const bundledSkills: readonly BundledSkill[] = [
  {
    id: "workflows",
    name: "workflows",
    description:
      "Kick off a workflow from natural language, author a .workflow.ts graph, or control a run. Use when the task is multi-step routing, planning, implementing, documenting, monitoring, or a sanity check — not only when the user types /workflow.",
    content: `# Workflows

From ordinary chat, start a graph instead of doing the multi-step work yourself.

${kickoff}

- \`list\` — names
- \`start\` — name plus complete \`task\`. Once.
- \`status\` / \`cancel\` — only if asked
- \`submit\` — only in a child session titled \`workflow:<node>\`
- \`answer\` — checkpoint

Author: \`.opencode/workflows/<name>.workflow.ts\` or \`~/.config/opencode/workflows/\`. Default-export \`defineWorkflow\`. \`compute\` is code. \`agent\` is a child turn. \`decision\` is an edge. \`session: "origin"\` only to read this chat.
`,
  },
  {
    id: "autoplan",
    name: "autoplan",
    description:
      "User wants a plan, options compared, or a decision about what to build. Start autoplan even if they never said the word autoplan.",
    content: `# Autoplan

${kickoff}

Workflow name: \`autoplan\`. Pass \`task\` (the decision and end state), optional \`scope\`, optional \`constraints\` array.

Do not implement in this turn.
`,
  },
  {
    id: "autodoc",
    name: "autodoc",
    description:
      "User wants an existing plan recorded in canonical docs. Start autodoc; do not write the docs in this chat.",
    content: `# Autodoc

${kickoff}

Workflow name: \`autodoc\`. Pass the selected plan. If none exists, start \`autoplan\` instead.
`,
  },
  {
    id: "autoimplement",
    name: "autoimplement",
    description:
      "User wants an existing plan implemented, built, shipped, or turned into a PR. Start autoimplement; do not implement here.",
    content: `# Autoimplement

${kickoff}

Workflow name: \`autoimplement\`. Pass the plan, repo path, and scope. Do not invent the plan.
`,
  },
  {
    id: "sanity-check",
    name: "sanity-check",
    description:
      "User wants a keep/drop/simplify review of a change. Start sanity-check; do not review in this chat.",
    content: `# Sanity Check

${kickoff}

Workflow name: \`sanity-check\`. Read-only. Returns keep, simplify, refactor, drop, or needs_evidence.
`,
  },
  {
    id: "monitor",
    name: "monitor",
    description:
      "User wants something watched, polled, or acted on when work appears. Start monitor; do not sit in a loop here.",
    content: `# Monitor

${kickoff}

Workflow name: \`monitor\`. Pass \`task\`, optional \`stopWhen\`, optional \`everyMinutes\` (default 30). Grants no new authority.
`,
  },
]
