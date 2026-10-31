import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { httpApi } from "../src/http.ts"
import { TeleportError } from "../src/errors.ts"
import type { Endpoint } from "../src/config.ts"

const password = "s3cret"
const expected = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`

type Seen = {
  path: string
  query: URLSearchParams
  body?: unknown
  authorization?: string | null
  tested?: string | null
}

let server: ReturnType<typeof Bun.serve>
let endpoint: Endpoint
let seen: Seen

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const body = request.method === "POST" ? await request.json() : undefined
      seen = {
        path: url.pathname,
        query: url.searchParams,
        body,
        authorization: request.headers.get("authorization"),
        tested: request.headers.get("x-test"),
      }
      const authorization = request.headers.get("authorization")
      if (authorization !== expected && authorization !== "Bearer custom") {
        return json({ _tag: "UnauthorizedError" }, 401)
      }

      if (url.pathname === "/api/info") return json({ version: "2.2.5", urls: ["http://fake.test"] })

      if (url.pathname === "/api/session") {
        if (url.searchParams.get("parentID") === "null") return json({ data: [], cursor: { next: null } })
        return json({
          data: [
            {
              id: "ses_1",
              title: "First",
              parentID: "ses_parent",
              location: { directory: "/repo" },
              time: { created: 1, updated: 2 },
            },
          ],
          cursor: { next: "page-2" },
        })
      }

      const single = url.pathname.match(/^\/api\/session\/([^/]+)$/)
      if (single) {
        const id = decodeURIComponent(single[1]!)
        if (id === "ses_missing") return json({ _tag: "SessionNotFoundError", message: "no such session" }, 404)
        return json({ data: { id, title: "First", location: { directory: "/repo" }, time: { created: 1 } } })
      }

      const exported = url.pathname.match(/^\/api\/experimental\/session\/([^/]+)\/export$/)
      if (exported) {
        const id = decodeURIComponent(exported[1]!)
        if (id === "ses_missing") return json({ _tag: "SessionNotFoundError", message: "no such session" }, 404)
        if (id === "ses_old") return json({ _tag: "NotFound", message: "no route" }, 404)
        if (id === "ses_broken") return json({ data: { info: {} } })
        return json({ data: { info: { id, title: "Transferred", location: { directory: "/repo" } }, messages: [{ id: "m1" }] } })
      }

      if (url.pathname === "/api/experimental/session/import") {
        const data = body as { info: { id: string }; location: { directory: string } }
        if (data.info.id === "ses_conflict") return json({ _tag: "ConflictError", message: "already exists" }, 409)
        if (data.info.id === "ses_invalid") return json({ _tag: "InvalidRequestError", message: "bad transcript" }, 400)
        return json({ data: { id: data.info.id, location: data.location } })
      }

      return json({ _tag: "NotFound" }, 404)
    },
  })
  endpoint = { name: "mini", url: `http://127.0.0.1:${server.port}`, username: "opencode", password }
})

afterAll(() => {
  server.stop(true)
})

describe("httpApi", () => {
  test("sends basic auth and reads health", async () => {
    const api = httpApi(endpoint)
    expect(await api.health()).toEqual({ version: "2.2.5", url: "http://fake.test" })
    expect(seen.authorization).toBe(expected)
  })

  test("reads one session", async () => {
    expect(await httpApi(endpoint).get("ses_1")).toEqual({
      id: "ses_1",
      title: "First",
      parentID: undefined,
      directory: "/repo",
      created: 1,
      updated: undefined,
    })
    await expect(httpApi(endpoint).get("ses_missing")).rejects.toMatchObject({ code: "not_found" })
  })

  test("sends configured headers and lets an explicit Authorization win over basic auth", async () => {
    const api = httpApi({
      ...endpoint,
      headers: { authorization: "Bearer custom", "x-test": "yes" },
    })
    expect((await api.health()).version).toBe("2.2.5")
    expect(seen.authorization).toBe("Bearer custom")
    expect(seen.tested).toBe("yes")
  })

  test("maps list pages", async () => {
    const page = await httpApi(endpoint).list({ search: "first", limit: 10, directory: "/repo" })
    expect(page).toEqual({
      items: [{ id: "ses_1", title: "First", parentID: "ses_parent", directory: "/repo", created: 1, updated: 2 }],
      next: "page-2",
    })
    expect(seen.query.get("search")).toBe("first")
    expect(seen.query.get("limit")).toBe("10")
    expect(seen.query.get("directory")).toBe("/repo")
    expect(seen.query.get("order")).toBe("desc")
  })

  test("passes null parents as the literal null filter", async () => {
    expect((await httpApi(endpoint).list({ parentID: null })).next).toBeUndefined()
    expect(seen.query.get("parentID")).toBe("null")
  })

  test("parses exports and distinguishes a missing session from an old server", async () => {
    const api = httpApi(endpoint)
    const transfer = await api.export("ses_1")
    expect(transfer.info.id).toBe("ses_1")
    expect(transfer.messages).toHaveLength(1)

    await expect(api.export("ses_missing")).rejects.toMatchObject({ code: "not_found" })
    await expect(api.export("ses_old")).rejects.toMatchObject({ code: "unsupported" })
    await expect(api.export("ses_broken")).rejects.toMatchObject({ code: "failed" })
  })

  test("includes the destination location on import", async () => {
    const session = await httpApi(endpoint).import(
      { info: { id: "ses_new" }, messages: [{ id: "m1" }] },
      "/work/repo",
    )
    expect(session.id).toBe("ses_new")
    expect(seen.body).toEqual({
      info: { id: "ses_new" },
      messages: [{ id: "m1" }],
      location: { directory: "/work/repo" },
    })
  })

  test("maps conflicts, invalid requests and auth failures", async () => {
    const api = httpApi(endpoint)
    await expect(api.import({ info: { id: "ses_conflict" }, messages: [] }, "/work")).rejects.toMatchObject({
      code: "conflict",
    })
    await expect(api.import({ info: { id: "ses_invalid" }, messages: [] }, "/work")).rejects.toMatchObject({
      code: "invalid",
    })

    const wrong = httpApi({ ...endpoint, password: "wrong" })
    await expect(wrong.health()).rejects.toMatchObject({ code: "unauthorized" })
  })

  test("reports an unreachable server", async () => {
    const api = httpApi({ name: "dead", url: "http://127.0.0.1:1", username: "opencode" }, { timeoutMs: 2_000 })
    const error = (await api.health().catch((cause: unknown) => cause)) as TeleportError
    expect(error).toBeInstanceOf(TeleportError)
    expect(error.code).toBe("unreachable")
  })
})
