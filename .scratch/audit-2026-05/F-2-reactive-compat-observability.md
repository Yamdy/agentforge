# F-2 [HIGH] Hidden Reactive Compat Retry Loop

## Status: open

## Summary

LoopOrchestrator 在 API 错误时静默调用 applyReactiveRules() 修改历史并 continue 循环，用户/开发者无感知。

## Evidence

- `packages/core/src/loop-orchestrator.ts:62-69` — runLoop reactive compat retry
- `packages/core/src/loop-orchestrator.ts:163-176` — streamLoop reactive compat retry

## Acceptance Criteria

- [ ] compat 重试时 emit `compat:retry` 事件
- [ ] compat 重试时记录 span attribute
- [ ] 可通过 HookManager 禁用/监听 compat 重试

## Priority

P-1 — 隐藏正确性风险
