# F-7 [LOW] EventBus No Replay Capability

## Status: resolved

## Summary

EventBus 只有 emit/subscribe，无 replay。按 7 模块结论应与 EventStore 合一。

## Evidence

- `packages/core/src/event-bus.ts:1-21` — only emit/subscribe

## Acceptance Criteria

- [x] EventBus 支持 replay(sessionId) 能力
- [x] EventSystem 统一 EventBus + SessionPersistence

## Resolution

- **Commit**: `bff4b8b`
- **Implementation**: EventSystem (composition) wraps EventBus + ReplayBackend, supports `emit`/`subscribe`/`query`/`replay`. StorageReplayBackend adapts SessionStorage. REPLAY_SENTINEL prevents duplicate writes in SessionPersistence.
- **Files added**: `event-system.ts`, `storage-replay-backend.ts`, `event-system.test.ts`
- **Files modified**: `session-persistence.ts`, `plugin-manager.ts`, `agent.ts`, `sdk/index.ts`, `core/index.ts`

## Priority

P-3 — 事件溯源完整性
