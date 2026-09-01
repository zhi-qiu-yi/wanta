import assert from "node:assert/strict"
import { test } from "vitest"
import { externalExecutableNeedsShell } from "./executable.ts"

test("only Windows command shims require a shell", () => {
  assert.equal(externalExecutableNeedsShell("C:\\app\\agent-bridge.cmd", "win32"), true)
  assert.equal(externalExecutableNeedsShell("C:\\app\\agent-bridge.BAT", "win32"), true)
  assert.equal(externalExecutableNeedsShell("C:\\app\\agent-bridge.exe", "win32"), false)
  assert.equal(externalExecutableNeedsShell("/app/agent-bridge", "darwin"), false)
})
