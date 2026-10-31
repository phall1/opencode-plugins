import { describe, expect, test } from "bun:test"
import { mergeOptions, optionsFromConfig } from "../src/tui-config.ts"

const documents = [
  { type: "directory", path: "/config/opencode" },
  {
    type: "document",
    path: "/config/opencode.json",
    info: {
      plugins: [
        "some-string-plugin",
        { package: "@scope/other", options: { remotes: { nope: "http://nope" } } },
        {
          package: "/Users/phall/workspace/opencode-plugins/packages/teleport",
          options: { remotes: { mini: { url: "http://mini:1", passwordEnv: "MINI_PW" } }, timeoutMs: 5000 },
        },
        {
          package: "@phall1/opencode-teleport",
          options: { remotes: { laptop: "http://laptop:2" }, local: "http://local:3" },
        },
      ],
    },
  },
]

const targets = ["@phall1/opencode-teleport", "/Users/phall/workspace/opencode-plugins/packages/teleport/"]

describe("optionsFromConfig", () => {
  test("merges this package's entries and ignores foreign plugins", () => {
    const options = optionsFromConfig(documents, targets)
    expect(options.remotes).toEqual({
      mini: { url: "http://mini:1", passwordEnv: "MINI_PW" },
      laptop: "http://laptop:2",
    })
    expect(options.local).toBe("http://local:3")
    expect(options.timeoutMs).toBe(5000)
  })

  test("returns empty options when nothing matches", () => {
    expect(optionsFromConfig(documents, ["@other/plugin"])).toEqual({})
    expect(optionsFromConfig(undefined, targets)).toEqual({})
    expect(optionsFromConfig([{ info: { plugins: 1 } }], targets)).toEqual({})
  })
})

describe("mergeOptions", () => {
  test("explicit options win", () => {
    const merged = mergeOptions(
      { remotes: { explicit: "http://explicit" }, timeoutMs: 1000 },
      { remotes: { configured: "http://configured" }, local: "http://local", timeoutMs: 9000 },
    )
    expect(merged.remotes).toEqual({ explicit: "http://explicit" })
    expect(merged.local).toBe("http://local")
    expect(merged.timeoutMs).toBe(1000)
  })
})
