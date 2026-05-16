# F-3 [HIGH] ContextBuilder Severely Underdeveloped

## Status: open

## Summary

prepare-step.ts 只做 history.slice(-50) 硬截断，无压缩/摘要/语义去重。压缩能力在 plugins/compression 是可选项。

## Evidence

- `packages/core/src/processors/prepare-step.ts:8-11` — 硬截断
- `packages/core/src/processors/build-context.ts:4-20` — 仅字段映射

## Acceptance Criteria

- [ ] ContextBuilder 核心接口包含压缩策略扩展点
- [ ] 至少实现一种压缩策略（sliding window / summary）
- [ ] plugins/compression 的能力可注入到核心 ContextBuilder

## Priority

P-1 — 长对话 token 溢出
