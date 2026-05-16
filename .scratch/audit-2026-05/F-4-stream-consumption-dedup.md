# F-4 [MEDIUM] PipelineRunner Stream Consumption Duplication

## Status: open

## Summary

consumeStream() (run路径) 和 stream() 内联逻辑几乎完全相同，但分别维护。

## Evidence

- `packages/core/src/pipeline.ts:59-90` — consumeStream
- `packages/core/src/pipeline.ts:191-238` — inline stream parsing

## Acceptance Criteria

- [ ] 提取公共 parseFullStream helper
- [ ] run() 和 stream() 共用同一逻辑
- [ ] 现有测试全部通过

## Priority

P-2 — 维护性风险
