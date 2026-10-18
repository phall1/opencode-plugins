import { resolve } from "node:path"
import { Effect } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

export default OpenCodeDriver.use({
  opencode: { command: ["opencode"] },
  project: { git: true, files: { "README.md": "# Isolated workflow UI fixture\n" } },
  config: { plugins: [resolve(".")] },
  tui: { viewport: { cols: 130, rows: 42 } },
}, ({ ui, llm }) => Effect.gen(function* () {
  yield* llm.queue(Llm.text("Ready to inspect workflows."))
  yield* ui.submit("Prepare to inspect workflows.")
  yield* ui.waitFor("Ready to inspect workflows.")
  yield* ui.submit("/workflow-graph")
  yield* ui.waitFor("No workflow running")
  yield* Effect.log(yield* ui.screenshot("workflow-panel"))
  yield* ui.press("escape")
}))
