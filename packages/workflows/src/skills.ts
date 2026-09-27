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
      "Use only when the user explicitly requests a workflow, names a workflow, or asks to author or manage one. Ordinary planning, coding and reviews should stay in the current conversation.",
    content: `# Workflows

Start a graph only when the user specifically asks for one. Never replace an ordinary coding, planning, review or documentation request with a workflow. Before starting, tell the user the workflow name and that it will work in background sessions; then call the workflow tool once.

- \`list\` — names
- \`start\` — name plus complete \`task\`. Once.
- \`status\` / \`cancel\` — only if asked
- \`submit\` — only in a child session titled \`workflow:<node>\`
- \`answer\` — checkpoint

Author: \`.opencode/workflows/<name>.workflow.ts\` or \`~/.config/opencode/workflows/\`. Default-export \`defineWorkflow\`. \`compute\` is code. \`agent\` is a child turn. \`decision\` is an edge. \`session: "origin"\` only to read this chat.
`,
  },
]
