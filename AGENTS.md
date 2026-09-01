# Wanta AI Guide

> Thin entry point for AI agents. Read only the subdoc that matches the current task.

## What this is

Wanta is OOMOL's Electron desktop AI-agent chat client.

## AI Constitution

- Read only the subdoc that matches the current task.
- Keep setup deterministic and repeatable.
- Treat worktree isolation and concurrent agents as first-class concerns.
- Keep Electron dev observable by the machine, not by human narration.
- Preserve credential, endpoint, branding, and runtime-boundary rules.
- 代码注释要求：新增或修改的类、方法和关键分支使用简洁、准确的中文注释，说明职责、协议转换和重要决策；不要为显而易见的逐行赋值添加注释。

## When to read what

- [docs/ai/bootstrap.md](docs/ai/bootstrap.md): fresh checkout, install, and repeatable initialization
- [docs/ai/worktree.md](docs/ai/worktree.md): worktree isolation and concurrent-agent behavior
- [docs/ai/dev-debugging.md](docs/ai/dev-debugging.md): Electron dev startup, logs, screenshots, and local bug inspection
- [docs/ai/agent-adapter.md](docs/ai/agent-adapter.md): BYOA agent adapter contract and the checklist for adding a new agent
- [docs/ai/codex-app-server.md](docs/ai/codex-app-server.md): native Codex app-server architecture, protocol mapping, transcript/UI rules, and maintenance pitfalls
- [docs/ai/host-capabilities.md](docs/ai/host-capabilities.md): agent-independent Wanta context, capability ownership, and cross-adapter parity
- [docs/ai/integrated-browser-implementation.md](docs/ai/integrated-browser-implementation.md): current integrated-browser implementation state, verified probes, and remaining work
- [docs/development.md](docs/development.md): human-facing development workflow and environment details
- [docs/architecture.md](docs/architecture.md): process split, agent kernel, and IPC layout
- [docs/conventions.md](docs/conventions.md): code conventions and security baseline
- [docs/project-overview.md](docs/project-overview.md): product overview and system context
