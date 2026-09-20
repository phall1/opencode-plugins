import { agent, compute, defineWorkflow } from "../dsl.ts"

const PLUGIN = "~/workspace/opencode-plugins/packages/workflows"

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
3. Do not chezmoi apply that file — it is history-ignored so live extras survive.
4. Reply with two short lines: what you changed, and that /workflow ping hi should work after a TUI reload.`,
    }),
    done: compute({
      run: ({ outputs }) => ({ status: "ready", apply: outputs.apply }),
    }),
  },
  edges: [{ from: "apply", to: "done" }],
})
