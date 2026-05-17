# Framework-Level Server Capabilities Design

**Date:** 2026-05-17
**Status:** Draft
**Scope:** 6 framework-level capabilities for `@primo-ai/server` + `core` + `plugins`
**Strategy:** Feature-by-feature in two batches (bottom-up dependencies resolved)

---

## Background

AgentForge server (`@primo-ai/server`) currently provides basic agent run/stream/resume and session CRUD. To serve as a foundation for opencode-like coding agent products, 6 framework-level capabilities are missing:

1. Session abort
2. Session prompt (send message + streaming response)
3. SSE event stream
4. Permission interaction API
5. Provider list
6. MCP management API

**Design premise:**
- Three layers all change (core/plugins/server), not just server routes
- SQLite storage backend added alongside existing JSONL (optional, not replacement)
- Extend existing Hono route style, no rewrite
- Framework-layer only — product behaviors (fork/share/diff/revert/todo) stay in application layer

---

## Batch 1: Foundation (abort + SSE + session prompt)

Batch 1 establishes the core interaction model. Batch 2 capabilities depend on it (permission interaction uses SSE to notify clients).

### 1.1 Agent.abort() — Core Layer

**File:** `packages/core/src/agent.ts`

Current state: `StateMachine` supports `cancelled` transition, but no public method triggers it. `WebSocketBridge.cancel()` only aborts the `AbortController` without updating the state machine.

**Changes:**

```typescript
class Agent {
  private activeAbortController: AbortController | null = null;

  abort(): void {
    if (!this.orchestrator.state.canTransition('cancelled')) return; // idempotent no-op
    this.orchestrator.state.transition('cancelled');
    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }

  async run(input: string, signal?: AbortSignal): Promise<AgentRunResult> {
    // Create a linked AbortController that respects both external signal and abort()
    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    // ... existing run logic, pass controller.signal to orchestrator
    // In finally: this.activeAbortController = null;
  }
}
```

- `stream()` and `streamEvents()` follow the same pattern
- `orchestrator.runLoop()` already respects `AbortSignal` — no change needed there
- `abort()` is idempotent — calling on non-running agent is a no-op

### 1.2 Agent.continue() — Core Layer

**File:** `packages/core/src/agent.ts`

Current state: `agent.run()` always creates a new sessionId. No way to append a message to an existing session.

**New method:**

```typescript
async continue(sessionId: string, message: string, signal?: AbortSignal): Promise<AgentRunResult> {
  // 1. Restore context from session storage (reuse SessionManager.restore)
  // 2. Set request.input = message, keep restored messageHistory
  // 3. Run pipeline loop from restored state
  // 4. Return AgentRunResult with same sessionId
}
```

Implementation notes:
- Reuses `SessionManagerImpl.restore()` to rebuild `PipelineContext` from persisted events
- Sets `context.request.input = message` and appends message to `context.session.messageHistory`
- Delegates to `orchestrator.runLoop()` with restored context
- Throws if session not found or session status is not `active`

Stream variant:

```typescript
async *continueStream(sessionId: string, message: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  // Same as continue() but yields StreamEvents instead of returning final result
}
```

### 1.3 EventBus.once() — Core Layer

**File:** `packages/core/src/event-bus.ts`

Current state: Only persistent `subscribe` exists. Permission interaction needs "wait for next matching event".

**New method:**

```typescript
class EventBus {
  once(eventType: string): Promise<unknown> {
    return new Promise((resolve) => {
      const unsub = this.subscribe(eventType, (data) => {
        unsub();
        resolve(data);
      });
    });
  }
}
```

- Auto-unsubscribes after first event
- Promise resolves with the event payload
- No timeout — caller adds `Promise.race` with timeout if needed

### 1.4 SessionStorage Interface Extension — SDK Layer

**File:** `packages/sdk/src/index.ts`

Add to `SessionStorage` interface:

```typescript
interface SessionStorage {
  // Existing
  append(sessionId: string, event: SessionEvent): Promise<void>;
  read(sessionId: string): AsyncIterable<SessionEvent>;
  list(filter?: { parentSessionId?: string; status?: SessionStatus }): Promise<SessionRecord[]>;
  updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void>;

  // New
  get(sessionId: string): Promise<SessionRecord | undefined>;
  delete(sessionId: string): Promise<void>;
  getMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<Message[]>;
}
```

- `get()` — single session lookup without scanning all sessions
- `delete()` — removes session + events (removes the `(storage as any).delete` hack in routes)
- `getMessages()` — reconstructs `Message[]` from event stream, with pagination

### 1.5 FilesystemSessionStorage — Implement New Methods

**File:** `packages/core/src/session-storage.ts`

```typescript
async get(sessionId: string): Promise<SessionRecord | undefined> {
  return this.readMeta(sessionId);
}

async delete(sessionId: string): Promise<void> {
  const dir = this.sessionDir(sessionId);
  const { rm } = await import('node:fs/promises');
  await rm(dir, { recursive: true, force: true });
}

async getMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<Message[]> {
  // Rebuild messages from events, same logic as SessionManagerImpl.restore()
  // Apply limit/before pagination
}
```

### 1.6 ServerStreamEvent Type — SDK Layer

**File:** `packages/sdk/src/index.ts`

```typescript
type ServerStreamEvent = StreamEvent
  | { type: 'session.started'; sessionId: string }
  | { type: 'session.completed'; sessionId: string; tokenUsage: TokenUsage }
  | { type: 'session.aborted'; sessionId: string }
  | { type: 'permission.request'; sessionId: string; permissionId: string; toolName: string; args: Record<string, unknown>; reason: string }
  | { type: 'permission.resolved'; sessionId: string; permissionId: string; decision: 'allow' | 'deny' };
```

### 1.7 AgentRegistry Session Tracking — Server Layer

**File:** `packages/server/src/registry.ts`

```typescript
class AgentRegistry {
  private sessionAgentMap = new Map<string, string>(); // sessionId → agentId

  registerSession(sessionId: string, agentId: string): void {
    this.sessionAgentMap.set(sessionId, agentId);
  }

  getAgentBySession(sessionId: string): Agent | undefined {
    const agentId = this.sessionAgentMap.get(sessionId);
    if (!agentId) return undefined;
    return this.agents.get(agentId)?.agent;
  }

  unregisterSession(sessionId: string): void {
    this.sessionAgentMap.delete(sessionId);
  }
}
```

- `agent.run()` / `agent.continue()` calls are wrapped by server to register the mapping
- Used by abort/status/prompt routes to find the right agent

### 1.8 SessionEventStream — Server Layer

**File:** `packages/server/src/session-event-stream.ts` (new)

```typescript
class SessionEventStream {
  constructor(private registry: AgentRegistry) {}

  // Subscribe to a session's events via SSE
  subscribe(sessionId: string): ReadableStream {
    // 1. Find agent via registry.getAgentBySession()
    // 2. Subscribe to all events on agent.eventBus (EventBus has no payload filter)
    // 3. Filter by sessionId in handler: skip events where payload.sessionId !== sessionId
    // 4. Forward matching events as SSE data frames via serializeSSE()
    // 5. On client disconnect (ReadableStream cancel), clean up subscription
  }

  // Stream agent execution for a prompt (combines continue + SSE)
  fromAgentContinue(agentId: string, sessionId: string, message: string): ReadableStream {
    // 1. Get agent from registry
    // 2. Call agent.continueStream(sessionId, message)
    // 3. Forward StreamEvents as SSE
    // 4. Emit session.started / session.completed events
  }
}
```

### 1.9 Session Routes — Server Layer

**File:** `packages/server/src/routes/sessions.ts` (major extension)

New endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List sessions (existing) |
| `GET` | `/status` | Batch status for active sessions |
| `GET` | `/:id` | Get session (existing) |
| `GET` | `/:id/messages` | Get message history with pagination |
| `GET` | `/:id/events` | SSE subscription for session events |
| `POST` | `/:id/abort` | Abort a running session |
| `POST` | `/:id/prompt` | Send message (sync, returns final result) |
| `POST` | `/:id/prompt/stream` | Send message (SSE streaming) |
| `DELETE` | `/:id` | Delete session (existing, remove hack) |

**POST /:id/abort:**

```
Request: {}
Response: { aborted: true, sessionId: string }

Flow:
  registry.getAgentBySession(sessionId)
  → agent.abort()
  → storage.updateMeta(sessionId, { status: 'cancelled' })
  → emit 'session.aborted' via EventBus
```

**POST /:id/prompt:**

```
Request: { message: string }
Response: AgentRunResult

Flow:
  registry.getAgentBySession(sessionId)
  → agent.continue(sessionId, message)
  → return result
```

**POST /:id/prompt/stream:**

```
Request: { message: string }
Response: text/event-stream

Flow:
  registry.getAgentBySession(sessionId)
  → agent.continueStream(sessionId, message)
  → SSE events: text_delta, tool_call, tool_result, complete, error, suspended
```

**GET /:id/events:**

```
Response: text/event-stream (long-lived)

Flow:
  agent.eventBus.subscribe('*', filter by sessionId)
  → forward as ServerStreamEvent SSE frames
  → client disconnect → unsubscribe
```

**GET /:id/messages:**

```
Query: ?limit=50&before=msg_xxx
Response: Message[]

Flow:
  storage.getMessages(sessionId, { limit, before })
```

**GET /status:**

```
Response: Record<sessionId, { state: AgentState, step: number }>

Flow:
  For each entry in registry.sessionAgentMap:
    read agent.state
    (step comes from last session event or agent context)
```

---

## Batch 2: Management (permission + provider + MCP)

### 2.1 PermissionManager — Core Layer

**File:** `packages/core/src/pending-permission.ts` (new)

```typescript
interface PendingPermission {
  permissionId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

class PermissionManager {
  private pending = new Map<string, {
    resolve: (approved: boolean) => void;
    permission: PendingPermission;
  }>();

  awaitDecision(permission: PendingPermission): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending.set(permission.permissionId, { resolve, permission });
    });
  }

  resolve(permissionId: string, approved: boolean): void {
    const entry = this.pending.get(permissionId);
    if (!entry) throw new Error(`Permission not found: ${permissionId}`);
    entry.resolve(approved);
    this.pending.delete(permissionId);
  }

  list(): PendingPermission[] {
    return Array.from(this.pending.values()).map(e => e.permission);
  }

  getBySession(sessionId: string): PendingPermission[] {
    return this.list().filter(p => p.sessionId === sessionId);
  }

  get(permissionId: string): PendingPermission | undefined {
    return this.pending.get(permissionId)?.permission;
  }
}
```

### 2.2 Permission Processor Integration — Plugin Layer

**File:** `packages/plugins/src/permission/permission-processor.ts`

Modify the `ask` branch in interactive mode:

```typescript
// Before (current):
case 'ask': {
  emit({ decision: 'ask', ... });
  return { type: 'suspend', suspensionId: `perm-${toolCall.name}-${Date.now()}`, ... };
}

// After (new):
case 'ask': {
  const permissionId = `perm-${toolCall.name}-${Date.now()}`;
  const permission: PendingPermission = {
    permissionId,
    sessionId: ctx.request.sessionId,
    toolName: toolCall.name,
    args: toolCall.args,
    reason: `Tool '${toolCall.name}' requires approval (ask rule)`,
    createdAt: new Date().toISOString(),
  };

  emit({ decision: 'ask', toolName: toolCall.name, permissionId, mode: config.mode });

  const approved = await config.permissionManager.awaitDecision(permission);
  if (approved) {
    emit({ decision: 'allow', toolName: toolCall.name, permissionId, mode: config.mode });
    return ctx;
  }
  emit({ decision: 'deny', toolName: toolCall.name, permissionId, mode: config.mode });
  return { type: 'abort', reason: `Permission denied: tool '${toolCall.name}' blocked by user` };
}
```

**PermissionConfig extension:**

```typescript
interface PermissionConfig {
  mode: PermissionMode;
  rules: PermissionRule[];
  onDecision?: (event: PermissionDecisionEvent) => void;
  // New
  permissionManager?: PermissionManager;
}
```

When `permissionManager` is provided, `ask` rules use it. When not provided, falls back to current suspend behavior. This keeps backward compatibility.

### 2.3 Permission Routes — Server Layer

**File:** `packages/server/src/routes/permissions.ts` (new)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pending` | List all pending permission requests |
| `GET` | `/pending/:permissionId` | Get single permission detail |
| `POST` | `/pending/:permissionId/respond` | Approve or deny |

**POST /pending/:permissionId/respond:**

```
Request: { approved: boolean }
Response: { resolved: true, permissionId: string, decision: string }

Flow:
  permissionManager.resolve(permissionId, approved)
  → emit 'permission.resolved' via EventBus
```

**SSE notification:** New `permission.request` events are pushed via the existing `GET /sessions/:id/events` SSE endpoint from Batch 1. No separate notification mechanism needed.

### 2.4 ModelFactory.listGateways() — Core Layer

**File:** `packages/core/src/model-factory.ts`

```typescript
class ModelFactory {
  listGateways(): Array<{ name: string; canResolve: (model: string) => boolean }> {
    return this.gateways.map(gw => ({
      name: gw.name,
      canResolve: (model: string) => gw.canResolve(model),
    }));
  }
}
```

No `listModels()` at framework level — model discovery is provider-specific and requires API calls. Framework only exposes gateway metadata.

### 2.5 Provider Routes — Server Layer

**File:** `packages/server/src/routes/providers.ts` (new)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List registered gateways |
| `GET` | `/models` | List available model patterns (gateway name + canResolve hints) |

**GET /:**

```
Response: Array<{ name: string, canResolve: string[] }>
```

Extracted from the shared `ModelFactory` instance in `config-loader.ts`. The server stores the factory after `loadAndRegister()` and passes it to the route.

### 2.6 McpManager — Plugin Layer

**File:** `packages/plugins/src/mcp/mcp-manager.ts` (new)

```typescript
interface McpServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  error?: string;
}

class McpManager {
  private clients = new Map<string, { client: McpClient; config: McpServerConfig }>();

  async addServer(config: McpServerConfig): Promise<void>;
  async removeServer(name: string): Promise<void>;
  async reconnect(name: string): Promise<void>;
  listServers(): McpServerStatus[];
  getServerTools(name: string): McpToolDefinition[];
}
```

Integration with `mcp-plugin`:

```typescript
// plugins/src/mcp/index.ts
function mcpPlugin(options: { servers: McpServerConfig[] }): (api: HarnessAPI) => PluginRegistration {
  return (api) => {
    const manager = new McpManager();

    // Connect initial servers
    for (const config of options.servers) {
      await manager.addServer(config);
    }

    // Register discovered tools
    for (const server of manager.listServers()) {
      const tools = manager.getServerTools(server.name);
      for (const tool of tools) {
        api.registerTool(convertToTool(tool));
      }
    }

    // Store manager reference for server layer to pick up
    // config-loader.ts accesses it via plugin registration return value
    return { manager, /* ... */ };
  };
}
```

### 2.7 MCP Routes — Server Layer

**File:** `packages/server/src/routes/mcp.ts` (new)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List MCP server statuses |
| `GET` | `/:name/tools` | List tools from a specific server |
| `POST` | `/` | Add MCP server at runtime |
| `DELETE` | `/:name` | Remove MCP server |
| `POST` | `/:name/reconnect` | Reconnect to server |

**POST /:**

```
Request: McpServerConfig
Response: McpServerStatus

Flow:
  mcpManager.addServer(config)
  → discover & register tools
  → return status
```

**DELETE /:name:**

```
Response: { removed: true }

Flow:
  mcpManager.removeServer(name)
  → unregister tools from ToolRegistry
  → close client connection
```

---

## SQLite SessionStorage

**File:** `packages/core/src/session-storage-sqlite.ts` (new)

### Schema

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX idx_events_session_seq ON events(session_id, seq);
```

### Implementation Notes

- Uses `better-sqlite3` as optional dependency
- All writes use prepared statements
- `append()` uses `INSERT INTO events`
- `read()` uses `SELECT * FROM events WHERE session_id = ? ORDER BY seq`
- `getMessages()` reconstructs `Message[]` from events (same logic as `SessionManagerImpl.restore()`)
- `delete()` uses `DELETE FROM sessions WHERE session_id = ?` with `CASCADE`
- WAL mode enabled for concurrent read performance
- Constructor accepts `dbPath: string` or existing `Database` instance

### Dependency Handling

In `package.json` for `@primo-ai/core`:

```json
{
  "optionalDependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

Runtime detection:

```typescript
let sqlite: typeof import('better-sqlite3') | undefined;
try {
  sqlite = await import('better-sqlite3');
} catch {
  // Not installed — caller should use FilesystemSessionStorage
}
```

### Storage Selection

Server config (`config.jsonc` or constructor options):

```typescript
interface ServerOptions {
  // ... existing
  sessionStorage?: 'file' | 'sqlite';
  storagePath?: string; // directory for file, db path for sqlite
}
```

Default: `'file'` (backward compatible).

---

## Server.ts Changes

**File:** `packages/server/src/server.ts`

Mount new routes:

```typescript
// Existing
this.app.route('/health', healthRoutes({ ... }));
this.app.route('/agents', agentRoutes(this.registry));
this.app.route('/sessions', sessionRoutes(this._sessionStorage));

// New
this.app.route('/sessions', sessionRoutes(this._sessionStorage, this.registry, this.permissionManager, this.sessionEventStream));
this.app.route('/permissions', permissionRoutes(this.permissionManager));
this.app.route('/providers', providerRoutes(this.modelFactory));
this.app.route('/mcp', mcpRoutes(this.mcpManager));
```

`AgentForgeServer` constructor gains new optional dependencies:

```typescript
interface ServerOptions {
  // ... existing
  modelFactory?: ModelFactory;
  permissionManager?: PermissionManager;
  mcpManager?: McpManager;
}
```

These are created by `config-loader.ts` during `loadAndRegister()` and passed to the server.

---

## Full File Change List

| Layer | File | Type | Description |
|-------|------|------|-------------|
| sdk | `src/index.ts` | modify | SessionStorage: add get/delete/getMessages; add ServerStreamEvent type |
| core | `src/agent.ts` | modify | Add abort(), continue(), continueStream(), store AbortController |
| core | `src/event-bus.ts` | modify | Add once() |
| core | `src/model-factory.ts` | modify | Add listGateways() |
| core | `src/session-storage.ts` | modify | Implement get(), delete(), getMessages() |
| core | `src/session-storage-sqlite.ts` | new | SQLite backend for SessionStorage |
| core | `src/pending-permission.ts` | new | PermissionManager class |
| plugins | `src/permission/permission-processor.ts` | modify | Integrate PermissionManager for ask rules |
| plugins | `src/mcp/mcp-manager.ts` | new | Runtime MCP server management |
| plugins | `src/mcp/index.ts` | modify | Expose McpManager from mcp-plugin |
| server | `src/registry.ts` | modify | Add session-to-agent reverse mapping |
| server | `src/session-event-stream.ts` | new | SSE event stream infrastructure |
| server | `src/routes/sessions.ts` | modify | Major extension: abort/prompt/stream/events/messages/status |
| server | `src/routes/permissions.ts` | new | Permission interaction API |
| server | `src/routes/providers.ts` | new | Provider/gateway listing |
| server | `src/routes/mcp.ts` | new | MCP server management API |
| server | `src/server.ts` | modify | Mount new routes, accept new dependencies |
| server | `src/config-loader.ts` | modify | Create PermissionManager, McpManager, ModelFactory references |

---

## Out of Scope (Application Layer)

These are explicitly NOT part of this design — they belong in an application built on top of AgentForge:

- Session fork/share/revert
- Session diff tracking
- Session summarize (uses another agent)
- Session todo
- Multi-workspace routing
- OAuth authentication flow
- PTY WebSocket
- TUI / desktop / web frontend
- File snapshot tracking
- LSP integration
