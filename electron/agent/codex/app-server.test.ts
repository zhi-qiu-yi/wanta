import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentRuntimeStatus } from "../external/status.ts"
import type { CodexAppServerTransport } from "./app-server.ts"

import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { CodexAppServerAdapter } from "./app-server.ts"

/** 用内存消息队列模拟 Codex app-server，避免单元测试启动真实 CLI。 */
class FakeTransport implements CodexAppServerTransport {
  readonly sent: Array<Record<string, unknown>> = []
  private messageListener?: (message: any) => void
  private closeListener?: (error?: Error) => void
  send(message: any): void {
    this.sent.push(message)
    if (message.method === "initialize") queueMicrotask(() => this.messageListener?.({ id: message.id, result: {} }))
    if (message.method === "thread/start")
      queueMicrotask(() => this.messageListener?.({ id: message.id, result: { thread: { id: "thr-1" } } }))
    if (message.method === "turn/start")
      queueMicrotask(() => this.messageListener?.({ id: message.id, result: { turn: { id: "turn-1" } } }))
    if (message.method === "turn/interrupt")
      queueMicrotask(() => this.messageListener?.({ id: message.id, result: {} }))
    if (message.method === "model/list")
      queueMicrotask(() =>
        this.messageListener?.({
          id: message.id,
          result: {
            data: [
              {
                id: "gpt-5.6-terra",
                displayName: "GPT-5.6 Terra",
                description: "Codex model",
                isDefault: true,
                hidden: false,
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "Fast" },
                  { reasoningEffort: "medium", description: "Balanced" },
                ],
              },
              {
                id: "hidden-model",
                displayName: "Hidden",
                isDefault: false,
                hidden: true,
                defaultReasoningEffort: "low",
                supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }],
              },
            ],
            nextCursor: null,
          },
        }),
      )
  }
  close(): void {
    this.closeListener?.()
  }
  onMessage(listener: (message: any) => void): () => void {
    this.messageListener = listener
    return () => {
      this.messageListener = undefined
    }
  }
  onClose(listener: (error?: Error) => void): () => void {
    this.closeListener = listener
    return () => {
      this.closeListener = undefined
    }
  }
  notify(method: string, params: unknown): void {
    this.messageListener?.({ method, params })
  }
  request(method: string, id: number, params: unknown): void {
    this.messageListener?.({ method, id, params })
  }
}

const status: ExternalAgentRuntimeStatus = {
  kind: "codex",
  displayName: "Codex",
  binary: { status: "detected", path: "/usr/bin/codex", version: "0.149.1" },
  login: { status: "logged_in" },
  loginHint: "",
}

describe("CodexAppServerAdapter", () => {
  test("performs app-server handshake and streams a turn", async () => {
    const transport = new FakeTransport()
    const adapter = new CodexAppServerAdapter({
      probe: async () => status,
      scratchRootDir: "/tmp/wanta-codex-test",
      connect: async () => transport,
    })
    const events: AgentEvent[] = []
    adapter.onEvent((event) => events.push(event))
    await adapter.start()
    await adapter.send({ type: "prompt", sessionId: "session-1", text: "hello" })
    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
    ])
    transport.notify("turn/started", { threadId: "thr-1", turn: { id: "turn-1" } })
    transport.notify("item/agentMessage/delta", { threadId: "thr-1", turnId: "turn-1", itemId: "item-1", delta: "hi" })
    transport.notify("item/started", {
      threadId: "thr-1",
      turnId: "turn-1",
      item: { id: "cmd-1", type: "commandExecution", command: "pwd", cwd: "/tmp", status: "inProgress" },
    })
    transport.notify("item/completed", {
      threadId: "thr-1",
      turnId: "turn-1",
      item: {
        id: "cmd-1",
        type: "commandExecution",
        command: "pwd",
        cwd: "/tmp",
        status: "completed",
        aggregatedOutput: "/tmp",
      },
    })
    transport.notify("turn/completed", { threadId: "thr-1", turn: { id: "turn-1", status: "completed" } })
    expect(events.map((event) => event.event)).toEqual([
      "messageStarted",
      "messageDelta",
      "messageStarted",
      "messageDelta",
      "toolCallStarted",
      "toolCallResult",
      "messageCompleted",
    ])
    expect(events.find((event) => event.event === "messageDelta" && event.data.delta === "hi")).toMatchObject({
      data: { text: "hi", delta: "hi" },
    })
    expect(events.find((event) => event.event === "toolCallStarted")).toMatchObject({
      data: { tool: "bash", input: { command: "pwd", cwd: "/tmp" } },
    })
    expect(events.find((event) => event.event === "toolCallResult")).toMatchObject({
      data: { tool: "bash", output: "/tmp" },
    })
    await adapter.stop()
  })

  test("normalizes native tool item names before emitting UI events", async () => {
    const transport = new FakeTransport()
    const adapter = new CodexAppServerAdapter({
      probe: async () => status,
      scratchRootDir: "/tmp/wanta-codex-test",
      connect: async () => transport,
    })
    const events: AgentEvent[] = []
    adapter.onEvent((event) => events.push(event))
    await adapter.start()
    await adapter.send({ type: "prompt", sessionId: "session-1", text: "work" })
    transport.notify("turn/started", { threadId: "thr-1", turn: { id: "turn-1" } })

    const items = [
      { id: "command", type: "commandExecution", command: "pwd", cwd: "/tmp", status: "inProgress" },
      {
        id: "file",
        type: "fileChange",
        changes: [{ path: "/tmp/new.ts", kind: { type: "add" }, diff: "+export {}" }],
        status: "inProgress",
      },
      {
        id: "mcp",
        type: "mcpToolCall",
        server: "wanta_link",
        tool: "call_action",
        arguments: { service: "github", action: "list_repos" },
        status: "inProgress",
      },
      {
        id: "dynamic",
        type: "dynamicToolCall",
        tool: "query_knowledge",
        arguments: { query: "release notes" },
        status: "inProgress",
      },
    ]
    for (const item of items) {
      transport.notify("item/started", { threadId: "thr-1", turnId: "turn-1", item })
    }
    transport.notify("item/started", {
      threadId: "thr-1",
      turnId: "turn-1",
      item: { id: "compaction", type: "contextCompaction" },
    })

    const started = events.filter((event) => event.event === "toolCallStarted")
    expect(started.map((event) => (event.event === "toolCallStarted" ? event.data.tool : ""))).toEqual([
      "bash",
      "write",
      "call_action",
      "query_knowledge",
    ])
    expect(started[2]).toMatchObject({
      data: {
        title: "wanta_link.call_action",
        input: { service: "github", action: "list_repos" },
      },
    })
    expect(started.some((event) => event.event === "toolCallStarted" && event.data.tool === "contextCompaction")).toBe(
      false,
    )
    await adapter.stop()
  })

  test("normalizes native tool names restored from older transcripts", async () => {
    const transcriptDir = await mkdtemp(path.join(os.tmpdir(), "wanta-codex-transcript-"))
    const sessionId = "session-1"
    await writeFile(
      path.join(transcriptDir, `${sessionId}.json`),
      JSON.stringify({
        version: 1,
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            createdAt: 1,
            finishReason: "stop",
            parts: [
              {
                kind: "tool",
                partId: "command-1",
                callId: "command-1",
                tool: "commandExecution",
                title: "commandExecution",
                status: "completed",
                input: { command: "pwd", cwd: "/tmp" },
              },
            ],
          },
        ],
      }),
      "utf8",
    )
    const adapter = new CodexAppServerAdapter({
      probe: async () => status,
      scratchRootDir: "/tmp/wanta-codex-test",
      transcriptDir,
      connect: async () => new FakeTransport(),
    })

    const messages = await adapter.getMessages(sessionId)
    expect(messages[0]?.parts[0]).toMatchObject({
      kind: "tool",
      tool: "bash",
      input: { command: "pwd", cwd: "/tmp" },
    })
    expect(messages[0]?.parts[0]).not.toHaveProperty("title")
    await adapter.stop()
  })

  test("bridges approval requests and cancellation", async () => {
    const transport = new FakeTransport()
    const adapter = new CodexAppServerAdapter({
      probe: async () => status,
      scratchRootDir: "/tmp/wanta-codex-test",
      connect: async () => transport,
    })
    const events: AgentEvent[] = []
    adapter.onEvent((event) => events.push(event))
    await adapter.start()
    await adapter.send({ type: "prompt", sessionId: "session-1", text: "run" })
    transport.request("item/commandExecution/requestApproval", 90, {
      threadId: "thr-1",
      turnId: "turn-1",
      itemId: "cmd-1",
      command: "rm file",
      cwd: "/tmp",
    })
    const asked = events.find((event) => event.event === "permissionAsked")
    expect(asked).toBeTruthy()
    await adapter.send({ type: "permission-response", sessionId: "session-1", requestId: "90", reply: "once" })
    expect(transport.sent.at(-1)).toMatchObject({ id: 90, result: { decision: "accept" } })
    transport.notify("turn/started", { threadId: "thr-1", turn: { id: "turn-2" } })
    await adapter.send({ type: "cancel", sessionId: "session-1" })
    expect(transport.sent.at(-1)).toMatchObject({ method: "turn/interrupt", params: { threadId: "thr-1" } })
    await adapter.stop()
  })

  test("warms the native model and effort catalog", async () => {
    const transport = new FakeTransport()
    const adapter = new CodexAppServerAdapter({
      probe: async () => status,
      scratchRootDir: "/tmp/wanta-codex-test",
      connect: async () => transport,
    })
    await adapter.start()
    await adapter.warmCatalog()
    const runtime = await adapter.runtimeStatus()
    expect(transport.sent.map((message) => message.method)).toEqual(["initialize", "initialized", "model/list"])
    expect(runtime.catalog).toEqual({
      models: [{ id: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "Codex model" }],
      efforts: [
        { id: "low", label: "low", description: "Fast" },
        { id: "medium", label: "medium", description: "Balanced" },
      ],
      defaultModelId: "gpt-5.6-terra",
      defaultEffortId: "medium",
    })
    await adapter.stop()
  })

  test("maps managed roots to workspace-write policy and applies first-turn selections", async () => {
    const transport = new FakeTransport()
    const adapter = new CodexAppServerAdapter({
      probe: async () => status,
      scratchRootDir: "/tmp/wanta-codex-test",
      connect: async () => transport,
    })
    await adapter.start()
    await adapter.applyPermissionMode("session-1", "accept_edits")
    await adapter.send({
      type: "prompt",
      sessionId: "session-1",
      text: "hello",
      workingDirectory: "/project",
      additionalDirectories: ["/artifact", "/process"],
      agentModelId: "gpt-5.6-terra",
      agentEffortId: "high",
    })
    const threadStart = transport.sent.find((message) => message.method === "thread/start")
    const turnStart = transport.sent.find((message) => message.method === "turn/start")
    expect(threadStart).not.toHaveProperty("params.runtimeWorkspaceRoots")
    expect(threadStart).not.toHaveProperty("params.developerInstructions")
    expect(turnStart).not.toHaveProperty("params.runtimeWorkspaceRoots")
    expect(turnStart).not.toHaveProperty("params.collaborationMode")
    expect(turnStart).toMatchObject({
      params: {
        model: "gpt-5.6-terra",
        effort: "high",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/project", "/artifact", "/process"],
        },
      },
    })
    await adapter.stop()
  })
})
