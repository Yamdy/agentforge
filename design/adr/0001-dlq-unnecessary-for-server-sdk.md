# ADR-0001: Dead Letter Queue is Unnecessary for Server/SDK Agent Execution Model

**Status**: Accepted
**Date**: 2026-05-22

## Context

Gap 分析将 Dead Letter Queue (DLQ) 列为 P1 缺失能力。DLQ 常见于持久化执行引擎（Temporal、Vercel Workflow DevKit、Celery），任务重试耗尽后进入死信队列等待人工检查、修复、重放。

AgentForge 是 server/SDK 形态，每次 `agent.run()` 是离散的请求-响应周期，非后台持久化执行引擎。

## Decision

**AgentForge 不需要 DLQ。调用方本身就是 DLQ。**

AgentForge 已提供完整的恢复基础设施：

- `agent.run()` → 成功返回 `AgentRunResult`，失败返回 error
- 执行过程中每个 iteration 自动保存 checkpoint（`autoCheckpoint`）
- 失败后调用 `agent.resume(sessionId)` 从 checkpoint 继续执行
- `RetryStateStore` 持久化重试状态
- `CircuitBreaker` 熔断保护防止级联故障

调用方（client / API consumer）收到 error response 后，自行决定重试策略或放弃。这是无状态的 server/SDK 模型的标准模式，而非持久化工作流引擎的缺失。

## Consequences

- **正面**: 降低框架复杂度——无需额外持久化队列、监控面板、修复/重放工具
- **正面**: 调用方保持完全控制——重试策略、幂等处理、用户通知均由应用层决定
- **需注意**: 文档需明确说明"调用方即 DLQ"的职责边界，避免用户期望框架内置死信队列
