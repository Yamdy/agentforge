Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the MemoryProcessor plugin that provides conversation history, working memory, and semantic recall across agent turns and sessions.

**MemoryProcessor at buildContext:** Loads relevant memories into the pipeline context:
- Conversation history from session store (recent messages)
- Working memory values (structured key-value pairs persisted across iterations)
- Semantic recall (optional, vector-based retrieval of relevant past interactions)

**MemoryProcessor at processOutput:** Records new information:
- Current conversation turn (user message + assistant response)
- Extracted facts (if a fact extraction Processor is configured)
- Working memory updates

**Storage backends (injectable via plugin config):**
- `InMemoryStorage` — for testing, no persistence
- `SQLiteStorage` — for single-process production use
- Backend interface: `save(sessionId, key, value)`, `load(sessionId, key)`, `query(sessionId, query, limit)`

**Memory window:** Configure how many recent messages to include in context. Older messages are available via semantic recall but not auto-loaded.

## Acceptance criteria

- [ ] MemoryProcessor loads conversation history at buildContext stage
- [ ] MemoryProcessor saves conversation turn at processOutput stage
- [ ] Working memory persists across iterations within a session
- [ ] InMemoryStorage backend works for testing
- [ ] SQLiteStorage backend persists across sessions
- [ ] Memory window limits loaded messages to configured count
- [ ] Test: agent has a multi-turn conversation, memory is loaded correctly in subsequent turns

## Blocked by

- Issue 07 (Plugin System)
- Issue 09 (Session + Suspend/Resume)

## User stories covered

31, 32, 33, 34
