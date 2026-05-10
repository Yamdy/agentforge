Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the MemoryProcessor plugin with injectable storage backends and dual-mode trigger (automatic vs agent-controlled).

**Memory backend interface:**
```typescript
interface MemoryBackend {
  store(sessionId: string, entry: MemoryEntry): Promise<void>;
  retrieve(sessionId: string, query?: { limit?: number; since?: string }): Promise<MemoryEntry[]>;
  search(query: string, options?: { limit?: number }): Promise<MemoryEntry[]>;
}

interface MemoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

**MemoryProcessor at buildContext:** Loads relevant memories into `session.messageHistory` and injects as PromptFragment.

**MemoryProcessor at processOutput:** Records new conversation turn (user message + assistant response).

**Dual-mode trigger (from AgentScope insight):**
```typescript
type MemoryTriggerMode =
  | { type: 'automatic'; onLoad: 'always' | 'on-session-start' }
  | { type: 'agent-controlled' }   // registers retrieve/store as tools
  | { type: 'both' };
```

- `automatic`: Framework loads/stores transparently at pipeline stages
- `agent-controlled`: Exposes `retrieve_from_memory` / `record_to_memory` as tools, agent decides
- `both`: Auto-load + agent can override

**Storage backends:** `InMemoryBackend` (testing), `SQLiteBackend` (production), custom via MemoryBackend interface.

## Acceptance criteria

- [ ] MemoryProcessor loads history at buildContext stage
- [ ] MemoryProcessor saves conversation turn at processOutput stage
- [ ] InMemoryBackend works for testing
- [ ] SQLiteBackend persists across sessions
- [ ] Memory window limits loaded messages to configured count
- [ ] `automatic` mode loads/stores transparently
- [ ] `agent-controlled` mode exposes memory tools
- [ ] Test: multi-turn conversation, memory loaded correctly in subsequent turns

## Blocked by

- Issue 07 (Plugin System)
- Plan A (Foundation — PromptFragment type)

## User stories covered

31, 32, 33, 34
