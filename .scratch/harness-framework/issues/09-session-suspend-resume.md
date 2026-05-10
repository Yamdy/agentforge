Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement session persistence via EventBus-sourced JSONL storage with tree branching and suspend/resume.

**Session types:**
```typescript
interface SessionRecord {
  sessionId: string;
  parentSessionId?: string;  // for sub-agent tree
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed' | 'suspended' | 'error';
  model?: string;
  tokenUsage: TokenUsage;
}

interface SessionEvent {
  seq: number;
  timestamp: string;
  type: AgentEvent['type'];
  payload: AgentEvent;
}
```

**SessionStorage interface:**
```typescript
interface SessionStorage {
  append(sessionId: string, event: SessionEvent): Promise<void>;
  read(sessionId: string): AsyncIterable<SessionEvent>;
  list(filter?: { parentSessionId?: string; status?: string }): Promise<SessionRecord[]>;
  updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void>;
}
```

Default: filesystem JSONL. Interface allows swapping to database or remote storage.

**SessionManager:**
```typescript
interface SessionManager {
  start(input: string): Promise<SessionRecord>;
  restore(sessionId: string): Promise<PipelineContext>;
  suspend(sessionId: string, reason: string): Promise<void>;
  resume(sessionId: string, input?: string): Promise<string>;
  list(filter?: { parentSessionId?: string }): Promise<SessionRecord[]>;
}
```

**EventBus integration:** Session persistence subscribes to all AgentEvents and appends to JSONL. Decoupled from agent execution — persistence failure does not affect agent runs.

**Restore flow:** Stream events from JSONL → replay to reconstruct SessionState → caller passes to Agent.run().

**Suspend/resume:** Processor calls `context.suspend(reason)`, state serialized to session store. External caller invokes `sessionManager.resume(sessionId, input)`.

## Acceptance criteria

- [x] Session events written as valid JSONL (one JSON object per line)
- [x] EventBus subscription captures all lifecycle events
- [x] Tree branching works: sub-agents linked via parentSessionId
- [x] Restore reconstructs SessionState from event replay
- [x] Suspend persists state, resume continues from suspended stage
- [x] Persistence failure does not crash agent execution
- [x] Default filesystem storage works
- [x] Test: full agent run, verify JSONL contains all events, restore works

## Blocked by

- Plan A (Foundation — EventBus, SessionState type)

## User stories covered

7, 52, 53, 54
