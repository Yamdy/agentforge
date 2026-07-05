# AgentForge 开发规范

> 本文件注入 agentforge cli 的 system prompt，指导所有开发工作。

## 项目定位

agentforge 是基于 pi 核心（`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`）自写的 code agent harness。**复用 pi 的 provider/loop，自写 harness 层（Session/Compaction/Events/Safety/...）+ cli 外壳**。不 fork pi 核心，pi 作 npm 依赖。架构总纲见 `ARCHITECTURE.md`。

## 开发方法

- **TDD（Iron Law）**：无失败测试则无生产代码。先写失败测试，看它失败，再写最小代码通过。配置文件/脚手架是 TDD exception。
- **vertical slice 推进**：每个 slice 端到端可运行，先验证链路再叠能力。当前 Slice 0。
- **trace bullet 优先**：新链路先打通最瘦端到端，再补测试与能力。

## 代码规范

- **ESM only**：`"type": "module"`，相对 import 必须带 `.js` 扩展名（`import { x } from "./y.js"`）。
- **TypeScript strict**：`strict: true` + `verbatimModuleSyntax: true`。纯类型导入用 `import type`。
- **工具 schema 用 TypeBox**（`import { Type } from "typebox"`），不是 zod。
- **工具 observation 格式**（compendium）：`execute` 返回 `{ content, details }`——`content` 进 LLM，`details` 供 UI/audit 不进 LLM。失败 throw，不编进 content。
- **包结构**：`shared`（类型）← `harness`（核心自写层）← `cli`（外壳+工具）。依赖单向。

## pi 依赖

- `@earendil-works/pi-agent-core`：`Agent`/`agentLoop`/`AgentTool`/`AgentMessage`/`AgentState`/`AgentLoopConfig` 类型 + hook（beforeToolCall/afterToolCall/transformContext/subscribe）。注意 `Agent` 层不暴露 `shouldStopAfterTurn`（只在低层 `AgentLoopConfig`）。
- `@earendil-works/pi-ai`：`getModel`/`streamSimple`/`registerApiProvider`。`import "@earendil-works/pi-agent-core"` 默认入口自动注册内置 provider。
- **不复用** pi 的 `harness/` 目录与 `pi-coding-agent` 包——那些是自写层。可读作蓝本。
- lockstep 跟随 pi 版本（当前 ^0.79.9）。升级时审查 changelog 的 hook 接口变更。

## 提交

- 分支 `pi`。
- 仅在用户要求时 commit/push。
