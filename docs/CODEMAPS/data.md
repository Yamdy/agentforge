<!-- Generated: 2026-05-24 | Files scanned: 20 | Token estimate: ~700 -->

# Data Architecture

## Session Storage

Two backends implement `SessionStorage` interface:

| Backend | File | Storage |
|---------|------|---------|
| `FilesystemSessionStorage` | `core/src/session-storage.ts` | JSONL files per session |
| `SqliteSessionStorage` | `core/src/session-storage-sqlite.ts` | SQLite database |

### SessionRecord

```
sessionId: string (UUID)
parentSessionId?: string (tree branching)
createdAt: string (ISO 8601)
updatedAt: string (ISO 8601)
status: 'active' | 'completed' | 'suspended' | 'cancelled' | 'error'
model?: string
tokenUsage?: TokenUsage { input, output }
```

### SessionEvent

```
seq: number (monotonic)
timestamp: string (ISO 8601)
type: string (11 event types)
payload: unknown
checksum?: string (SHA-256 of {seq, timestamp, type, payload})
```

## Checkpoint Store

| Backend | File | Storage |
|---------|------|---------|
| `InMemoryCheckpointStore` | `core/src/checkpoint-store.ts` | Map |
| `JsonlCheckpointStore` | `core/src/checkpoint-store.ts` | JSONL file |

### PipelineCheckpoint

```
context: PipelineContext (serialized)
nextStages: StageName[]
iteration: number
expiresAt?: string (ISO 8601)
```

## Serialization (Suspend/Resume)

`serialize()` → `SerializableContext` → `deserialize()` for pipeline checkpointing.

Version: `SERIALIZATION_VERSION` with `migrate_v1_to_v2()` migration support.

## Sync Event Store

| Backend | File |
|---------|------|
| `InMemorySyncEventStore` | `core/src/sync-event.ts` |
| `JsonlSyncEventStore` | `core/src/sync-event.ts` |

## Persistent Queue (Task Queue)

| Backend | File |
|---------|------|
| `InMemoryPersistentQueue` | `core/src/task-queue/persistent-queue.ts` |
| `JsonlPersistentQueue` | `core/src/task-queue/persistent-queue.ts` |

Windows EPERM retry built into `JsonlPersistentQueue.enqueue()`.

## Snapshot Store

| Backend | File |
|---------|------|
| `InMemorySnapshotStore` | `core/src/snapshot-store.ts` |
| `JsonlSnapshotStore` | `core/src/snapshot-store.ts` |

## Memory System (Three-Layer)

| Layer | Class | Storage |
|-------|-------|---------|
| Working | `WorkingMemoryImpl` | In-memory per-session scratch |
| Episodic | `EpisodicMemory` | `InMemoryStore` / `SqliteStore` |
| Semantic | `SemanticMemory` | `InMemoryStore` / `SqliteStore` + embeddings |

## Plugin Storage

| Plugin | Backend | File |
|--------|---------|--------|
| Memory | `InMemoryBackend` / `SQLiteBackend` | `plugins/src/memory/` |
| Eviction | `InMemoryEvictionStorage` / `FilesystemEvictionStorage` | `plugins/src/eviction/` |
| Retry State | `InMemoryRetryStateStore` / `JsonlRetryStateStore` | `core/src/retry-state-store.ts` |

## Data Flow

```
Agent.run()
  → PipelineRunner (in-memory PipelineContext)
  → LoopOrchestrator (per-iteration state)
  → serialize() → CheckpointStore (on suspend)
  → SessionManager.append() → SessionStorage (per-event JSONL)
  → MemorySystem.store() → SqliteStore (facts & episodes)
```
