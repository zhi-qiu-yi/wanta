import type { AgentPermissionMode, ChatPermissionReply, ChatPermissionRequest } from "../../chat/common.ts"
import type {
  AgentSendOptions,
  CancelAgentInput,
  PermissionResponseAgentInput,
  PromptAgentInput,
  SetEffortAgentInput,
  SetModelAgentInput,
} from "../contract/input.ts"
import type { AgentProfile } from "../contract/profile.ts"
import type { ExternalAgentRuntimeStatus, ExternalAgentCatalog } from "../external/status.ts"
import type { ChildProcessWithoutNullStreams } from "node:child_process"

import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createInterface } from "node:readline"
import { resolveUserCommandPath } from "../../command-path.ts"
import { errorMessage } from "../../diagnostics-log.ts"
import { AGENT_PERMISSION_MODE_ORDER, AGENT_PROFILES } from "../contract/profile.ts"
import { ExternalAgentAdapter } from "../external/adapter-base.ts"
import { externalAgentPromptText } from "../external/prompt.ts"

type JsonRpcMessage = {
  id?: string | number
  method?: string
  params?: any
  result?: any
  error?: { message?: string }
}

export interface CodexAppServerTransport {
  send(message: JsonRpcMessage): void
  close(): void
  onMessage(listener: (message: JsonRpcMessage) => void): () => void
  onClose(listener: (error?: Error) => void): () => void
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
}

/**
 * Codex app-server 的 JSONL 子进程传输层。
 * 这里只负责收发 JSON-RPC 帧，不夹带会话或业务状态。
 */
class JsonlTransport implements CodexAppServerTransport {
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>()
  private readonly closeListeners = new Set<(error?: Error) => void>()
  private readonly child: ChildProcessWithoutNullStreams
  private readonly readline: ReturnType<typeof createInterface>
  private closed = false

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
    this.readline = createInterface({ input: child.stdout })
    this.readline.on("line", (line) => {
      try {
        const message = JSON.parse(line) as JsonRpcMessage
        for (const listener of this.listeners) listener(message)
      } catch {
        // stdout 可能混入非协议内容；协议错误交给请求超时或进程退出处理。
      }
    })
    const close = (error?: Error): void => {
      if (this.closed) return
      this.closed = true
      this.readline.close()
      for (const listener of this.closeListeners) listener(error)
    }
    child.once("error", (error) => close(error))
    child.once("close", (code) =>
      close(code && code !== 0 ? new Error(`codex app-server exited (${code})`) : undefined),
    )
  }

  /** 向 app-server 写入一行 JSON-RPC 请求或响应。 */
  send(message: JsonRpcMessage): void {
    if (this.closed || !this.child.stdin.writable) throw new Error("codex app-server connection is closed")
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** 先优雅终止 Codex，超时后再强制结束，避免 Electron 退出时残留进程。 */
  close(): void {
    if (this.closed) return
    this.child.kill("SIGTERM")
    setTimeout(() => {
      if (!this.closed) this.child.kill("SIGKILL")
    }, 2_000)
  }

  /** 注册 JSON-RPC 帧监听器，并返回取消订阅函数。 */
  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 注册子进程关闭监听器。 */
  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }
}

interface ToolState {
  threadId: string
  turnId: string
  messageId: string
  tool: string
  input: Record<string, unknown>
}
/** Wanta 会话对应的 Codex turn 状态，用于把异步通知还原到正确消息。 */
interface TurnState {
  threadId: string
  turnId: string
  messageId?: string
  textByItem: Map<string, string>
  reasoningByItem: Map<string, string>
  tools: Map<string, ToolState>
  cancelling: boolean
}
interface PendingApproval {
  sessionId: string
  method: string
  resolve: (result: unknown) => void
}

interface CodexModelListEntry {
  id?: unknown
  displayName?: unknown
  description?: unknown
  hidden?: unknown
  isDefault?: unknown
  defaultReasoningEffort?: unknown
  supportedReasoningEfforts?: unknown
}

export interface CodexAppServerAdapterOptions {
  probe: () => Promise<ExternalAgentRuntimeStatus>
  scratchRootDir: string
  transcriptDir?: string
  commandEnvironment?: () => Promise<NodeJS.ProcessEnv>
  codexPath?: string
  connect?: () => Promise<CodexAppServerTransport>
}

/**
 * 通过官方 `codex app-server` JSONL API 接入 Codex。
 * 适配器把原生线程、turn、工具和审批事件转换成 Wanta 统一事件契约。
 */
export class CodexAppServerAdapter extends ExternalAgentAdapter {
  public readonly kind = "codex" as const
  public readonly profile: AgentProfile = AGENT_PROFILES.codex
  private readonly options: CodexAppServerAdapterOptions
  private transport?: CodexAppServerTransport
  private connectPromise?: Promise<CodexAppServerTransport>
  private requestSeq = 0
  private readonly requests = new Map<string | number, PendingRequest>()
  private readonly threads = new Map<string, string>()
  private readonly turns = new Map<string, TurnState>()
  private readonly pendingApprovals = new Map<string | number, PendingApproval>()
  private readonly desiredSelections = new Map<string, { model?: string; effort?: string }>()
  private readonly desiredModes = new Map<string, AgentPermissionMode>()
  private probeCache?: { at: number; promise: Promise<ExternalAgentRuntimeStatus> }
  private catalog?: ExternalAgentCatalog
  private catalogWarmup?: Promise<void>
  private catalogWarmupComplete = false

  constructor(options: CodexAppServerAdapterOptions) {
    super(options.transcriptDir ? { transcriptDir: options.transcriptDir } : {})
    this.options = options
  }

  /** 查询本机 Codex 状态，并在短时间内复用探测结果，避免频繁启动检查。 */
  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
    const now = Date.now()
    if (this.probeCache && now - this.probeCache.at < 30_000) return this.probeCache.promise
    const promise = this.options
      .probe()
      .then((status) => ({ ...status, ...(this.catalog ? { catalog: this.catalog } : {}) }))
    this.probeCache = { at: now, promise }
    promise.catch(() => {
      if (this.probeCache?.promise === promise) this.probeCache = undefined
    })
    return promise
  }

  /** 返回当前 Wanta 会话最后一次选择的 Codex 模型和思考强度。 */
  public sessionSelection(sessionId: string): { modelId?: string; effortId?: string } {
    const value = this.desiredSelections.get(sessionId) ?? {}
    return { ...(value.model ? { modelId: value.model } : {}), ...(value.effort ? { effortId: value.effort } : {}) }
  }

  /** app-server 的连接按需建立，因此启动适配器本身无需创建子进程。 */
  protected async handleStart(): Promise<void> {}

  /** 在首轮对话前读取 Codex 原生模型和 reasoning effort 目录。 */
  public override async warmCatalog(): Promise<void> {
    if (this.catalogWarmupComplete && this.catalog) return
    this.catalogWarmup ??= this.loadCatalog().finally(() => {
      this.catalogWarmup = undefined
    })
    await this.catalogWarmup
  }

  /** 关闭审批、turn 和传输状态，确保停止时没有悬挂的 UI 交互。 */
  protected async handleStop(): Promise<void> {
    for (const [id, approval] of this.pendingApprovals) {
      approval.resolve(this.cancelApprovalResult(approval.method))
      this.pendingApprovals.delete(id)
    }
    for (const turn of this.turns.values()) turn.cancelling = true
    this.transport?.close()
    this.transport = undefined
    this.connectPromise = undefined
    this.requests.clear()
    this.threads.clear()
    this.turns.clear()
  }

  /** 创建或复用线程，并把一轮用户输入提交给 Codex。 */
  protected async handlePrompt(input: PromptAgentInput, options?: AgentSendOptions): Promise<void> {
    // 调用方已经取消时不启动线程，避免产生无法归属的原生 turn。
    if (options?.signal?.aborted) return
    if (input.agentModelId || input.agentEffortId) {
      const selected = this.desiredSelections.get(input.sessionId) ?? {}
      if (input.agentModelId) selected.model = input.agentModelId
      if (input.agentEffortId) selected.effort = input.agentEffortId
      this.desiredSelections.set(input.sessionId, selected)
    }
    await this.ensureConnection()
    const threadId = await this.ensureThread(input)
    const selected = this.desiredSelections.get(input.sessionId)
    const result = await this.request("turn/start", {
      threadId,
      input: this.promptInput(input),
      ...(input.workingDirectory ? { cwd: input.workingDirectory } : {}),
      ...(selected?.model ? { model: selected.model } : {}),
      ...(selected?.effort ? { effort: selected.effort } : {}),
      ...this.turnPolicy(this.desiredModes.get(input.sessionId), input.workingDirectory, input.additionalDirectories),
    })
    const turnId = result?.turn?.id ?? result?.id
    if (typeof turnId !== "string") throw new Error("codex app-server did not return a turn id")
    // 某些版本可能先发 turn/started 通知再返回响应，优先保留已收到的流状态。
    const turn =
      this.turns.get(input.sessionId)?.turnId === turnId
        ? this.turns.get(input.sessionId)!
        : {
            threadId,
            turnId,
            textByItem: new Map(),
            reasoningByItem: new Map(),
            tools: new Map(),
            cancelling: false,
          }
    this.turns.set(input.sessionId, turn)
    this.emitUserTurn(input)
    options?.onDispatch?.()
    if (options?.signal)
      options.signal.addEventListener(
        "abort",
        () => {
          void this.interrupt(input.sessionId)
        },
        { once: true },
      )
  }

  /** 将取消请求映射为当前 Codex turn 的 interrupt。 */
  protected async handleCancel(input: CancelAgentInput): Promise<void> {
    await this.interrupt(input.sessionId)
  }

  /** 把 Wanta 的审批结果回复给 app-server 的原始请求。 */
  protected async handlePermissionResponse(input: PermissionResponseAgentInput): Promise<void> {
    const pending = this.pendingApprovals.get(String(input.requestId))
    if (!pending) throw new Error(`${this.kind}: unknown permission request ${input.requestId}`)
    this.pendingApprovals.delete(String(input.requestId))
    pending.resolve(this.approvalResult(pending.method, input.reply))
    this.emit({
      event: "permissionReplied",
      data: { sessionId: pending.sessionId, requestId: String(input.requestId) },
    })
  }

  /** 保存下一轮 turn 要使用的模型选择。 */
  protected async handleSetModel(input: SetModelAgentInput): Promise<void> {
    const value = this.desiredSelections.get(input.sessionId) ?? {}
    if (input.modelId) value.model = input.modelId
    else delete value.model
    this.desiredSelections.set(input.sessionId, value)
  }

  /** 保存下一轮 turn 要使用的 reasoning effort。 */
  protected async handleSetEffort(input: SetEffortAgentInput): Promise<void> {
    const value = this.desiredSelections.get(input.sessionId) ?? {}
    if (input.effortId) value.effort = input.effortId
    else delete value.effort
    this.desiredSelections.set(input.sessionId, value)
  }

  /** 保存 Wanta 权限模式，具体策略会在 thread/turn/start 时投影到 Codex。 */
  public async applyPermissionMode(sessionId: string, mode: AgentPermissionMode): Promise<void> {
    if (!AGENT_PERMISSION_MODE_ORDER.includes(mode))
      throw new Error(`${this.kind}: unsupported permission mode ${mode}`)
    this.desiredModes.set(sessionId, mode)
  }

  /** 删除会话时同步清理线程、选择和权限模式缓存。 */
  protected override handleForgetSession(sessionId: string): void {
    this.desiredSelections.delete(sessionId)
    this.desiredModes.delete(sessionId)
    this.threads.delete(sessionId)
    this.turns.delete(sessionId)
  }

  /** 构造 Codex 的文本和本地图片输入项；图片只传路径，不内联文件内容。 */
  private promptInput(input: PromptAgentInput): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [
      { type: "text", text: externalAgentPromptText(input), text_elements: [] },
    ]
    for (const attachment of input.attachments ?? []) {
      const file = attachment.agentPath?.trim() || attachment.path
      result.push({ type: "localImage", path: file })
    }
    return result
  }

  /** 将 Wanta 权限模式映射到 Codex 的 approvalPolicy/sandboxPolicy。 */
  private turnPolicy(
    mode: AgentPermissionMode | undefined,
    cwd?: string,
    additionalDirectories?: readonly string[],
  ): Record<string, unknown> {
    const writableRoots = [
      ...new Set([cwd, ...(additionalDirectories ?? [])].filter((root): root is string => Boolean(root))),
    ]
    switch (mode) {
      // 完全开放模式由 Codex 直接放开审批和沙箱。
      case "full_access":
        return { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } }
      // 只读和计划模式禁止写入，同时保留敏感操作审批。
      case "read_only":
        return { approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } }
      // 接受编辑只允许写入当前工作区和 Wanta 管理目录。
      case "accept_edits":
        return {
          approvalPolicy: "on-request",
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots,
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
        }
      // 计划模式与只读模式共享只读沙箱，但保留审批提示。
      case "plan":
        return { approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } }
      // auto 沿用工作区沙箱，但不再弹出逐次审批。
      case "auto":
        return {
          approvalPolicy: "never",
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots,
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
        }
      // 未选择模式时只指定审批策略，保留 Codex 默认沙箱。
      default:
        return { approvalPolicy: "on-request" }
    }
  }

  /** 查找现有线程或按当前工作目录创建一个新线程。 */
  private async ensureThread(input: PromptAgentInput): Promise<string> {
    const existing = this.threads.get(input.sessionId)
    // 一个 Wanta 会话复用同一个 Codex thread，保证上下文连续。
    if (existing) return existing
    const cwd = input.workingDirectory ?? input.outputProjectRoot ?? (await this.ensureScratchDir(input.sessionId))
    const mode = this.desiredModes.get(input.sessionId)
    const result = await this.request("thread/start", {
      cwd,
      ...(mode ? this.threadStartPolicy(mode) : {}),
    })
    const threadId = result?.thread?.id
    if (typeof threadId !== "string") throw new Error("codex app-server did not return a thread id")
    this.threads.set(input.sessionId, threadId)
    return threadId
  }

  /** 构造首次 thread/start 所需的持久权限和沙箱策略。 */
  private threadStartPolicy(mode: AgentPermissionMode): Record<string, unknown> {
    switch (mode) {
      // thread/start 使用短横线枚举；turn/start 则使用结构化 sandboxPolicy。
      case "full_access":
        return { approvalPolicy: "never", sandbox: "danger-full-access" }
      case "accept_edits":
      case "auto":
        return { approvalPolicy: mode === "auto" ? "never" : "on-request", sandbox: "workspace-write" }
      case "read_only":
      case "plan":
        return { approvalPolicy: "on-request", sandbox: "read-only" }
      default:
        return { approvalPolicy: "on-request" }
    }
  }

  /** 分页读取 Codex 模型目录，并转换为 Wanta 的模型/effort 展示格式。 */
  private async loadCatalog(): Promise<void> {
    try {
      await this.ensureConnection()
      const entries: CodexModelListEntry[] = []
      let cursor: string | undefined
      const seenCursors = new Set<string>()
      let hasNext = true
      while (hasNext) {
        const result = await this.request("model/list", {
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        })
        if (Array.isArray(result?.data)) entries.push(...(result.data as CodexModelListEntry[]))
        const next = typeof result?.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : null
        // 服务端异常返回重复 cursor 时立即停止，避免目录加载死循环。
        if (!next || seenCursors.has(next)) {
          hasNext = false
          continue
        }
        seenCursors.add(next)
        cursor = next
      }
      const models = entries
        .filter((entry) => typeof entry.id === "string" && entry.id && entry.hidden !== true)
        .map((entry) => ({
          id: entry.id as string,
          label: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : (entry.id as string),
          ...(typeof entry.description === "string" && entry.description ? { description: entry.description } : {}),
        }))
      const defaultEntry =
        entries.find((entry) => entry.isDefault === true && typeof entry.id === "string") ??
        entries.find((entry) => typeof entry.id === "string")
      const effortMap = new Map<string, ExternalAgentCatalog["efforts"][number]>()
      for (const entry of entries) {
        if (!Array.isArray(entry.supportedReasoningEfforts)) continue
        for (const raw of entry.supportedReasoningEfforts) {
          // 目录中可能存在未公开或不完整的 effort 描述，忽略无效项。
          if (!raw || typeof raw !== "object") continue
          const effort = raw as { reasoningEffort?: unknown; description?: unknown }
          if (typeof effort.reasoningEffort !== "string" || !effort.reasoningEffort) continue
          effortMap.set(effort.reasoningEffort, {
            id: effort.reasoningEffort,
            label: effort.reasoningEffort,
            ...(typeof effort.description === "string" && effort.description
              ? { description: effort.description }
              : {}),
          })
        }
      }
      const defaultEffort =
        typeof defaultEntry?.defaultReasoningEffort === "string" ? defaultEntry.defaultReasoningEffort : undefined
      if (models.length > 0) {
        this.catalog = {
          models,
          efforts: [...effortMap.values()],
          ...(typeof defaultEntry?.id === "string" ? { defaultModelId: defaultEntry.id } : {}),
          ...(defaultEffort ? { defaultEffortId: defaultEffort } : {}),
        }
        this.catalogWarmupComplete = true
        this.probeCache = undefined
      }
    } catch (error) {
      // 目录只是 UI 增强能力，失败时仍允许 Codex 使用其默认模型继续对话。
      this.catalogWarmupComplete = false
      console.warn(`[wanta] failed to load Codex model catalog: ${errorMessage(error)}`)
    }
  }

  /** 创建当前会话专属的临时工作目录。 */
  private async ensureScratchDir(sessionId: string): Promise<string> {
    const directory = path.join(this.options.scratchRootDir, sessionId)
    await mkdir(directory, { recursive: true })
    return directory
  }

  /** 向 Codex 发送一次中断请求；重复取消不会重复触发 interrupt。 */
  private async interrupt(sessionId: string): Promise<void> {
    const turn = this.turns.get(sessionId)
    if (!turn || turn.cancelling) return
    turn.cancelling = true
    await this.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId }).catch(() => undefined)
  }

  /** 并发首轮请求共享同一条 app-server 连接。 */
  private async ensureConnection(): Promise<CodexAppServerTransport> {
    if (this.transport) return this.transport
    this.connectPromise ??= this.openConnection()
    try {
      return await this.connectPromise
    } finally {
      this.connectPromise = undefined
    }
  }

  /** 建立监听器、完成 initialize 握手，并发送 initialized 通知。 */
  private async openConnection(): Promise<CodexAppServerTransport> {
    const transport = this.options.connect ? await this.options.connect() : await this.spawnTransport()
    transport.onMessage((message) => this.onMessage(message))
    transport.onClose((error) => this.onConnectionLost(error))
    this.transport = transport
    await this.request("initialize", { clientInfo: { name: "wanta", title: "Wanta", version: "0.0.0" } })
    transport.send({ method: "initialized", params: {} })
    return transport
  }

  /** 启动用户本机的 `codex app-server` 子进程。 */
  private async spawnTransport(): Promise<CodexAppServerTransport> {
    const status = await this.runtimeStatus()
    if (status.binary.status !== "detected") throw new Error("Codex CLI was not found on this machine")
    const env = this.options.commandEnvironment
      ? await this.options.commandEnvironment()
      : { ...process.env, PATH: await resolveUserCommandPath() }
    const child = spawn(this.options.codexPath ?? status.binary.path, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    })
    child.stderr?.resume()
    return new JsonlTransport(child)
  }

  /** 发送带 id 的 JSON-RPC 请求，并等待对应的 result/error 响应。 */
  private request(method: string, params: unknown): Promise<any> {
    const transport = this.transport
    if (!transport) return Promise.reject(new Error("codex app-server connection is unavailable"))
    const id = ++this.requestSeq
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject })
      try {
        transport.send({ id, method, params })
      } catch (error) {
        this.requests.delete(id)
        reject(error)
      }
    })
  }

  /** 区分请求响应、服务端请求和单向通知，分发到对应处理路径。 */
  private onMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.requests.get(message.id)
      if (!pending) return
      this.requests.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? "Codex app-server request failed"))
      else pending.resolve(message.result)
      return
    }
    if (message.method) {
      // 带 id 的 method 是 Codex 发给宿主的审批等服务端请求。
      if (message.id !== undefined) {
        void this.onServerRequest(message)
        return
      }
      this.onNotification(message.method, message.params)
    }
  }

  /** 把 Codex 通知转换为 Wanta 的消息、工具、usage 和完成事件。 */
  private onNotification(method: string, params: any): void {
    const threadId = params?.threadId as string | undefined
    const sessionId = threadId ? [...this.threads.entries()].find(([, id]) => id === threadId)?.[0] : undefined
    // 未知 thread 可能来自已删除会话，必须丢弃，不能污染其他会话。
    if (!sessionId) return
    const resolvedThreadId = threadId
    if (!resolvedThreadId) return
    let turn = this.turns.get(sessionId)
    if (method === "turn/started" && params?.turn?.id) {
      const startedTurnId = String(params.turn.id)
      if (!turn || turn.turnId !== startedTurnId) {
        turn = {
          threadId: resolvedThreadId,
          turnId: startedTurnId,
          textByItem: new Map(),
          reasoningByItem: new Map(),
          tools: new Map(),
          cancelling: false,
        }
        this.turns.set(sessionId, turn)
      }
      return
    }
    if (method === "item/agentMessage/delta" && turn) {
      const itemId = String(params.itemId)
      const text = (turn.textByItem.get(itemId) ?? "") + String(params.delta ?? "")
      turn.textByItem.set(itemId, text)
      const messageId = this.ensureAssistantMessage(sessionId, turn)
      this.emit({
        event: "messageDelta",
        data: { sessionId, messageId, partId: itemId, text, delta: String(params.delta ?? "") },
      })
      return
    }
    if ((method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") && turn) {
      const itemId = String(params.itemId)
      const delta = String(params.delta ?? "")
      const text = (turn.reasoningByItem.get(itemId) ?? "") + delta
      turn.reasoningByItem.set(itemId, text)
      const messageId = this.ensureAssistantMessage(sessionId, turn)
      this.emit({ event: "messageReasoningDelta", data: { sessionId, messageId, partId: itemId, text, delta } })
      return
    }
    if (method === "item/started") {
      this.handleItem(sessionId, turn, params?.item, true)
      return
    }
    if (method === "item/completed") {
      this.handleItem(sessionId, turn, params?.item, false)
      return
    }
    if (method === "thread/tokenUsage/updated") {
      this.emitUsage(sessionId, params?.tokenUsage)
      return
    }
    if (method === "turn/completed") {
      const status = params?.turn?.status
      // failed 只报告一次；正常完成由统一 messageCompleted 收尾。
      if (status === "failed")
        this.emit({
          event: "agentError",
          data: { sessionId, message: params?.turn?.error?.message ?? "Codex turn failed" },
        })
      this.emit({ event: "messageCompleted", data: { sessionId } })
      this.turns.delete(sessionId)
      return
    }
    if (method === "error" && params?.error) {
      // Codex 自动重试期间先不打断 UI，只有最终错误才展示给用户。
      if (params.willRetry !== true) {
        this.emit({ event: "agentError", data: { sessionId, message: params.error.message ?? "Codex turn failed" } })
      }
    }
  }

  /** 确保 reasoning 或文本流首次到达时已经创建 assistant 消息。 */
  private ensureAssistantMessage(sessionId: string, turn: TurnState): string {
    const messageId = turn.messageId ?? `codex-${turn.turnId}`
    if (!turn.messageId) {
      turn.messageId = messageId
      this.emit({ event: "messageStarted", data: { sessionId, messageId, role: "assistant" } })
    }
    return messageId
  }

  /** 将 item/started 与 item/completed 映射为统一的工具调用生命周期事件。 */
  private handleItem(sessionId: string, turn: TurnState | undefined, item: any, started: boolean): void {
    if (!turn || !item || typeof item.id !== "string") return
    // 文本、推理和计划 item 已由专用通知处理，避免重复创建工具卡片。
    if (
      item.type === "agentMessage" ||
      item.type === "userMessage" ||
      item.type === "reasoning" ||
      item.type === "plan"
    )
      return
    const tool = item.type
    const input = this.toolInput(item)
    if (started) {
      const state = {
        threadId: turn.threadId,
        turnId: turn.turnId,
        messageId: turn.messageId ?? `codex-${turn.turnId}`,
        tool,
        input,
      }
      turn.tools.set(item.id, state)
      this.emit({
        event: "toolCallStarted",
        data: {
          sessionId,
          messageId: state.messageId,
          partId: item.id,
          callId: item.id,
          tool,
          input,
          status: "running",
          title: tool,
        },
      })
    } else {
      const state = turn.tools.get(item.id)
      const messageId = state?.messageId ?? turn.messageId ?? `codex-${turn.turnId}`
      const status = item.status === "failed" || item.status === "declined" ? "error" : "completed"
      this.emit({
        event: "toolCallResult",
        data: {
          sessionId,
          messageId,
          partId: item.id,
          callId: item.id,
          tool: state?.tool ?? tool,
          status,
          input: state?.input ?? input,
          ...(item.aggregatedOutput ? { output: item.aggregatedOutput } : {}),
          ...(status === "error" ? { error: item.error ?? "Tool failed" } : {}),
        },
      })
      turn.tools.delete(item.id)
    }
  }

  /** 提取不同 Codex 工具 item 的稳定输入摘要，供 UI 和 transcript 使用。 */
  private toolInput(item: any): Record<string, unknown> {
    if (item.type === "commandExecution") return { command: item.command, cwd: item.cwd }
    if (item.type === "fileChange") return { changes: item.changes }
    if (item.type === "mcpToolCall") return { server: item.server, tool: item.tool, arguments: item.arguments }
    if (item.type === "dynamicToolCall") return { tool: item.tool, arguments: item.arguments }
    return {}
  }

  /** 把 Codex token usage 归一化为 Wanta 的上下文计量结构。 */
  private emitUsage(sessionId: string, usage: any): void {
    const last = usage?.last ?? usage?.total ?? {}
    this.emit({
      event: "usageUpdated",
      data: {
        sessionId,
        tokenUsage: {
          total: last.totalTokens,
          input: last.inputTokens ?? 0,
          output: last.outputTokens ?? 0,
          reasoning: last.reasoningOutputTokens ?? 0,
          cache: { read: last.cachedInputTokens ?? 0, write: last.cacheWriteInputTokens ?? 0 },
          ...(usage?.modelContextWindow ? { contextWindow: usage.modelContextWindow } : {}),
        },
      },
    })
  }

  /** 处理 Codex 发起的审批或用户输入请求，并转成 Wanta 交互事件。 */
  private async onServerRequest(message: JsonRpcMessage): Promise<void> {
    const method = message.method ?? ""
    const params = message.params ?? {}
    const sessionId = [...this.threads.entries()].find(([, id]) => id === params.threadId)?.[0]
    // 会话已不存在时不回复业务结果，防止已删除任务继续执行。
    if (!sessionId || message.id === undefined) return
    if (method === "item/tool/requestUserInput") {
      // 当前 Wanta 没有 Codex 专用问答通道，空答案让 Codex 自己结束该请求。
      this.respond(message.id, { answers: [] })
      return
    }
    if (
      ![
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/permissions/requestApproval",
      ].includes(method)
    ) {
      // 对未知服务端请求返回空对象，保持 JSON-RPC 通道可用但不授予权限。
      this.respond(message.id, {})
      return
    }
    const requestId = String(message.id)
    const request: ChatPermissionRequest = {
      id: requestId,
      sessionId,
      action: params.command ?? (method.includes("fileChange") ? "file change" : "permission"),
      resources: [params.cwd, params.grantRoot].filter((value): value is string => typeof value === "string"),
      metadata: { method, raw: params },
    }
    this.pendingApprovals.set(String(message.id), {
      sessionId,
      method,
      resolve: (result) => this.respond(message.id!, result),
    })
    this.emit({ event: "permissionAsked", data: { sessionId, request } })
  }

  /** 回写审批结果或其他 JSON-RPC 服务端响应。 */
  private respond(id: string | number, result: unknown): void {
    this.transport?.send({ id, result })
  }

  /** 将 Wanta 的 once/always/reject 映射为 Codex 审批决定。 */
  private approvalResult(method: string, reply: ChatPermissionReply): unknown {
    const decision =
      reply === "reject"
        ? method.includes("permissions")
          ? "cancel"
          : "decline"
        : reply === "always"
          ? "acceptForSession"
          : "accept"
    if (method.includes("permissions")) return { permissions: {}, scope: reply === "always" ? "session" : "turn" }
    return { decision }
  }

  /** 适配器停止时拒绝尚未处理的 Codex 审批请求。 */
  private cancelApprovalResult(method: string): unknown {
    return this.approvalResult(method, "reject")
  }

  /** 连接异常时拒绝挂起请求并结束相关 turn，避免 UI 永久等待。 */
  private onConnectionLost(error?: Error): void {
    if (this.transport) this.transport = undefined
    for (const pending of this.requests.values())
      pending.reject(error ?? new Error("Codex app-server exited unexpectedly"))
    this.requests.clear()
    for (const [sessionId, turn] of this.turns) {
      if (!turn.cancelling)
        this.emit({
          event: "agentError",
          data: { sessionId, message: errorMessage(error ?? new Error("Codex app-server exited unexpectedly")) },
        })
    }
    this.turns.clear()
    this.threads.clear()
  }
}
