import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { acpSubprocessEnvironment } from "./adapter.ts"
import { ACP_AGENT_REGISTRY } from "./registry.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("ACP subprocess environment", () => {
  test.runIf(process.platform !== "win32")("injects the user's Claude CLI path for the Claude ACP bridge", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-acp-runtime-"))
    temporaryDirectories.push(directory)
    const claudePath = path.join(directory, "claude")
    await writeFile(claudePath, "#!/bin/sh\nexit 0\n", "utf8")
    await chmod(claudePath, 0o755)

    const env = await acpSubprocessEnvironment(ACP_AGENT_REGISTRY["claude-code"], directory, {})

    expect(env.CLAUDE_CODE_EXECUTABLE).toBe(claudePath)
    expect(env.PATH).toBe(directory)
    expect(env.WANTA_NODE_RUNTIME).toBe(process.execPath)
  })

  test("preserves an explicit bridge runtime override", async () => {
    const env = await acpSubprocessEnvironment(ACP_AGENT_REGISTRY["claude-code"], "", {
      CLAUDE_CODE_EXECUTABLE: "/custom/claude",
    })

    expect(env.CLAUDE_CODE_EXECUTABLE).toBe("/custom/claude")
  })

  test("preserves the shared managed command environment for every ACP agent", async () => {
    const env = await acpSubprocessEnvironment(ACP_AGENT_REGISTRY.grok, "/managed/bin:/user/bin", {
      PATH: "/stale/bin",
      WANTA_OO_BIN: "/managed/bin/oo",
      WANTA_REAL_OO_BIN: "/real/bin/oo",
    })

    expect(env).toMatchObject({
      PATH: "/managed/bin:/user/bin",
      WANTA_OO_BIN: "/managed/bin/oo",
      WANTA_REAL_OO_BIN: "/real/bin/oo",
      WANTA_NODE_RUNTIME: process.execPath,
    })
  })

  test("fails clearly when the bridge runtime is unavailable", async () => {
    await expect(acpSubprocessEnvironment(ACP_AGENT_REGISTRY["claude-code"], "", {})).rejects.toThrow(
      "Claude Code CLI was not found on this machine",
    )
  })

  test("leaves agents without a delegated runtime unchanged", async () => {
    const env = await acpSubprocessEnvironment(ACP_AGENT_REGISTRY.grok, "/bin", { SAMPLE: "value" })

    expect(env).toMatchObject({ PATH: "/bin", SAMPLE: "value", WANTA_NODE_RUNTIME: process.execPath })
    expect(env.CLAUDE_CODE_EXECUTABLE).toBeUndefined()
  })
})
