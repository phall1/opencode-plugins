import { fileURLToPath } from "node:url"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { runAction, type ActionResult } from "./actions.ts"
import { clientApi } from "./client.ts"
import { optionsOf, remoteDefinitions, type TeleportOptions } from "./config.ts"
import { mergeOptions, optionsFromConfig } from "./tui-config.ts"
import { parseCommand, type ActionRequest } from "./parse.ts"
import { formatHelp } from "./report.ts"
import { listAll } from "./transfer.ts"
import type { SessionSummary } from "./types.ts"

type Context = ReturnType<typeof usePlugin>

export default Plugin.define({
  id: "phall.teleport.cli",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "phall.teleport.run",
          title: "Teleport",
          description: "Copy sessions between OpenCode servers",
          group: "Teleport",
          palette: true,
          slash: { name: "teleport", arguments: true },
          run: (input) => void runTeleport(context, input ?? ""),
        },
      ],
    }))
  },
})

export async function runTeleport(context: Context, raw: string): Promise<void> {
  try {
    const options = await resolveOptions(context)
    const interactive = raw.trim() === ""
    const parsed = parseCommand(raw)
    const direction =
      interactive && parsed.action === "help" && parsed.note === undefined
        ? await chooseDirection(context)
        : parsed
    if (!direction) return
    const request = await complete(context, options, direction, interactive)
    if (!request) return
    if (interactive && (request.action === "pull" || request.action === "push")) {
      if (!(await confirmPlan(context, options, request))) return
    }
    await execute(context, options, request)
  } catch (error) {
    await context.ui.dialog.alert({ title: "Teleport", message: messageOf(error) })
  }
}

/** Fill in missing pieces with dialogs. Returns undefined when the user cancels. */
async function complete(
  context: Context,
  options: TeleportOptions,
  request: ActionRequest,
  interactive: boolean,
): Promise<ActionRequest | undefined> {
  if (request.action === "help") {
    await context.ui.dialog.alert({
      title: "Teleport",
      message: formatHelp([...remoteDefinitions(options, process.env).keys()]),
    })
    return undefined
  }
  if (request.action === "remotes" || request.action === "sessions") return request

  const remote =
    request.remote ||
    (await chooseRemote(context, options, request.action === "pull" ? "Pull from remote" : "Push to remote"))
  if (!remote) return undefined

  const sessionID =
    request.sessionID ||
    (!interactive && request.action === "push" ? currentSessionID(context) : undefined) ||
    (await chooseSession(context, options, request.action, remote))
  if (!sessionID) return undefined

  const directory =
    request.directory ?? (request.action === "pull" && interactive ? await chooseDirectory(context) : undefined)
  if (request.action === "pull" && interactive && directory === undefined) return undefined

  return { ...request, remote, sessionID, directory }
}

async function confirmPlan(context: Context, options: TeleportOptions, request: ActionRequest): Promise<boolean> {
  if (request.action !== "pull" && request.action !== "push") return true
  const preview = await runAction({ ...request, dryRun: true }, deps(context, options))
  if (!preview.ok) {
    await context.ui.dialog.alert({ title: "Teleport", message: preview.text })
    return false
  }
  const confirmed = await context.ui.dialog.confirm({
    title: request.action === "pull" ? "Pull sessions" : "Push sessions",
    message: preview.text,
    label: { confirm: "Teleport", cancel: "Cancel" },
  })
  return confirmed === true
}

async function resolveOptions(context: Context): Promise<TeleportOptions> {
  const explicit = optionsOf(context.options)
  if (explicit.remotes !== undefined || explicit.local !== undefined) return explicit
  const documents = await Promise.resolve(context.client.config.get()).catch(() => undefined)
  const targets = selfTargets()
  // A git install keeps the configured spec (`github:…#sha::path:…#`) while the
  // loaded package lives at its cache path. The server inventory maps this
  // plugin's id to the spec that carried the options.
  const inventory = await Promise.resolve(context.client.plugin.list()).catch(() => undefined)
  targets.push(...targetsFromInventory(inventory, "phall.teleport"))
  return mergeOptions(explicit, optionsFromConfig(documents, targets))
}

export function targetsFromInventory(inventory: unknown, id: string): string[] {
  if (!inventory || typeof inventory !== "object") return []
  const data = (inventory as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const result: string[] = []
  for (const item of data) {
    if (!item || typeof item !== "object") continue
    const plugin = item as { id?: unknown; source?: unknown }
    if (plugin.id !== id) continue
    const source = plugin.source
    if (!source || typeof source !== "object") continue
    const value = source as { type?: unknown; target?: unknown; path?: unknown }
    if (value.type === "package" && typeof value.target === "string") result.push(value.target)
    if (value.type === "local" && typeof value.path === "string") result.push(value.path)
  }
  return result
}

function selfTargets(): string[] {
  const targets = ["@phall1/opencode-teleport", "opencode-teleport"]
  try {
    targets.push(fileURLToPath(new URL("..", import.meta.url)))
  } catch {
    // A bundled TUI has no package.json beside it; the package names still match.
  }
  return targets
}

async function chooseDirection(context: Context): Promise<ActionRequest | undefined> {
  const action = await context.ui.dialog.select<"pull" | "push">({
    title: "Teleport",
    options: [
      { title: "Pull from a remote", value: "pull" },
      { title: "Push to a remote", value: "push" },
    ],
  })
  if (!action) return undefined
  return { action, remote: "", includeChildren: true, onConflict: "fail" }
}

async function chooseRemote(context: Context, options: TeleportOptions, title: string): Promise<string | undefined> {
  const names = [...remoteDefinitions(options, process.env).keys()]
  if (names.length === 0) {
    await context.ui.dialog.alert({
      title: "Teleport",
      message:
        "No remotes are configured. Add them to the plugin options:\n\n" +
        '{ "plugins": [{ "package": "@phall1/opencode-teleport", "options": { "remotes": { "mini": { "url": "http://host:49374", "passwordEnv": "MINI_PASSWORD" } } } }] }',
    })
    return undefined
  }
  if (names.length === 1) return names[0]
  return context.ui.dialog.select({
    title,
    options: names.map((name) => ({ title: name, value: name })),
  })
}

async function chooseSession(
  context: Context,
  options: TeleportOptions,
  action: "pull" | "push",
  remote: string,
): Promise<string | undefined> {
  const items = await sessionsFor(context, options, action, remote)
  if (items.length === 0) {
    await context.ui.dialog.alert({ title: "Teleport", message: `No sessions found to ${action}.` })
    return undefined
  }
  return context.ui.dialog.select({
    title: action === "pull" ? "Session to pull" : "Session to push",
    options: items.map((item) => ({
      title: item.title?.trim() || "(untitled)",
      value: item.id,
      description: `${item.id}${item.directory ? ` — ${item.directory}` : ""}`,
      footer: formatWhen(item),
    })),
    search: (query, all) => {
      const needle = query.trim().toLowerCase()
      if (!needle) return all
      return all.filter((option) => `${option.title} ${option.description ?? ""}`.toLowerCase().includes(needle))
    },
  })
}

async function sessionsFor(
  context: Context,
  options: TeleportOptions,
  action: "pull" | "push",
  remote: string,
): Promise<SessionSummary[]> {
  if (action === "push") {
    const local = clientApi(context.client)
    const directory = defaultDirectory(context)
    const scoped = directory ? await listAll(local, { parentID: null, directory, limit: 50 }, 50) : []
    return scoped.length > 0 ? scoped : listAll(local, { parentID: null, limit: 50 }, 50)
  }
  const result = await runAction({ action: "sessions", remote }, deps(context, options))
  if (!result.ok) {
    await context.ui.dialog.alert({ title: "Teleport", message: result.text })
    return []
  }
  return (result.metadata.items as SessionSummary[] | undefined) ?? []
}

async function chooseDirectory(context: Context): Promise<string | undefined> {
  const fallback = defaultDirectory(context) ?? ""
  const value = await context.ui.dialog.prompt({
    title: "Destination directory",
    description: "Local checkout that should receive the session history",
    value: fallback,
    placeholder: fallback || "/path/to/project",
  })
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

async function execute(context: Context, options: TeleportOptions, request: ActionRequest): Promise<void> {
  if (request.action === "pull" || request.action === "push") {
    context.ui.toast.show({
      message: request.action === "pull" ? "Teleporting session here…" : `Teleporting to ${request.remote}…`,
    })
  }
  await report(context, await runAction(request, deps(context, options)))
}

async function report(context: Context, result: ActionResult): Promise<void> {
  const sessionID = typeof result.metadata.sessionID === "string" ? result.metadata.sessionID : undefined
  if (result.ok && sessionID && result.metadata.action === "pull") {
    context.ui.tabs.focus(sessionID)
    context.ui.toast.show({ title: "Teleported", message: "Imported session opened", variant: "success", sessionID })
    return
  }
  await context.ui.dialog.alert({ title: result.ok ? "Teleport" : "Teleport failed", message: result.text })
}

function deps(context: Context, options: TeleportOptions) {
  return {
    options,
    env: process.env,
    local: () => clientApi(context.client),
    localReason: () => "the TUI client is unavailable",
    defaultDirectory: defaultDirectory(context),
    currentSessionID: currentSessionID(context),
  }
}

function defaultDirectory(context: Context): string | undefined {
  return context.location?.directory ?? context.data.location.default()?.directory
}

function currentSessionID(context: Context): string | undefined {
  const route = context.ui.router.current()
  if (route?.type === "session") return route.sessionID
  return context.ui.tabs.list().find((tab) => tab.active)?.sessionID
}

function formatWhen(item: SessionSummary): string | undefined {
  const value = item.updated ?? item.created
  if (value === undefined) return undefined
  return new Date(value).toISOString().slice(0, 16).replace("T", " ")
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
