import { agent, compute, defineWorkflow } from "../dsl.ts"
import { fileURLToPath } from "node:url"

const PLUGIN = fileURLToPath(new URL("../..", import.meta.url))

/** Install this plugin into live OpenCode config and the chezmoi source copy. */
export default defineWorkflow({
  name: "wire",
  startAt: "apply",
  maxSteps: 8,
  exits: { ready: { from: "done" } },
  nodes: {
    apply: agent({
      output: "assistant",
      prompt: ({ input }) => `Install OpenCode workflows globally. Do the edits. Do not inspect-and-stop.

Task: ${String((input as { task?: string }).task ?? "Add the plugin to live and chezmoi source.")}

Plugin entry: ${PLUGIN}

1. Add that string to plugins in ~/.config/opencode/opencode.jsonc if missing. Keep every other plugin.
2. Add the same string to ~/dotfiles/dot_config/opencode/opencode.jsonc if missing.
3. If chezmoi is in use, preview the diff before applying; do not overwrite unrelated live extras.
4. Reply with two short lines: what you changed, and that /workflow ping hi should work after a TUI reload.`,
    }),
    done: compute({
      run: ({ outputs }) => ({ status: "ready", apply: outputs.apply }),
    }),
  },
  edges: [{ from: "apply", to: "done" }],
})
