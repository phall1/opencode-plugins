import { Plugin } from "@opencode/plugin/effect"
import { Effect, Schema } from "effect"
import { runAction, type ActionDeps, type ActionResult } from "./actions.ts"
import { optionsOf, timeoutOf, type TeleportOptions } from "./config.ts"
import { discoverLocal } from "./endpoint.ts"
import { errorText } from "./errors.ts"
import { httpApi } from "./http.ts"
import { parseCommand, type ActionRequest } from "./parse.ts"

const ToolInput = Schema.Struct({
  action: Schema.Literals(["remotes", "sessions", "pull", "push", "help"]),
  remote: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  includeChildren: Schema.optional(Schema.Boolean),
  onConflict: Schema.optional(Schema.Literals(["skip", "fail"])),
})

type ToolInput = typeof ToolInput.Type

export function requestOf(input: ToolInput): ActionRequest {
  if (input.action === "help") return { action: "help" }
  if (input.action === "remotes") return { action: "remotes" }
  if (input.action === "sessions") {
    return { action: "sessions", remote: input.remote, query: input.query }
  }
  if (!input.remote) return { action: "help", note: `${input.action} needs a remote name` }
  return {
    action: input.action,
    remote: input.remote,
    sessionID: input.sessionID,
    directory: input.directory,
    includeChildren: input.includeChildren ?? true,
    onConflict: input.onConflict ?? "fail",
  }
}

export default Plugin.define({
  id: "phall.teleport",
  effect: (ctx) =>
    Effect.gen(function* () {
      const options: TeleportOptions = optionsOf(ctx.options)
      const timeoutMs = timeoutOf(options)

      const discovery = () => discoverLocal(options)
      const deps = (sessionID: string): ActionDeps => ({
        options,
        env: process.env,
        timeoutMs,
        local: () => {
          const found = discovery()
          if (!found.endpoint) return undefined
          return httpApi(found.endpoint, { timeoutMs })
        },
        localReason: () => discovery().reason,
        defaultDirectory: ctx.location.directory,
        currentSessionID: sessionID,
      })

      const run = (request: ActionRequest, sessionID: string) =>
        Effect.promise(() => runAction(request, deps(sessionID)))

      yield* ctx.tool.transform((editor) => {
        editor.add({
          name: "teleport",
          description:
            "Copy a complete OpenCode session, including its child-session tree, between OpenCode servers. " +
            "Use only when the user explicitly asks to teleport, transfer or copy a session to another server. " +
            "Actions: remotes (probe configured servers), sessions (list sessions on a remote), " +
            "pull (copy a remote session to this server), push (copy this server's session to a remote).",
          input: ToolInput,
          execute: (input, context) =>
            run(requestOf(input), context.sessionID).pipe(
              Effect.map((result) => ({
                content: result.text,
                metadata: { ...result.metadata },
              })),
              Effect.catch((error) =>
                Effect.succeed({
                  content: `Teleport failed: ${errorText(error)}`,
                  metadata: { ok: false },
                }),
              ),
            ),
        })
      })

      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "teleport",
          description: "Teleport sessions between OpenCode servers",
          execute: (input) =>
            Effect.gen(function* () {
              const request = parseCommand(input.prompt.text ?? "")
              const result: ActionResult = yield* run(request, input.sessionID)
              yield* ctx.session.synthetic({ sessionID: input.sessionID, text: result.text })
            }).pipe(Effect.orDie),
        })
      })
    }).pipe(Effect.orDie),
})
