# F-5 [MEDIUM] Hook Silently Mutates Tool Output

## Status: open

## Summary

tool.after hook 可替换 hookOutput.result，调用者无感知。

## Evidence

- `packages/core/src/tool-registry.ts:114-119` — hook mutation without tracking

## Acceptance Criteria

- [ ] hook 修改输出时记录 span attribute
- [ ] 或 emit `tool:output_mutated` 事件

## Priority

P-2 — 可调试性
