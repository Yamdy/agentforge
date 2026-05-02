# RxJS 架构文档归档

> **归档日期**: 2026-05-01
> **原因**: RxJS 已从项目中完全移除，替换为命令式 `while(true)` 循环 + `AgentEventEmitter` + Hook 系统

## 背景

AgentForge 原始架构基于 RxJS Observable 事件流 + `expand()` 递归模式。经过架构重构和 RxJS 移除设计（2026-04-30），已于 2026-04-30 完成全量迁移。相关设计文档见 `docs/archive/implemented/`。

## 新架构

| 旧 (RxJS) | 新 (命令式) |
|-----------|------------|
| `expand()` 递归 | `while(true)` 循环 |
| `Observable<AgentEvent>` | `AgentEventEmitter` |
| `agent.run$().pipe()` | `agent.run()` → `Promise<string>` |
| RxJS operators | Hook 系统 (RequestHook/ToolHook/LifecycleHook) |
| `agent.on() → subscribe` | `agent.on() → unsubscribe()` |
| 50+ 事件类型 | 18 核心事件类型 |

## 相关文档

- 移除计划: `docs/archive/implemented/25-DE-RXJS.md`
- 架构重构: `docs/archive/implemented/24-ARCH-REFACTOR.md`
- 实施计划: `docs/archive/implemented/27-IMPLEMENTATION-PLAN.md`
- 新架构指南: `docs/guide/core-concepts.md`
