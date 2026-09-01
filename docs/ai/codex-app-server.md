# Codex app-server 接入与维护指南

> 修改 `electron/agent/codex/`、Codex 工具展示、Codex transcript 恢复或 assistant 时间线时，先读本文。通用 BYOA 契约见 [agent-adapter.md](agent-adapter.md)，宿主能力边界见 [host-capabilities.md](host-capabilities.md)。

## 1. 背景与边界

Codex 已从 ACP 兼容路径迁移到官方原生 `codex app-server`。当前边界是：

- Codex 只走 `codex app-server`，没有 ACP 注册项、桥接器或回退分支。
- Claude Code 和 Grok 仍可走通用 ACP 适配层；不要因为清理 Codex ACP 代码而删除它们需要的公共实现。
- Wanta 继续以 `AgentInput` / `AgentEvent` 为统一契约。app-server 的 JSON-RPC 类型、原生 item 名称和审批结果不能泄漏到 renderer 的业务逻辑。
- Codex 使用用户本机 CLI 的登录态、模型目录和计费账户。Wanta 不注入账号 token、BYOK key、模型别名或 provider endpoint。

迁移的核心收益不是少一层进程，而是让 Codex 的线程、turn、item、模型和审批语义直接对齐官方协议，避免 ACP 桥接层追赶 Codex 私有能力。

## 2. 代码结构

```text
ChatService / ExternalAgentAdapter
        |
        | AgentInput / AgentEvent
        v
CodexAppServerAdapter                 electron/agent/codex/app-server.ts
        |
        | JSON-RPC, one JSON object per line
        v
codex app-server subprocess
        |
        +--> ExternalTranscriptRecorder / Store
        |    electron/agent/external/transcript*.ts
        |
        +--> assistant timeline
             src/routes/Chat/assistant-timeline.ts
```

主要文件：

| 文件 | 职责 |
| --- | --- |
| `electron/agent/codex/app-server.ts` | 子进程传输、握手、thread/turn 管理、事件和审批转换、模型目录、权限策略 |
| `electron/agent/external/create.ts` | 组装原生 Codex adapter；ACP registry 只组装其他 agent |
| `electron/agent/external/adapter-base.ts` | 统一事件记录、transcript 持久化、会话删除和恢复 |
| `electron/agent/contract/` | Wanta 的 adapter 输入、输出和 capability 契约 |
| `src/routes/Chat/assistant-timeline.ts` | 把持久化消息拆成“处理过程”和“最终回答” |
| `electron/agent/codex/app-server.test.ts` | app-server 协议转换和回归测试 |
| `src/routes/Chat/assistant-timeline.test.ts` | 多工具、多段文本的时间线回归测试 |

## 3. 连接与请求生命周期

`CodexAppServerAdapter` 在首次需要时才建立共享连接：

1. 探测用户本机 `codex` 可执行文件。
2. 启动 `codex app-server`，stdio 均使用 pipe。
3. 发送 `initialize` 请求。
4. 收到响应后发送 `initialized` 通知。
5. 后续请求复用同一传输；并发首轮连接通过 `connectPromise` 合并。

`JsonlTransport` 只负责 JSONL 帧，不保存会话业务状态。stdout 的每一行独立解析为 JSON；非 JSON 行会被忽略，stderr 被持续消费，避免子进程因管道写满而阻塞。

JSON-RPC 消息分三类：

- 请求响应：带 `id` 且包含 `result` 或 `error`，交给 `requests` 表中对应 Promise。
- 服务端请求：同时带 `id` 和 `method`，用于审批或向用户提问，必须回写同一个 `id`。
- 通知：只有 `method`，用于 turn、item、usage 和错误流。

连接关闭时要拒绝全部挂起请求、结束所有 turn 并清理 thread 映射，否则 UI 会永久停在运行中。正常停止还要拒绝尚未回复的审批，并先 `SIGTERM`，超时后再 `SIGKILL`。

## 4. Thread、turn 与 item

官方模型是 `thread -> turn -> item`，Wanta 的映射如下：

| app-server | Wanta |
| --- | --- |
| 一个 thread | 一个运行期内的 Wanta session |
| 一个 turn | 一次用户 prompt 和对应 assistant 输出 |
| agent message item | assistant text part |
| reasoning item | reasoning part |
| tool item | tool part，使用同一个 item id 贯穿 started/result |
| `thread/tokenUsage/updated` | `usageUpdated` |
| `turn/completed` | `messageCompleted` |

首次 prompt 通过 `thread/start` 创建线程，以后同一 session 复用 thread。每轮通过 `turn/start` 提交文本、本地图片路径、工作目录、模型、effort 和当前权限策略。

一个 turn 会产生多个 item。它们是同一次模型执行中的不同内容单元，不是多个独立“处理过程”。不要把多个真实工具调用合并为一个假调用；应保留每个 item 的 id、状态和结果，只在展示层把连续的过程块聚合起来。

注意通知与响应可能乱序：`turn/started` 可能先于 `turn/start` 的响应到达。创建 turn 状态时必须优先复用已经收到的同 id 状态，不能覆盖其中已累计的文本或工具。

## 5. 原生 item 到 Wanta 工具的映射

renderer 只认识 Wanta 的稳定工具词汇，不应显示 `commandExecution`、`fileChange` 等 app-server 内部名称。

| app-server item | Wanta tool | 输入归一化 | 完成结果 |
| --- | --- | --- | --- |
| `commandExecution` | `bash` | `command`、可选 `cwd` | `aggregatedOutput` |
| `fileChange`（全是 add） | `write` | 首个 `filePath`、完整 `changes` | 无通用文本输出 |
| `fileChange`（其他） | `edit` | 首个 `filePath`、完整 `changes` | 无通用文本输出 |
| `mcpToolCall` | 原始 MCP tool 名 | arguments 对象；标题为 `server.tool` | `result` |
| `dynamicToolCall` | 原始 tool 名 | arguments 对象 | `contentItems` |
| `imageView` | `read` | `filePath` | 无通用文本输出 |
| `collabAgentToolCall` | `task` | operation、prompt、receiverThreadIds | 无通用文本输出 |

转换规则：

- arguments 只有在“非数组对象”时才进入统一 input；标量、数组和 null 归一为 `{}`。
- MCP/dynamic tool 的结构化结果使用 JSON 文本持久化，空字符串也是有效结果，不能用 truthy 判断丢掉。
- error 可以是字符串或 `{ message }`，最终必须转成用户可展示文本。
- 文本、reasoning、plan、user message 以及未知 item 类型都不能退化为通用工具卡片。
- 新 app-server 版本增加 item 类型时，先生成/查看当前版本 schema，再明确决定如何投影；默认行为应是不展示，而不是伪装成 `other`。

## 6. Transcript 与旧会话恢复

`ExternalAgentAdapter.emit()` 会先做外部 agent 数据脱敏，再同时写入内存 recorder、renderer 事件流和按 session 保存的 transcript。普通增量写入有短 debounce，`messageCompleted` 和 adapter 停止会立即 flush。

Codex 一个 turn 当前使用一个 assistant message，多个文本、reasoning 和工具 part 都挂在该 message 下。完成时 recorder 给最新 assistant message 写入 `finishReason: stop` 和 `completedAt`。

恢复旧 transcript 时，Codex adapter 会再次执行工具投影。这个步骤不能省略：只修实时事件会导致新会话显示正常，而升级前会话仍显示原生 `commandExecution` / `fileChange` 字符串。

当前 thread 映射只存在于内存。应用重启后 transcript 仍可用于展示，但 Codex 原生 thread 不会自动 resume；如果以后增加 `thread/resume`，必须同时处理原生 thread 不存在、CLI 版本变化和 Wanta 会话删除之间的竞争。

## 7. “处理过程”与“最终回答”

app-server 会在同一个 assistant message 中交错发送文本和工具。持久化完成后，该 message 的所有 part 都共享 `finishReason: stop`，因此不能仅凭 finish reason 把每段文本都判成最终回答。

`assistant-timeline.ts` 使用以下规则：

- 工具和非失败 status 属于处理过程。
- 同一 message 中，只要当前文本后面还有过程块，它就不能被当作最终回答。
- 进入工具阶段后，工具之间的解释文本仍属于处理过程。
- 最后一个过程块之后、带正常完成原因的文本才进入最终回答。
- 连续的 process segment 在展示层合并，但底层工具 part 保持独立。
- `connectionFailed`、`runtimeFailed`、error 和附件留在回答区，避免关键失败被折叠隐藏。

这个判断必须按 message 维度进行。跨 message 寻找“最后一个工具”会把前一轮文本错误归到后一轮。

## 8. 权限和沙箱映射

Wanta 保存的是统一权限模式，执行前投影到 Codex 原生策略。`thread/start` 使用字符串 `sandbox`，`turn/start` 使用结构化 `sandboxPolicy`，两者字段形态不同。

| Wanta 模式 | approval policy | sandbox |
| --- | --- | --- |
| `default` | `on-request` | 保留 Codex 默认值 |
| `read_only` | `on-request` | read-only，无网络 |
| `accept_edits` | `on-request` | workspace-write，仅 cwd 和宿主传入的额外 roots 可写，无网络 |
| `plan` | `on-request` | read-only，无网络 |
| `auto` | `never` | workspace-write，仅 cwd 和宿主传入的额外 roots 可写，无网络 |
| `full_access` | `never` | danger-full-access |

命令、文件修改和权限请求会转换为 `permissionAsked`。用户的 `once` / `always` / `reject` 分别映射为 Codex 的 `accept` / `acceptForSession` / `decline`；permissions 请求使用其独立的 scope 结果结构。

未知服务端请求不能获得权限。当前实现返回空对象以保持 JSON-RPC 通道可用；新增请求类型时必须先确认官方 schema 和安全语义。

## 9. 模型、effort 与输入

模型选择来自 `model/list`，需要处理分页和重复 cursor。隐藏模型不进入 UI，所有模型声明的 `supportedReasoningEfforts` 合并去重，默认模型和默认 effort 来自默认目录项。

目录加载是 UI 增强能力：失败时记录 warning，但仍允许 Codex 使用本机默认模型工作。用户选择的 model/effort 按 Wanta session 保存为 adapter desired state，并在下一次 `turn/start` 发送。

附件使用 `localImage`，只传本地路径，不把文件内容内联进 JSON-RPC。宿主上下文由 `externalAgentPromptText()` 合并进首个 text item；transcript 仍保存用户原始文本。

## 10. 已知限制

- 当前 Codex CLI 0.149.x app-server 未暴露本项目需要的 collaboration mode，因此 Codex 的 build/plan 工作模式选择器不宣称可用。这里与权限模式中的 `plan` 不是同一概念。
- Wanta 还没有 Codex 专用结构化问答通道；`item/tool/requestUserInput` 当前以空 answers 响应。
- app-server thread 尚未跨 Wanta 重启恢复，历史 transcript 主要承担 UI 持久化职责。
- app-server 协议会随 Codex CLI 版本演进，不能把当前 `any` 形状当作永久 schema。

## 11. 心得与踩坑

1. **协议转换必须止于 adapter。** 原生字符串一旦进入 renderer，工具标题、图标、分组和历史恢复都会各自出现兼容分支，问题会迅速分散。
2. **“执行单元”和“展示分组”是两层。** 多个 item 代表多个真实动作，必须逐个记录；用户看到的“处理过程”可以把它们折叠成一组。
3. **实时修复不等于历史修复。** transcript 是 Wanta 的持久化边界，任何命名或结构归一化都要考虑 hydration。
4. **完成标记属于 message，不属于 part。** 同一 message 内交错文本和工具时，只看 `finishReason` 一定会误判中间文本。
5. **JSONL stdout 不一定绝对干净。** 非协议日志不能让整个连接立即崩溃，但请求失败和进程退出必须能终止等待。
6. **不要假设请求响应先于通知。** 尤其是 `turn/started`，乱序覆盖会造成文本消失或工具卡片卡住。
7. **结构化结果要在持久化前收敛。** MCP result/error 不是稳定字符串，直接塞进 transcript 会破坏 UI 契约。
8. **未知类型默认关闭。** 新 item 自动显示为通用工具看似“兼容”，实际上会暴露协议内部名并制造错误交互。
9. **开发包和安装包不是同一份代码。** `/Applications/Wanta.app` 可能仍是旧构建，验证仓库改动应启动当前源码或重新打包。
10. **Electron 启动环境会影响现象。** `ELECTRON_RUN_AS_NODE=1` 会让 Electron 以 Node 模式启动并出现 `BrowserWindow` 缺失；只应在启动开发实例时清除此变量，不要改全局环境。

## 12. 修改后的检查清单

- 用当前安装的 Codex CLI 重新生成 schema，并核对新增或变更的 method/item 字段。
- 为 JSON-RPC 响应、服务端请求、通知和乱序通知分别保留测试。
- 为每个支持的工具 item 同时测试 started、completed、failed 和结构化输出。
- 覆盖旧 transcript 恢复，确认 UI 中没有原生工具类型字符串。
- 覆盖“文本 -> 工具 -> 文本 -> 工具 -> 最终文本”，确认中间文本进入处理过程，最终文本进入回答。
- 运行 Codex adapter 单测、assistant timeline 单测、typecheck、lint 和 build；需要真实 CLI 时再启用 BYOA smoke test。
- 全仓搜索 Codex 与 ACP 的交叉引用，确认只剩“Codex 不走 ACP”之类的架构说明，而没有注册、实例化或 fallback 代码。

## 13. 官方参考

- [Codex app-server 官方文档](https://learn.chatgpt.com/docs/app-server)
- [Codex app-server 官方 Markdown](https://learn.chatgpt.com/docs/app-server.md)

协议以本机 Codex CLI 版本生成的 schema 为准：

```bash
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```

本次迁移和回归修复以 `codex-cli 0.149.1` 做过 schema 对照。升级 Codex CLI 后，先重新生成 schema，再修改 adapter 和测试，避免依赖网页示例中未承诺的字段。
