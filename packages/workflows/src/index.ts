import { Plugin, Skill } from "@opencode/plugin/effect"
import { Deferred, Effect, Fiber, Ref, Schema } from "effect"
import { handleCommand, handleTool, summaries } from "./commands.ts"
import { discoverWorkflows } from "./discover.ts"
import type { Workflow } from "./dsl.ts"
import type { RunSnapshot } from "./engine.ts"
import { RunRegistry } from "./registry.ts"
import { Workflows } from "./rpc.ts"
import { cancelRun, startRun } from "./runner.ts"
import { bundledSkills } from "./skills.ts"

export {
  agent,
  checkpoint,
  compute,
  decision,
  defineWorkflow,
  includeWorkflow,
  wait,
} from "./dsl.ts"
export type { Edge, Workflow, WorkflowNode } from "./dsl.ts"
export { Workflows } from "./rpc.ts"

const registry = new RunRegistry()

const ToolInput = Schema.Struct({
  action: Schema.Literals(["list", "start", "status", "cancel", "submit", "answer"]),
  name: Schema.optional(Schema.String),
  task: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
  value: Schema.optional(Schema.Unknown),
})

export default Plugin.define({
  id: "phall.workflows",
  effect: (ctx) =>
    Effect.gen(function* () {
      const workflows = yield* Ref.make<Workflow[]>([])
      const reload = Effect.tryPromise({
        try: () => discoverWorkflows(ctx.location.directory),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(Effect.tap((found) => Ref.set(workflows, found)))

      yield* reload

      const emitRef = yield* Ref.make<(run: RunSnapshot) => Effect.Effect<void>>(() => Effect.void)
      const emit = (run: RunSnapshot) => Effect.flatMap(Ref.get(emitRef), (fn) => fn(run))
      const launch = (workflow: Workflow, input: unknown, originSessionID?: string) =>
        startRun({ workflow, input, ctx, registry, originSessionID, emit })

      const rpc = yield* ctx.rpc.register(Workflows, {
        list: () =>
          reload.pipe(
            Effect.orDie,
            Effect.flatMap(() => Ref.get(workflows)),
            Effect.map((found) => ({ workflows: summaries(found) })),
          ),
        start: (input, context) =>
          Effect.gen(function* () {
            yield* reload.pipe(Effect.orDie)
            const found = yield* Ref.get(workflows)
            const workflow = found.find((item) => item.name === input.name)
            if (!workflow) {
              return yield* Effect.fail(
                context.error("not_found", `Unknown workflow "${input.name}"`, { name: input.name }),
              )
            }
            const busy = registry.busy()
            if (busy) {
              return yield* Effect.fail(
                context.error("busy", `Workflow ${busy.id} is still ${busy.status}`, { runId: busy.id }),
              )
            }
            const run = yield* launch(workflow, mergeInput(input), input.sessionID)
            return { run }
          }),
        status: (input) => Effect.succeed({ run: registry.get(input.runId) }),
        cancel: (input) =>
          Effect.gen(function* () {
            const run = registry.get(input.runId)
            if (!run) return { run: undefined }
            return { run: yield* cancelRun(registry, run.id) }
          }),
        answer: (input, context) =>
          Effect.gen(function* () {
            const run = registry.get(input.runId)
            if (!run) {
              return yield* Effect.fail(context.error("not_waiting", "No workflow is waiting", { runId: "" }))
            }
            const pending = registry.checkpoints.get(run.id)
            if (!pending) {
              return yield* Effect.fail(
                context.error("not_waiting", `Run ${run.id} is not waiting`, { runId: run.id }),
              )
            }
            yield* Deferred.succeed(pending, input.value)
            return { run: registry.get(run.id) ?? run }
          }),
      })

      yield* Ref.set(
        emitRef,
        (run) =>
          Effect.sync(() => registry.put(run)).pipe(
            Effect.andThen(rpc.events.emit("updated", { run })),
            Effect.asVoid,
            Effect.orDie,
          ),
      )

      yield* Effect.addFinalizer(() =>
        Effect.forEach([...registry.fibers.values()], Fiber.interrupt, { discard: true }),
      )

      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "workflow",
          description: "List or start a workflow",
          execute: (input) =>
            Effect.gen(function* () {
              yield* reload.pipe(Effect.orDie)
              const found = yield* Ref.get(workflows)
              const text = yield* handleCommand({
                text: input.prompt.text.trim(),
                sessionID: input.sessionID,
                workflows: found,
                registry,
                launch,
              })
              yield* ctx.session.synthetic({ sessionID: input.sessionID, text }).pipe(Effect.orDie)
            }),
        })
      })

      yield* ctx.tool.transform((editor) => {
        editor.add({
          name: "workflow",
          description: "List, start, inspect, cancel, submit, or answer a workflow run",
          input: ToolInput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* reload.pipe(Effect.orDie)
              const found = yield* Ref.get(workflows)
              const content = yield* handleTool({
                ...input,
                sessionID: context.sessionID,
                workflows: found,
                registry,
                launch,
              })
              return { content }
            }),
        })
      })

      yield* ctx.skill.transform((editor) => {
        for (const skill of bundledSkills) {
          editor.add(
            Skill.Info.make({
              id: Skill.ID.make(skill.id),
              name: Skill.Name.make(skill.name),
              description: skill.description,
              path: skillPath(skill.id),
              content: skill.content,
            }),
          )
        }
      })
    }).pipe(Effect.orDie),
})

function mergeInput(input: { task?: string; input?: unknown }): unknown {
  if (input.input && typeof input.input === "object") {
    return { task: input.task, ...(input.input as Record<string, unknown>) }
  }
  return { task: input.task }
}

function skillPath(id: string): typeof Skill.Info.Type.path {
  return `/opencode-workflows/skills/${id}` as typeof Skill.Info.Type.path
}
