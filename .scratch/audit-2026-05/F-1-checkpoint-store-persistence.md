# F-1 [HIGH] CheckpointStore Memory-Only

## Status: open

## Summary

LoopOrchestrator.checkpoints 是 in-memory Map，进程崩溃即丢失所有挂起状态。

## Evidence

- `packages/core/src/loop-orchestrator.ts:28` — `private checkpoints = new Map<string, ...>()`
- `packages/core/src/serialize.ts` — serialize/deserialize 存在但无处持久化

## Acceptance Criteria

- [ ] CheckpointStore 接口抽象（内存/文件/数据库可替换）
- [ ] LoopOrchestrator 注入 CheckpointStore 而非内部 Map
- [ ] 至少一个持久化实现（JSONL file 或 SQLite）
- [ ] 崩溃恢复测试通过

## Priority

P-0 — 生产不可接受
