import { describe, expect, test } from "bun:test"
import {
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  normalizeUrl,
  optionsOf,
  remoteDefinitions,
  remotePasswordEnv,
  resolveLocalEndpoint,
  resolveRemote,
  timeoutOf,
} from "../src/config.ts"
import { TeleportError } from "../src/errors.ts"

function status(fn: () => unknown): string {
  try {
    fn()
    return "ok"
  } catch (error) {
    return error instanceof TeleportError ? error.code : "unexpected"
  }
}

describe("normalizeUrl", () => {
  test("keeps host and path, drops trailing slashes", () => {
    expect(normalizeUrl("http://127.0.0.1:49374/", "x")).toBe("http://127.0.0.1:49374")
    expect(normalizeUrl(" https://example.test/opencode/ ", "x")).toBe("https://example.test/opencode")
  })

  test("rejects non-http and relative urls", () => {
    expect(status(() => normalizeUrl("ftp://example.test", "x"))).toBe("invalid")
    expect(status(() => normalizeUrl("127.0.0.1:49374", "x"))).toBe("invalid")
    expect(status(() => normalizeUrl("  ", "x"))).toBe("invalid")
  })
})

describe("optionsOf", () => {
  test("keeps recognised keys and ignores junk", () => {
    const parsed = optionsOf({ remotes: { mini: "http://mini" }, local: "http://localhost", timeoutMs: 5000, other: 1 })
    expect(parsed.remotes).toEqual({ mini: "http://mini" })
    expect(parsed.local).toBe("http://localhost")
    expect(parsed.timeoutMs).toBe(5000)
    expect(Object.keys(parsed)).not.toContain("other")
  })

  test("tolerates non-objects", () => {
    expect(optionsOf(undefined)).toEqual({ remotes: undefined, local: undefined, timeoutMs: undefined })
    expect(optionsOf("nope")).toEqual({ remotes: undefined, local: undefined, timeoutMs: undefined })
  })
})

describe("timeoutOf", () => {
  test("clamps and defaults", () => {
    expect(timeoutOf({})).toBe(30_000)
    expect(timeoutOf({ timeoutMs: 1 })).toBe(MIN_TIMEOUT_MS)
    expect(timeoutOf({ timeoutMs: 10_000_000 })).toBe(MAX_TIMEOUT_MS)
    expect(timeoutOf({ timeoutMs: Number.NaN })).toBe(30_000)
  })
})

describe("remoteDefinitions", () => {
  test("accepts url shorthand and objects", () => {
    const definitions = remoteDefinitions(
      { remotes: { mini: "http://mini:1", laptop: { url: "http://laptop:2", password: "secret" } } },
      {},
    )
    expect(resolveRemote("mini", definitions, {}).url).toBe("http://mini:1")
    expect(resolveRemote("laptop", definitions, {}).password).toBe("secret")
  })

  test("reads OPENCODE_TELEPORT_REMOTES when options are absent", () => {
    const definitions = remoteDefinitions({}, { OPENCODE_TELEPORT_REMOTES: '{"mini":"http://mini:1"}' })
    expect([...definitions.keys()]).toEqual(["mini"])
  })

  test("reports invalid environment json", () => {
    expect(status(() => remoteDefinitions({}, { OPENCODE_TELEPORT_REMOTES: "{" }))).toBe("invalid")
    expect(status(() => remoteDefinitions({}, { OPENCODE_TELEPORT_REMOTES: "[]" }))).toBe("invalid")
  })
})

describe("remote passwords", () => {
  const definitions = remoteDefinitions({ remotes: { mini: "http://mini:1" } }, {})

  test("prefers inline, then passwordEnv, then name env, then global env", () => {
    const inline = remoteDefinitions({ remotes: { mini: { url: "http://mini:1", password: "inline" } } }, {})
    expect(resolveRemote("mini", inline, {}).password).toBe("inline")

    const named = remoteDefinitions({ remotes: { mini: { url: "http://mini:1", passwordEnv: "MINI_PW" } } }, {})
    expect(resolveRemote("mini", named, { MINI_PW: "from-env" }).password).toBe("from-env")
    expect(status(() => resolveRemote("mini", named, {}))).toBe("not_configured")

    expect(resolveRemote("mini", definitions, { [remotePasswordEnv("mini")]: "named" }).password).toBe("named")
    expect(resolveRemote("mini", definitions, { OPENCODE_TELEPORT_PASSWORD: "global" }).password).toBe("global")
  })

  test("unknown remotes list what is configured", () => {
    try {
      resolveRemote("other", definitions, {})
      throw new Error("expected failure")
    } catch (error) {
      expect(error).toBeInstanceOf(TeleportError)
      expect((error as TeleportError).message).toContain("mini")
    }
  })

  test("empty configuration explains how to configure", () => {
    expect(status(() => resolveRemote("mini", new Map(), {}))).toBe("not_configured")
  })
})

describe("passwordCommand", () => {
  test("array commands run directly and stdout is trimmed", () => {
    const definitions = remoteDefinitions(
      { remotes: { mini: { url: "http://mini:1", passwordCommand: ["/bin/sh", "-c", "printf ' from-command \\n'"] } } },
      {},
    )
    expect(resolveRemote("mini", definitions, {}).password).toBe("from-command")
  })

  test("string commands run through the shell", () => {
    const definitions = remoteDefinitions(
      { remotes: { mini: { url: "http://mini:1", passwordCommand: "printf shell-secret" } } },
      {},
    )
    expect(resolveRemote("mini", definitions, {}).password).toBe("shell-secret")
  })

  test("failures and empty output are configuration errors", () => {
    const failing = remoteDefinitions(
      { remotes: { mini: { url: "http://mini:1", passwordCommand: ["/bin/sh", "-c", "exit 3"] } } },
      {},
    )
    expect(status(() => resolveRemote("mini", failing, {}))).toBe("not_configured")

    const empty = remoteDefinitions(
      { remotes: { mini: { url: "http://mini:1", passwordCommand: "true" } } },
      {},
    )
    expect(status(() => resolveRemote("mini", empty, {}))).toBe("not_configured")
  })

  test("inline and environment passwords still win", () => {
    const definitions = remoteDefinitions(
      { remotes: { mini: { url: "http://mini:1", password: "inline", passwordCommand: "printf nope" } } },
      {},
    )
    expect(resolveRemote("mini", definitions, {}).password).toBe("inline")
  })
})

describe("request headers", () => {
  test("are validated and carried to the endpoint", () => {
    const definitions = remoteDefinitions(
      { remotes: { mini: { url: "http://mini:1", headers: { "cf-access-client-id": "abc" } } } },
      {},
    )
    expect(resolveRemote("mini", definitions, {}).headers).toEqual({ "cf-access-client-id": "abc" })
  })

  test("reject non-string values", () => {
    expect(
      status(() =>
        remoteDefinitions(
          { remotes: { mini: { url: "http://mini:1", headers: { bad: 1 } } } as never },
          {},
        ),
      ),
    ).toBe("invalid")
  })
})

describe("resolveLocalEndpoint", () => {
  test("options win over the environment", () => {
    const endpoint = resolveLocalEndpoint(
      { local: { url: "http://options:1", password: "a" } },
      { OPENCODE_TELEPORT_LOCAL_URL: "http://env:2" },
    )
    expect(endpoint?.url).toBe("http://options:1")
    expect(endpoint?.source).toBe("options")
  })

  test("environment variables are normalized", () => {
    const endpoint = resolveLocalEndpoint(
      {},
      { OPENCODE_TELEPORT_LOCAL_URL: "http://env:2/", OPENCODE_TELEPORT_LOCAL_PASSWORD: "pw" },
    )
    expect(endpoint).toEqual({ name: "local", url: "http://env:2", username: "opencode", password: "pw", source: "env" })
  })

  test("undefined without configuration", () => {
    expect(resolveLocalEndpoint({}, {})).toBeUndefined()
  })
})
