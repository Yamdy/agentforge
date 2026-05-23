# ADR-0010: Suspend Timeout is Covered by Session TTL, Not a Separate Feature

**Status**: Accepted
**Date**: 2026-05-22

## Context

Gap 分析将 Suspend 超时机制列为 P1 缺失能力——担心 suspended session 无限期挂起，checkpoint 数据永久占用存储。

`PipelineCheckpoint` 类型已有 `expiresAt` 字段但未在运行时强制执行。

## Decision

**不需要独立的 Suspend 超时机制。将 `suspended` 状态纳入现有 Session TTL 清理范围即可。**

理由：

- `suspended` 不是终态，是等待人工决策（HITL 审批）的中间态
- SessionManager 已内概率 GC（`cleanup()`，每次 `start()` 10% 触发）
- 当前 TTL 清理仅覆盖终态（`completed`/`cancelled`/`error`）
- 将 `suspended` 加入 TTL 清理的条件是**一行改动**——`storage.cleanup()` 中增加 `status === 'suspended'` 过滤
- 被遗弃的 suspended session 过期后自动删除，关联 checkpoint 随之清理

独立的超时机制（定时器、cron 等）是过度工程——session 粒度的超时用 TTL 统一处理即可。

## Consequences

- **正面**: 复用现有 TTL 基础设施，零新增复杂度
- **正面**: 过期 suspended session 的存储空间被自动回收
- **需注意**: `expiresAt` 字段保留在 `PipelineCheckpoint` 类型中——若未来 checkpoint 和 session 生命周期需要解耦（如 session 已清理但需要保留 checkpoint 用于审计），该字段可作为强制清理的硬截止时间
