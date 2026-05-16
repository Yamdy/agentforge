# F-8 [LOW] EventBus Handler Error Isolation

## Status: open

## Summary

EventBus.emit() 无 try/catch，handler 抛异常会中断后续 handler。HookManager.bridge() 吞没错误。

## Evidence

- `packages/core/src/event-bus.ts:7` — no error isolation
- `packages/core/src/hook-manager.ts:100-106` — swallows errors

## Acceptance Criteria

- [ ] EventBus.emit() isolate 每个 handler 的错误
- [ ] handler 错误不中断其他 handler

## Priority

P-3 — 稳定性
