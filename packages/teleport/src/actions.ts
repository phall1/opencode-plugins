import { errorText, TeleportError } from "./errors.ts"
import {
  remoteDefinitions,
  resolveRemote,
  type Env,
  type TeleportOptions,
} from "./config.ts"
import { httpApi } from "./http.ts"
import type { ActionRequest } from "./parse.ts"
import { formatHelp, formatPlan, formatPlanBrief, formatRemotes, formatReport, formatSessions } from "./report.ts"
import { listAll, planTransfer, teleport } from "./transfer.ts"
import type { ServerApi } from "./types.ts"

export type ActionDeps = {
  readonly options: TeleportOptions
  readonly env: Env
  /** Local access, or undefined when this surface cannot reach the local server. */
  readonly local: () => ServerApi | undefined
  /** Why local access is unavailable, for diagnostics. */
  readonly localReason?: () => string
  /** Default destination for `pull`; usually the current project directory. */
  readonly defaultDirectory?: string
  /** Session used by `push` when the command omits one. */
  readonly currentSessionID?: string
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

export type ActionResult = {
  readonly ok: boolean
  readonly text: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export async function runAction(request: ActionRequest, deps: ActionDeps): Promise<ActionResult> {
  try {
    return await dispatch(request, deps)
  } catch (error) {
    return {
      ok: false,
      text: `Teleport failed: ${errorText(error)}`,
      metadata: {
        action: request.action,
        ok: false,
        code: error instanceof TeleportError ? error.code : "failed",
      },
    }
  }
}

async function dispatch(request: ActionRequest, deps: ActionDeps): Promise<ActionResult> {
  const definitions = remoteDefinitions(deps.options, deps.env)
  const timeoutMs = deps.timeoutMs
  const remote = (name: string) =>
    httpApi(resolveRemote(name, definitions, deps.env), { timeoutMs, fetch: deps.fetch })
  const local = () => {
    const api = deps.local()
    if (!api) {
      throw new TeleportError(
        "local_unavailable",
        "This surface cannot reach the local server. Use /teleport in the TUI, or configure a local endpoint.",
        deps.localReason?.(),
      )
    }
    return api
  }

  switch (request.action) {
    case "help":
      return {
        ok: true,
        text: [request.note ? `Note: ${request.note}\n` : "", formatHelp([...definitions.keys()])].join(""),
        metadata: { action: "help", remotes: [...definitions.keys()] },
      }

    case "remotes": {
      const remotes: { name: string; url: string; version?: string; error?: string }[] = []
      for (const [name, definition] of definitions) {
        let url = definition.url
        try {
          const endpoint = resolveRemote(name, definitions, deps.env)
          url = endpoint.url
          const health = await httpApi(endpoint, { timeoutMs, fetch: deps.fetch }).health()
          remotes.push({ name, url, version: health.version })
        } catch (error) {
          remotes.push({ name, url, error: errorText(error) })
        }
      }
      const localInfo: { url?: string; reason: string; version?: string; error?: string } = {
        reason: deps.localReason?.() ?? "not discovered",
      }
      const localApi = deps.local()
      if (localApi) {
        localInfo.url = localApi.url ?? "configured"
        try {
          const health = await localApi.health()
          localInfo.version = health.version
        } catch (error) {
          localInfo.error = errorText(error)
        }
      }
      return {
        ok: true,
        text: formatRemotes(remotes, localInfo),
        metadata: { action: "remotes", remotes: remotes.map((item) => item.name), local: localInfo.url ?? null },
      }
    }

    case "sessions": {
      const api = request.remote ? remote(request.remote) : local()
      const items = await listAll(api, { search: request.query, parentID: null, limit: 50 }, 50)
      return {
        ok: true,
        text: formatSessions(items, api.label, request.query),
        metadata: { action: "sessions", remote: request.remote ?? "local", count: items.length, items },
      }
    }

    case "pull": {
      if (!request.sessionID) {
        throw new TeleportError("invalid", "pull needs a session ID: /teleport pull <remote> <session>")
      }
      const source = remote(request.remote)
      const destination = local()
      const directory = request.directory ?? deps.defaultDirectory
      if (request.dryRun) {
        return preview({ source, destination, sessionID: request.sessionID, directory, request })
      }
      const report = await teleport({
        source,
        destination,
        sessionID: request.sessionID,
        directory,
        includeChildren: request.includeChildren,
        onConflict: request.onConflict,
      })
      return {
        ok: report.failed === 0 && report.unverified === 0,
        text: formatReport(report, source.label, destination.label),
        metadata: { action: "pull", remote: request.remote, sessionID: request.sessionID, ...counts(report) },
      }
    }

    case "push": {
      const sessionID = request.sessionID ?? deps.currentSessionID
      if (!sessionID) {
        throw new TeleportError("invalid", "push needs a session ID: /teleport push <remote> <session>")
      }
      const source = local()
      const destination = remote(request.remote)
      if (request.dryRun) {
        return preview({
          source,
          destination,
          sessionID,
          directory: request.directory,
          request,
        })
      }
      const report = await teleport({
        source,
        destination,
        sessionID,
        directory: request.directory,
        includeChildren: request.includeChildren,
        onConflict: request.onConflict,
      })
      return {
        ok: report.failed === 0 && report.unverified === 0,
        text: formatReport(report, source.label, destination.label),
        metadata: { action: "push", remote: request.remote, sessionID, ...counts(report) },
      }
    }
  }
}

async function preview(input: {
  source: ServerApi
  destination: ServerApi
  sessionID: string
  directory: string | undefined
  request: { action: "pull" | "push"; remote: string; includeChildren: boolean }
}): Promise<ActionResult> {
  const plan = await planTransfer({
    source: input.source,
    sessionID: input.sessionID,
    includeChildren: input.request.includeChildren,
  })
  return {
    ok: true,
    text: formatPlan(plan, input.source.label, input.destination.label, input.directory),
    metadata: {
      action: input.request.action,
      dryRun: true,
      remote: input.request.remote,
      sessionID: input.sessionID,
      sessions: plan.sessions,
      truncated: plan.truncated,
      brief: formatPlanBrief(plan, input.source.label, input.destination.label, input.directory),
    },
  }
}

function counts(report: { imported: number; skipped: number; failed: number; unverified: number; messages: number }) {
  return {
    imported: report.imported,
    skipped: report.skipped,
    failed: report.failed,
    unverified: report.unverified,
    messages: report.messages,
  }
}
