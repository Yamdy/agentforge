# AgentForge Studio Design Document

> **Status:** Decision-locked, reviewed — 7 blocking issues resolved  
> **Date:** 2026-04-27  
> **Decisions:** D1-A, D2-A, D3-A, D4-A, D5-C, D6-Vue(shelved), D7-A(Phase1)  
> **Review:** Deep architecture review completed. See §11 for resolved questions.

---

## 1. Overview

**Goal:** Build a web-based Studio for AgentForge that provides Agent Chat, Event Timeline, Config Editor, and Observability — powered by the existing `Observable<AgentEvent>` stream and `L1AgentConfigSchema`.

**What this is NOT (for now):**  
- No drag-and-drop workflow graph editor (D5: deferred)  
- No separate npm component library (D3: single Studio App)  
- No React ecosystem (D6: Vue preference, shelved until frontend phase)

**Architecture:** Independent `@agentforge/server` package exposing framework-agnostic HTTP handlers (REST + SSE). A `@agentforge/studio` Vue SPA consumes these APIs. Agent configs stored as L1 JSON/JSONC files on disk. Communication is pure SSE — no WebSocket.

**Tech Stack:**

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | `@agentforge/server` — Node.js HTTP handlers, framework-agnostic | D1: Independent package, decoupled from core |
| Streaming | SSE (`text/event-stream`) | D2: Simple, HTTP-native, HITL via SSE+POST |
| Frontend | Vue 3 + Vite + Pinia + Vue Router | D6: Vue ecosystem preference |
| Config Storage | L1 JSON/JSONC files on disk | D4: Existing format, Git-friendly |
| State Mgmt | Pinia (Vue) | Vue equivalent of Zustand |
| Server Data | TanStack Query (Vue Query) | Server state management |
| UI Framework | Tailwind CSS + Headless UI (Vue) | Modern, composable |
| Workflow Graph | Deferred | D5: Phase 2+ |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                   @agentforge/studio (Vue 3 SPA)                    │
│                                                                     │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ Agent Chat │  │ Config Editor│  │Event Timeline│               │
│  │  (SSE ui)  │  │  (JSON Form) │  │  (Live Feed) │               │
│  └──────┬─────┘  └──────┬───────┘  └──────┬───────┘               │
│         │               │                  │                        │
│  ┌──────┴───────────────┴──────────────────┴───────┐               │
│  │              @agentforge/client                  │               │
│  │    (TypeScript HTTP/SSE client for Studio API)   │               │
│  └────────────────────┬────────────────────────────┘               │
└───────────────────────┼────────────────────────────────────────────┘
                        │ HTTP / SSE
┌───────────────────────┼────────────────────────────────────────────┐
│               @agentforge/server                                    │
│                                                                     │
│  ┌────────────────────┴─────────────────────────┐                  │
│  │          HTTP Handlers (framework-agnostic)    │                  │
│  │                                                │                  │
│  │  POST /api/agents/:id/run/stream  → SSE       │                  │
│  │  POST /api/agents/:id/run          → JSON     │                  │
│  │  GET  /api/agents                 → JSON      │                  │
│  │  GET  /api/agents/:id             → JSON      │                  │
│  │  POST /api/sessions               → JSON      │                  │
│  │  GET  /api/sessions/:id           → JSON      │                  │
│  │  DELETE /api/sessions/:id         → JSON      │                  │
│  │  POST /api/sessions/:id/chat/stream → SSE     │                  │
│  │  POST /api/sessions/:id/hitl/answer → JSON    │                  │
│  │  GET  /api/config                 → JSON      │                  │
│  │  GET  /api/workflows              → JSON      │                  │
│  │  POST /api/workflows/:id/run/stream → SSE     │                  │
│  │  GET  /health  GET  /ready  GET  /metrics     │                  │
│  └────────────────────┬─────────────────────────┘                  │
│                       │ creates / calls                           │
│  ┌────────────────────┴─────────────────────────┐                  │
│  │            AgentForge Core                     │                  │
│  │  createAgent() → Agent.run$() → Observable    │                  │
│  │  L1AgentConfigSchema → JSON validation         │                  │
│  │  Workflow.run() → Observable<AgentEvent>        │                  │
│  └────────────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
         │
    ┌────┴─────┐
    │ File DB  │
    │ (L1 JSON)│
    └──────────┘
```

### Key Data Flow: Agent Chat via SSE

> **Important**: `Agent.run$(input: string)` does NOT accept a `history` parameter.
> History is set at agent creation time via `AgentConfig.history: Message[]`.
> For multi-turn conversations, the server must reconstruct the agent with accumulated
> history on each chat turn. The Session store maintains the message history.

```
1. Frontend: POST /api/sessions/:id/chat/stream { message: "Hello" }
2. Server:   Load session → get config + accumulated history
3. Server:   createAgent({ ...config, history: session.messages }) 
4. Server:   agent.run$(message) → Observable<AgentEvent>
5. Server:   pipe(events → SSE format via observableToSSE)
6. Server:   res.writeHead(200, { 'Content-Type': 'text/event-stream' })
7. Loop:     event → res.write(`data: ${JSON.stringify(event)}\n\n`)
   On agent.complete: append (message, output) to session.messages for next turn
8. Terminal:  res.write(`data: [DONE]\n\n`) → res.end()
```

### Key Data Flow: HITL (Human-in-the-loop)

> **Critical design point**: The `DefaultHITLController` is created once per session
> and stored in the session. The agent references it via `AgentContext`. When a
> `hitl.ask` event is emitted, the SSE stream carries it to the frontend. When the
> frontend POSTs the answer, the server retrieves the same controller from the
> session store and calls `answer()`. This bridges the SSE→POST timing gap.

```
1. Session creation: server creates DefaultHITLController, stores in Session
2. Agent creation: pass hitlController via ContextBuilder.withHITL(session.hitlController)
3. Agent runs: agent.run$() emits events including hitl.ask
4. SSE stream: { type: 'hitl.ask', askId: '...', question: 'Approve?', options: [...] }
5. Frontend renders approval UI
6. Frontend POSTs: /api/sessions/:id/hitl/answer { askId: '...', answer: 'yes' }
7. Server: session.hitlController.answer(askId, answer)  ← same controller instance
8. Agent loop resumes, more SSE events follow
```

---

## 3. Package Structure

### 3.1 `@agentforge/server` (New Package)

```
packages/server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Public API
│   ├── types.ts                    # Server types (RequestContext, etc.)
│   ├── handlers/
│   │   ├── agents.ts               # Agent CRUD + run/stream
│   │   ├── sessions.ts             # Session management
│   │   ├── config.ts              # Config query
│   │   ├── workflows.ts           # Workflow execution
│   │   ├── hitl.ts                # HITL answer endpoint
│   │   └── health.ts              # /health, /ready, /metrics
│   ├── adapters/
│   │   ├── node-http.ts           # Native http.Server adapter
│   │   └── hono.ts                # Hono adapter (optional)
│   ├── session-store.ts           # In-memory session store (L1 config → Agent instances)
│   ├── sse.ts                     # SSE stream helper (Observable → SSE conversion)
│   └── router.ts                  # Path → handler routing
└── tests/
```

### 3.2 `@agentforge/client` (New Package)

```
packages/client/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── client.ts                 # AgentForgeClient class
│   ├── resources/
│   │   ├── agents.ts             # AgentResource (generate, stream, list, get)
│   │   ├── sessions.ts           # SessionResource (create, get, delete, chat/stream)
│   │   ├── workflows.ts          # WorkflowResource (list, run/stream)
│   │   └── config.ts             # ConfigResource (get)
│   └── sse-parser.ts             # SSE stream parser (EventSource-like)
└── tests/
```

### 3.3 `@agentforge/studio` (New Package — Vue SPA)

```
packages/studio/
├── package.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts                   # App entry
│   ├── App.vue                   # Root component
│   ├── router/
│   │   └── index.ts              # Vue Router config
│   ├── stores/
│   │   ├── agents.ts             # Pinia store: agent list + configs
│   │   ├── sessions.ts           # Pinia store: session management
│   │   └── theme.ts              # Pinia store: theme + layout state
│   ├── composables/
│   │   ├── use-agent-stream.ts   # Composable: SSE connection to agent run
│   │   ├── use-events.ts         # Composable: event timeline state
│   │   └── use-config.ts         # Composable: agent config CRUD
│   ├── views/
│   │   ├── AgentsView.vue        # Agent list
│   │   ├── AgentChatView.vue     # Agent chat playground
│   │   ├── ConfigEditorView.vue  # L1 JSON config editor
│   │   └── SettingsView.vue      # Studio settings
│   ├── components/
│   │   ├── chat/
│   │   │   ├── MessageBubble.vue     # Chat message component
│   │   │   ├── ChatInput.vue          # Input bar with send button
│   │   │   └── ToolCallCard.vue      # Tool call/result display
│   │   ├── events/
│   │   │   ├── EventTimeline.vue      # Live event feed
│   │   │   └── EventDetail.vue        # Event inspect popover
│   │   ├── config/
│   │   │   ├── ConfigForm.vue         # L1 config form (from Zod schema)
│   │   │   └── ConfigJsonEditor.vue   # Raw JSON editor
│   │   └── layout/
│   │       ├── AppLayout.vue          # Sidebar + header + content
│   │       ├── Sidebar.vue            # Agent list + navigation
│   │       └── StatusBar.vue          # Connection + event stats
│   ├── lib/
│   │   └── agentforge-client.ts       # Re-export @agentforge/client
│   └── styles/
│       └── main.css                   # Tailwind imports
└── public/
```

---

## 4. API Specification

### 4.1 Agent Endpoints

#### `GET /api/agents`
List available agent configs from the configured directory.

**Response:**
```json
[
  {
    "id": "weather-agent",
    "name": "Weather Agent",
    "model": { "provider": "openai", "model": "gpt-4o" },
    "tools": ["weather"],
    "maxSteps": 10,
    "filePath": "/path/to/weather-agent.json"
  }
]
```

#### `GET /api/agents/:id`
Get agent config by ID.

**Response:** L1AgentConfig JSON

#### `POST /api/agents/:id/run/stream`
Stream agent execution via SSE.

**Request:** `{ "message": "Hello", "history?": [...] }`

**Response:** SSE stream
```
data: {"type":"agent.step","timestamp":"...","sessionId":"...","step":1,"maxSteps":10}

data: {"type":"llm.stream.text","timestamp":"...","delta":"Hello"}

data: {"type":"tool.call","timestamp":"...","toolCallId":"...","toolName":"weather","args":{"city":"Tokyo"}}

data: {"type":"tool.result","timestamp":"...","toolCallId":"...","toolName":"weather","result":"..."}

data: {"type":"agent.complete","timestamp":"...","output":"The weather in Tokyo is..."}

data: [DONE]
```

#### `POST /api/agents/:id/run`
Synchronous (non-streaming) agent execution.

**Request:** `{ "message": "Hello", "history?": [...] }`

**Response:**
```json
{
  "output": "The weather in Tokyo is...",
  "sessionId": "...",
  "steps": 3,
  "tokens": { "prompt": 150, "completion": 80, "total": 230 }
}
```

### 4.2 Session Endpoints

#### `POST /api/sessions`
Create a new chat session.

**Request:** `{ "agentConfigId?": "weather-agent", "configOverrides?": { "systemPrompt": "..." } }`

**Response:**
```json
{
  "id": "sess_abc123",
  "agentConfigId": "weather-agent",
  "createdAt": "...",
  "messages": []
}
```

#### `GET /api/sessions`
List all sessions.

#### `GET /api/sessions/:id`
Get session with messages and recent events.

**Query Parameters:**
- `eventLimit` (default: 200): Maximum number of recent events to return
- `eventOffset` (default: 0): Skip this many events (for pagination)

**Response:**
```json
{
  "id": "sess_abc123",
  "agentConfigId": "weather-agent",
  "messages": [...],
  "events": [...],          // Last N events (configurable via eventLimit)
  "eventCount": 1547,      // Total event count for pagination
  "createdAt": "...",
  "updatedAt": "..."
}
```

The SSE stream pushes events in real-time, so `GET /api/sessions/:id` is mainly for reconnecting after a page reload. The `eventLimit` prevents returning megabytes of events for long sessions.

#### `DELETE /api/sessions/:id`
Delete a session.

#### `POST /api/sessions/:id/chat/stream`
Chat within an existing session (SSE). Same format as `/agents/:id/run/stream`.

**Request:** `{ "message": "Follow-up question" }`

#### `POST /api/sessions/:id/clear`
Clear session messages and events.

#### `POST /api/sessions/:id/cancel`
Cancel the active agent execution for this session. Returns 409 if no run is active.

**Response:**
```json
{ "ok": true, "message": "Run cancelled" }
```

This sends an abort signal to the active SSE stream, unsubscribes from the Observable, and terminates the agent loop.

### 4.3 HITL Endpoints

#### `POST /api/sessions/:id/hitl/answer`
Answer a HITL question.

**Request:**
```json
{
  "askId": "ask_xyz",
  "answer": "yes"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Answer recorded, agent resumed"
}
```

### 4.4 Config Endpoints

#### `GET /api/config`
Get server configuration info.

**Response:**
```json
{
  "version": "0.1.0",
  "availableModels": ["openai", "anthropic", "google", "custom"],
  "availableTools": [
    { "name": "weather", "description": "Get weather for a city" }
  ],
  "configDir": "/path/to/agents"
}
```

#### `PUT /api/agents/:id`
Update an agent config (create if not exists). Used by the Config Editor.

**Request:** L1AgentConfig JSON body

**Response:**
```json
{
  "id": "weather-agent",
  "config": { ... },
  "filePath": "/path/to/weather-agent.json"
}
```

**Validation:** Server validates with `L1AgentConfigSchema.safeParse()`. Returns 422 with Zod errors on failure.

#### `DELETE /api/agents/:id`
Delete an agent config file.

**Response:** `204 No Content`

### 4.5 Workflow Endpoints (Phase 4 — Deferred, Do Not Implement Until Then)

> **Note**: These endpoints are defined for future reference. D5 defers the workflow
> visual editor to Phase 4. Do not implement these in Phase 0-3.

#### `GET /api/workflows`
List available workflows.

#### `POST /api/workflows/:id/run/stream`
Stream workflow execution via SSE.

### 4.6 Health Endpoints (Existing)

#### `GET /health` → Health status JSON
#### `GET /ready` → Readiness status JSON
#### `GET /metrics` → Prometheus text format

---

## 5. SSE Protocol

### 5.1 Event Format

All SSE events follow the standard format:

```
data: <JSON>\n\n
```

Terminal event:
```
data: [DONE]\n\n
```

### 5.2 Event Types

The server maps `AgentEvent.type` directly to SSE event types. Consumers filter by `type` field:

| AgentEvent type | SSE data | Studio rendering |
|---|---|---|
| `agent.start` | `{ type: "agent.start", ... }` | Session start indicator |
| `agent.step` | `{ type: "agent.step", step, maxSteps }` | Step counter |
| `llm.stream.text` | `{ type: "llm.stream.text", delta }` | Streaming text token |
| `llm.stream.tool_call` | `{ type: "llm.stream.tool_call", ... }` | Tool call start |
| `llm.response` | `{ type: "llm.response", usage, ... }` | Token count update |
| `tool.call` | `{ type: "tool.call", toolName, args }` | Tool call card |
| `tool.result` | `{ type: "tool.result", result }` | Tool result card |
| `hitl.ask` | `{ type: "hitl.ask", askId, question, options }` | Approval dialog |
| `agent.complete` | `{ type: "agent.complete", output }` | Final text display |
| `agent.error` | `{ type: "agent.error", error }` | Error display |
| `done` | `{ type: "done", reason }` | Stream end signal |
| `cancel` | `{ type: "cancel" }` | Cancel signal |

### 5.3 Error Handling

**Request-level errors** (before streaming starts) return JSON:

```json
// 400 Bad Request
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }

// 404 Not Found  
{ "error": { "code": "NOT_FOUND", "message": "Agent 'xxx' not found" } }

// 422 Unprocessable Entity (Zod validation failure)
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid config", "details": [{ "path": "model.provider", "message": "..." }] } }

// 500 Internal Server Error
{ "error": { "code": "INTERNAL_ERROR", "message": "..." } }
```

**Stream-level errors** (during SSE):

```
data: {"type":"agent.error","timestamp":"...","error":{"name":"LLMError","message":"Rate limit exceeded"}}

data: {"type":"done","reason":"error"}
```

If the server catches a request-level error before streaming:

```
data: {"type":"agent.error","error":{"name":"ServerError","message":"Agent not found"}}

data: [DONE]
```

### 5.4 Stream Lifecycle & Cancellation

The `observableToSSE()` helper **must** handle client disconnection and **must not leak AbortSignal listeners**:

```typescript
export function observableToSSE(events$: Observable<AgentEvent>, signal?: AbortSignal): Response {
  const stream = new ReadableStream({
    start(controller) {
      // Cleanup function: removes the abort listener to prevent memory leaks.
      // AbortSignal listeners persist for the signal's lifetime; without cleanup,
      // each SSE connection leaks a listener on the global Request signal.
      const cleanup = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        subscription.unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
        cleanup();
      };

      const subscription = events$.subscribe({
        next: (event) => {
          controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
        },
        error: (err) => {
          controller.enqueue(`data: ${JSON.stringify({ type: 'agent.error', error: { name: err.name, message: err.message } })}\n\n`);
          controller.enqueue('data: [DONE]\n\n');
          controller.close();
          cleanup(); // Remove abort listener on error completion
        },
        complete: () => {
          controller.enqueue('data: [DONE]\n\n');
          controller.close();
          cleanup(); // Remove abort listener on normal completion
        },
      });

      // Listen for client disconnect — unsubscribe from Observable to stop agent execution
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        // { once: true } auto-removes after first fire, but we also
        // remove explicitly in cleanup() for the cases where abort never fires
        // (normal completion or error before abort).
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

The server route handler must pass `request.signal` to `observableToSSE()` so aborting the HTTP request unsubscribes from the Observable and stops the agent.

### 5.5 SSE Reconnection

When the SSE connection drops (network interruption, server restart, or client page reload), the client must reconnect and resume from where it left off.

**Server-side**: Each SSE event includes an `id` field (the event's index within the session):

```
id: 42
data: {"type":"agent.step","timestamp":"...","step":3,"maxSteps":10}

id: 43
data: {"type":"llm.stream.text","delta":"Hello"}

```

**Client-side**: The `@agentforge/client` SDK supports reconnection:

```typescript
client.sessions.chatStream(sessionId, {
  message: 'Hello',
  lastEventId: lastEventId,  // Resume from this event
  onEvent: (event) => { /* handle */ },
});
```

**Reconnect flow**:
1. Client detects connection drop (readable stream closes unexpectedly)
2. Client stores `lastEventId` from the last received event
3. Client calls `GET /api/sessions/:id?eventLimit=N&eventOffset=lastIndex` to get missed events
4. Client re-subscribes to the SSE stream

**Implementation note**: Reconnection is a Phase 1 feature. Phase 0 can use simple retry without event replay.

---

## 6. Server Design

### 6.1 Framework-Agnostic Handler Pattern

Following Mastra's proven pattern, handlers are pure functions:

```typescript
// packages/server/src/handlers/agents.ts

export async function streamAgentHandler(ctx: RequestContext): Promise<Response> {
  const { server, params, body } = ctx;
  const agentId = params.id;
  const { message } = body as { message: string };

  // 1. Find or load agent config
  const config = await server.configStore.getAgentConfig(agentId);
  if (!config) {
    throw new HTTPException(404, `Agent ${agentId} not found`);
  }

  // 2. Create agent with L1 config (uses loadAgentFromConfig internally)
  //    History is managed by the session store, not by the agent.
  const agent = await server.agentFactory.create(config);

  // 3. Run and stream — run$(input: string) takes only the message
  const events$ = agent.run$(message);

  // 4. Convert Observable to SSE, passing request signal for cancellation
  return observableToSSE(events$, ctx.request.signal);
}
```

### 6.2 RequestContext

```typescript
// packages/server/src/types.ts

export interface RequestContext {
  server: AgentForgeServer;     // Server instance with core access
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  request: Request;             // Raw Request object (for .signal, .abort, etc.)
}

export interface AgentForgeServer {
  configStore: ConfigStore;          // L1 JSON file store
  sessionStore: InMemorySessionStore; // In-memory session store
  agentFactory: AgentFactory;         // Creates ephemeral agents from configs
  healthChecker: HealthChecker;
  metricsCollector: MetricsCollector;
}

export interface AgentFactory {
  // Creates an ephemeral agent from L1 config + session history.
  // The agent is created fresh on each chat turn and destroyed after response.
  // The HITL controller is shared across the session, not across agent instances.
  create(config: L1AgentConfig, options?: { history?: Message[], hitl?: HITLController }): Agent;
}
```

### 6.3 SSE Stream Helper

```typescript
// packages/server/src/sse.ts

import { Observable } from 'rxjs';
import type { AgentEvent } from 'agentforge';

export function observableToSSE(events$: Observable<AgentEvent>, signal?: AbortSignal): Response {
  const stream = new ReadableStream({
    start(controller) {
      const subscription = events$.subscribe({
        next: (event) => {
          const data = JSON.stringify(event);
          controller.enqueue(`data: ${data}\n\n`);
        },
        error: (err) => {
          const errorEvent = JSON.stringify({
            type: 'agent.error',
            error: { name: err.name, message: err.message },
          });
          controller.enqueue(`data: ${errorEvent}\n\n`);
          controller.enqueue('data: [DONE]\n\n');
          controller.close();
        },
        complete: () => {
          controller.enqueue('data: [DONE]\n\n');
          controller.close();
        },
      });

      // Handle client disconnect — unsubscribe from Observable to stop agent execution
      if (signal) {
        signal.addEventListener('abort', () => {
          subscription.unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        }, { once: true });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### 6.4 Config Store (File-Based)

```typescript
// packages/server/src/config-store.ts

import { readFile, writeFile, readdir, unlink, rename } from 'fs/promises';
import { resolve, extname } from 'path';
import { L1AgentConfig, L1AgentConfigSchema, loadAgentFromConfig } from 'agentforge/l1';
import type { Agent } from 'agentforge';

export interface ConfigStore {
  listAgentConfigs(): Promise<L1AgentConfig[]>;
  getAgentConfig(id: string): Promise<L1AgentConfig | null>;
  saveAgentConfig(id: string, config: L1AgentConfig): Promise<void>;
  deleteAgentConfig(id: string): Promise<void>;
}

export class FileConfigStore implements ConfigStore {
  constructor(private readonly configDir: string) {}

  async listAgentConfigs(): Promise<L1AgentConfig[]> {
    const files = await readdir(this.configDir);
    const configs: L1AgentConfig[] = [];
    for (const file of files.filter(f => f.endsWith('.json') || f.endsWith('.jsonc'))) {
      const config = await this.getAgentConfig(file.replace(/\.(json|jsonc)$/, ''));
      if (config) configs.push(config);
    }
    return configs;
  }

  async getAgentConfig(id: string): Promise<L1AgentConfig | null> {
    const filePath = this.resolveConfigFile(id);
    if (!filePath) return null;
    // Use async readFile, not the sync loadConfig()
    const content = await readFile(filePath, 'utf-8');
    const ext = extname(filePath);
    let parsed: unknown;
    if (ext === '.jsonc') {
      parsed = this.parseJsonc(content);
    } else {
      parsed = JSON.parse(content);
    }
    const result = L1AgentConfigSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  }

  async saveAgentConfig(id: string, config: L1AgentConfig): Promise<void> {
    const result = L1AgentConfigSchema.safeParse(config);
    if (!result.success) {
      throw new ValidationError(result.error);
    }
    const filePath = resolve(this.configDir, `${id}.json`);
    // Atomic write: write to temp file first, then rename.
    // This prevents corrupted files if the process crashes mid-write.
    const tmpPath = filePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(result.data, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
  }

  async deleteAgentConfig(id: string): Promise<void> {
    const filePath = this.resolveConfigFile(id);
    if (filePath) await unlink(filePath);
  }
}
```

### 6.5 Session Store (In-Memory)

```typescript
// packages/server/src/session-store.ts

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  agentConfigId: string;
  configOverrides?: Partial<L1AgentConfig>;
  messages: ChatMessage[];
  events: AgentEvent[];
  hitlController: DefaultHITLController;  // Lives as long as the session
  createdAt: string;
  updatedAt: string;
}

> **Concurrency constraint**: Only one active agent execution per Session at a time.
> If a user sends a message while the previous response is still streaming, the server
> must either: (a) reject the second request with 409 Conflict, or (b) queue requests
> and execute them sequentially. This prevents HITL `askId` collisions where two agents
> share the same `hitlController`.
>
> **Implementation**: Each Session holds an `activeRun: AbortController | null` field.
> On incoming chat request, if `activeRun` is set, return 409. On stream start, set it.
> On stream end (complete/error/abort), clear it. This also enables explicit cancellation.

export class InMemorySessionStore {
  private sessions = new Map<string, Session>();

  create(agentConfigId: string, configOverrides?: Partial<L1AgentConfig>): Session { ... }
  get(id: string): Session | undefined { ... }
  delete(id: string): boolean { ... }
  addMessage(id: string, message: ChatMessage): void { ... }
  addEvent(id: string, event: AgentEvent): void { ... }
  clear(id: string): void { ... }
}
```

---

## 7. Client SDK Design

### 7.1 `@agentforge/client` — TypeScript HTTP/SSE Client

```typescript
import { AgentForgeClient } from '@agentforge/client';

const client = new AgentForgeClient({
  baseUrl: 'http://localhost:3000',
  apiPrefix: '/api',
});

// List agents
const agents = await client.agents.list();

// Sync generate
const result = await client.agents.generate('weather-agent', {
  message: 'What is the weather in Tokyo?',
});

// Stream generate (SSE)
const stream = client.agents.stream('weather-agent', {
  message: 'What is the weather in Tokyo?',
  onEvent: (event) => {
    if (event.type === 'llm.stream.text') {
      process.stdout.write(event.delta);
    }
  },
});

// Session-based chat
const session = await client.sessions.create({ agentConfigId: 'weather-agent' });
const chatStream = client.sessions.chatStream(session.id, {
  message: 'Hello',
  onEvent: (event) => { /* handle */ },
});

// HITL answer
await client.sessions.answerHitl(session.id, {
  askId: 'ask_xyz',
  answer: 'yes',
});
```

### 7.2 SSE Parser

```typescript
// packages/client/src/sse-parser.ts

export function parseSSEStream(
  response: Response,
  onEvent: (event: AgentEvent) => void,
  onDone?: () => void,
  onError?: (error: Error) => void,
): AbortController {
  const controller = new AbortController();
  
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            onDone?.();
            return;
          }
          try {
            const event = JSON.parse(data);
            onEvent(event);
          } catch {
            // Skip malformed events
          }
        }
      }
    }
  })();

  return controller;
}
```

---

## 8. Frontend Design

### 8.1 Route Structure

```
/                     → Redirect to /agents
/agents               → Agent list (left sidebar)
/agents/:id           → Agent detail with tabs:
  /agents/:id/chat    → Chat playground (default)
  /agents/:id/config  → Config editor
  /agents/:id/events  → Event timeline
/settings             → Studio settings
```

### 8.2 Key Composables (Vue 3 Composition API)

```typescript
// composables/use-agent-stream.ts
export function useAgentStream() {
  const messages = ref<ChatMessage[]>([]);
  const events = ref<AgentEvent[]>([]);
  const isStreaming = ref(false);
  const error = ref<Error | null>(null);

  function startStream(agentId: string, message: string, history?: Message[]) {
    isStreaming.value = true;
    error.value = null;
    
    // Use @agentforge/client
    const controller = client.agents.stream(agentId, {
      message,
      history,
      onEvent: (event) => {
        events.value.push(event);
        if (event.type === 'llm.stream.text') {
          // Append delta to current assistant message
          appendDelta(event.delta);
        }
      },
      onDone: () => { isStreaming.value = false; },
      onError: (err) => { error.value = err; isStreaming.value = false; },
    });

    return controller; // for cancellation
  }

  return { messages, events, isStreaming, error, startStream };
}
```

### 8.3 Config Editor

The config editor uses `L1AgentConfigSchema` as the source of truth:

```typescript
// composables/use-config.ts
import { L1AgentConfigSchema } from 'agentforge/l1';

export function useConfigEditor(agentId: string) {
  const config = ref<L1AgentConfig | null>(null);
  const validationErrors = ref<ZodError | null>(null);

  async function loadConfig() {
    const result = await client.agents.get(agentId);
    // Validate with Zod
    const parsed = L1AgentConfigSchema.safeParse(result);
    if (parsed.success) {
      config.value = parsed.data;
      validationErrors.value = null;
    } else {
      validationErrors.value = parsed.error;
    }
  }

  async function saveConfig(newConfig: L1AgentConfig) {
    const parsed = L1AgentConfigSchema.safeParse(newConfig);
    if (!parsed.success) {
      validationErrors.value = parsed.error;
      return false;
    }
    await client.agents.update(agentId, parsed.data);
    config.value = parsed.data;
    return true;
  }

  return { config, validationErrors, loadConfig, saveConfig };
}
```

> **How Config Edits Take Effect**: Since each chat request creates a new ephemeral Agent
> from the latest config file, edits saved via the Config Editor are automatically picked
> up on the **next** chat message. No server restart or agent restart is needed — the
> `FileConfigStore` reads from disk on each request.

### 8.4 Event Timeline Component

```vue
<!-- components/events/EventTimeline.vue -->
<template>
  <div class="event-timeline">
    <div
      v-for="event in filteredEvents"
      :key="event.timestamp"
      :class="['event-item', getEventCategory(event.type)]"
      @click="selectedEvent = event"
    >
      <span class="event-type">{{ event.type }}</span>
      <span class="event-detail">{{ getEventDetail(event) }}</span>
      <span class="event-time">{{ formatTime(event.timestamp) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentEvent } from 'agentforge';

const props = defineProps<{
  events: AgentEvent[];
  filter?: string;
}>();

const filteredEvents = computed(() =>
  props.filter
    ? props.events.filter(e => e.type.startsWith(props.filter!))
    : props.events
);

function getEventCategory(type: string) {
  if (type.startsWith('agent.')) return 'agent';
  if (type.startsWith('llm.')) return 'llm';
  if (type.startsWith('tool.')) return 'tool';
  if (type.startsWith('hitl.')) return 'hitl';
  if (type === 'error' || type === 'agent.error') return 'error';
  return '';
}
</script>
```

---

## 9. Implementation Phases

### Phase 0: SSE Bridge — Make Playground Work (1-2 days)

**Goal:** Fill the backend gap so `scripts/playground.html` actually runs.

**Deliverables:**
- `@agentforge/server` package skeleton
- SSE streaming endpoint: `POST /api/sessions/:id/chat/stream`
- Session CRUD: `POST /api/sessions`, `GET /api/sessions/:id`, `DELETE /api/sessions/:id`
- Config endpoint: `GET /api/config`
- `observableToSSE()` helper
- Node.js HTTP adapter
- `agentforge server` CLI command

**Success Criteria:** Open `playground.html`, type a message, see streaming agent response with events.

### Phase 1: Server + Client SDK (1 week)

**Goal:** Production-ready server package and client SDK.

**Deliverables:**
- Full API: agents CRUD, sessions, config, HITL answer
- `@agentforge/client` TypeScript SDK
- `InMemorySessionStore` and `FileConfigStore`
- `agentforge dev` CLI command (starts server + watches config dir)
- Error handling, CORS, request validation
- Integration tests

**Success Criteria:** `npm run test:server` passes all tests. Client SDK can stream agent execution.

### Phase 2: Vue Studio App (2-3 weeks)

**Goal:** Replace `playground.html` with a proper Vue SPA.

**Deliverables:**
- Vue 3 + Vite project setup
- Agent list sidebar
- Agent chat playground (SSE streaming)
- Event timeline (real-time event feed)
- Config editor (L1AgentConfigSchema-driven form)
- HITL approval UI
- Dark theme
- Responsive layout

**Success Criteria:** Studio enables creating agents, chatting with them, seeing events, and editing configs — all from the browser.

### Phase 3: Observability + Polish (1-2 weeks)

**Goal:** Production-ready Studio with monitoring.

**Deliverables:**
- Observability dashboard (M8 metrics: token count, step count, latency)
- Session persistence (SQLite)
- Multi-session support
- Error display and retry
- `agentforge dev` hot reload
- Documentation

**Success Criteria:** Studio is usable as a daily development tool.

### Phase 4 (Future): Workflow Visual Editor

**Goal:** React Flow-like workflow graph editor.

**Prerequisites:** Workflow step serialization model (replace `z.function()` with template strings).

**This is deferred per D5.**

---

## 10. Relationship to Existing Code

| Existing Code | Action | Reason |
|---|---|---|
| `src/app/application.ts` | **Replace** (Phase 1) | `@agentforge/server` supersedes this; reuse health/metrics logic but as a new independent package |
| `scripts/playground.html` | **Keep** (Phase 0) | Validation target for Phase 0 |
| `scripts/playground.html` | **Replace** (Phase 2) | Replaced by Vue Studio |
| `src/l1/index.ts` | **Use directly** | L1AgentConfigSchema = Studio config format |
| `src/core/events.ts` | **Use directly** | 50+ event types = SSE event types |
| `src/api/create-agent.ts` | **Use directly** | Server calls `createAgent()` |
| `src/api/types.ts` | **Use directly** | `AgentConfig` = runtime config |
| `src/core/context-builder.ts` | **Use directly** | Programmatic context assembly |
| `src/workflow/types.ts` | **Use directly** (Phase 4) | Workflow graph data model |

### What NOT to Change

- **Core framework** (`src/core/`, `src/loop/`, `src/contracts/`): View-only. The server is a consumer, not a modifier.
- **Event schemas** (`src/core/events.ts`): Already JSON-serializable. No changes needed.
- **Agent API** (`src/api/`): `createAgent()` and `agent.run$()` work perfectly. Server just wraps them.
- **Workflow types** (`src/workflow/types.ts`): Phase 4 may add a serializable variant, but existing code stays.

---

## 11. Resolved Questions

| # | Question | Decision | Rationale |
|---|---|---|---|
| Q2 | Agent instance lifecycle: One per session? Reuse across messages? | **One agent per chat request, ephemeral** | `run$()` doesn't accept history — it must be set at creation. Each chat turn creates a new agent with `history: session.messages`. Agent is destroyed after response. No idle timeout needed. The `DefaultHITLController` persists across the session, not across agent instances. |
| Q3 | Config hot-reload: chokidar vs manual? | **Phase 0-1: manual button. Phase 2+: chokidar in dev mode.** | Manual is simpler to start. Hot-reload is a DX improvement, not a blocker. |
| Q4 | Auth: None vs API key vs JWT? | **Phase 0-1: None. Phase 2+: pluggable auth middleware.** | The server handler signature includes a `requestContext` that can carry auth info. Auth middleware is a cross-cutting concern added by the adapter layer, not the handlers. |
| Q5 | CORS: Allow all in dev, configurable in prod? | **Yes.** Standard pattern. |
| Q6 | Package naming: scope? | **Use the existing npm scope: `@primo512109/agentforge-server`** | Follows the existing `@primo512109/agentforge` convention. Package names are `@primo512109/agentforge-server`, `@primo512109/agentforge-client`. Import shorthand: `agentforge/server`, `agentforge/client` (via package.json exports map). |

> **Note on Q2 and concurrency**: Since each chat request creates a new ephemeral agent, there is no shared mutable state across concurrent requests for the same session. However, the `InMemorySessionStore` must handle concurrent writes to `messages` and `events` arrays. The implementation should use a simple queue or mutex per session ID to serialize message appends.

### Phase 0 Known Limitations

- **In-memory session store**: All chat history and events are lost on server restart. Acceptable for development. Phase 3 adds SQLite persistence.
- **No auth**: Server listens on localhost only. Phase 2+ adds API key middleware.
- **Synchronous config I/O**: The existing `loadConfig()` uses `readFileSync`. The `FileConfigStore` uses `fs/promises` to avoid blocking the event loop.
- **HITL concurrency**: Only one active agent execution per session. Concurrent requests return 409 Conflict.
- **Event growth**: `GET /api/sessions/:id` returns last N events (default 200) to prevent memory bloat. Full event history is available via pagination.

### Design Risks & Mitigations (Addressed in Review)

| Risk | Severity | Mitigation |
|------|----------|------------|
| AbortSignal listener leak in SSE | 🔴 High | `cleanup()` function in §5.4 removes listener on all exit paths (complete, error, abort) |
| HITL concurrent agent conflict | 🔴 High | One active run per session (tracked via `activeRun: AbortController`). Concurrent requests → 409 |
| Session event array unbounded growth | 🟡 Medium | `eventLimit` + `eventOffset` pagination on GET endpoint. Default returns last 200 events |
| FileConfigStore write race condition | 🟡 Medium | Atomic write (write temp file → rename). Not file-locking, but prevents corrupted files on crash |
| No SSE reconnection mechanism | 🟡 Medium | §5.5 defines reconnection protocol with `id` field. Phase 0 uses simple retry; Phase 1 adds full replay |
| Config Editor two-way sync | 🟢 Low | Ephemeral agents read config on each chat turn, so edits are picked up automatically on next message. No notification needed |