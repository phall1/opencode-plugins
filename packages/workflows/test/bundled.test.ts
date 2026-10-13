import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { readdir } from "node:fs/promises"
import { builtinWorkflowDir, loadWorkflow } from "../src/discover.ts"
import { validateWorkflow } from "../src/dsl.ts"
import { runWorkflow, type WorkflowHost } from "../src/engine.ts"
import autoimplement from "../src/workflows/autoimplement.workflow.ts"
import ship from "../src/workflows/ship.workflow.ts"

describe("bundled workflows", () => {
  test("all graphs load and pass structural validation", async () => {
    const dir = builtinWorkflowDir()
    const files = (await readdir(dir)).filter((file) => file.endsWith(".workflow.ts"))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const workflow = await loadWorkflow(`${dir}/${file}`)
      expect(workflow?.name).toBeTruthy()
      validateWorkflow(workflow!)
    }
  })

  test("implement does not report ready after failed verification", async () => {
    let verified = 0
    const host: WorkflowHost = {
      runAgent: ({ nodeId }) => Effect.succeed(nodeId === "find" ? { found: true, plan: { title: "test" } } : nodeId === "verify" ? { passed: false, attempt: ++verified } : { summary: "worked" }),
      runDecision: () => Effect.die("unexpected decision"),
      checkpoint: () => Effect.die("unexpected checkpoint"),
      wait: () => Effect.void,
    }
    const result = await Effect.runPromise(runWorkflow({ workflow: autoimplement, input: { task: "test" }, host }))
    expect(result.status).toBe("done")
    expect((result.outputs.blocked as { status: string }).status).toBe("blocked")
    expect(verified).toBe(2)
  })

  test("ship passes only the selected plan to downstream workflows", () => {
    const autoplan = ship.includes!.autoplan!.workflow
    const parentOutput = { outputs: { capture: { task: "test" }, plan: { title: "selected", steps: [{ title: "do it" }] } } }
    const ctx = { input: { task: "test" }, outputs: { autoplan: parentOutput } }
    expect(ship.includes!.autodoc!.input(ctx)).toMatchObject({ plan: parentOutput.outputs.plan })
    expect(ship.includes!.autoimplement!.input(ctx)).toMatchObject({ plan: parentOutput.outputs.plan })
    expect(autoplan.name).toBe("autoplan")
  })
})
