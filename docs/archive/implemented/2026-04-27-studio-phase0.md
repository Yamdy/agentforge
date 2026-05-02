# Studio Phase 0: SSE Bridge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `scripts/playground.html` functional by building the missing backend API — Session CRUD, SSE streaming, and config endpoint — as a new `@primo512109/agentforge-server` package with zero changes to core framework code.

**Architecture:** New `packages/server/` package implements framework-agnostic HTTP handlers that call `createAgent()` + `agent.run()` from the existing API, pipe events via `AgentEventEmitter` to SSE, and manage sessions in memory. A new `agentforge server` CLI command starts it. The existing `playground.html` connects without modification.

**Tech Stack:** TypeScript, Node.js `http` module (no Express/Hono dependency for Phase 0), AgentEventEmitter (eventToSSE), Vitest for tests, `@primo512109/agentforge` as workspace dependency.

**Design doc:** `docs/design/studio-design.md`

---

## File Structure

```
packages/server/
├── package.json
├── tsconfig.json
├── vitest.config.mts
├── src/
│   ├── index.ts                    # Public API exports
│   ├── types.ts                    # RequestContext, AgentForgeServer, Session, etc.
│   ├── sse.ts                      # observableToSSE() + parseSSEStream()
│   ├── session-store.ts            # InMemorySessionStore
│   ├── config-store.ts            # FileConfigStore (async fs/promises)
│   ├── agent-factory.ts            # Creates ephemeral agents from L1 configs
│   ├── handlers/
│   │   ├── sessions.ts             # POST/GET/DELETE sessions, POST chat/stream, POST clear, POST hitl/answer
│   │   ├── agents.ts               # GET agents, GET agents/:id, POST agents/:id/run/stream
│   │   ├── config.ts               # GET config
│   │   └── health.ts               # GET health (reuse Application logic)
│   ├── router.ts                   # URL → handler routing
│   └── server.ts                   # createServer() entry point
└── tests/
    ├── sse.spec.ts
    ├── session-store.spec.ts
    ├── config-store.spec.ts
    ├── handlers.spec.ts
    └── server.spec.ts
```

**No existing files are modified.** The only change to the existing repo is:
- `package.json` — add `"./server"` to the `exports` map (1 line)
- `src/cli/index.ts` or a new `src/cli/server.ts` — add `agentforge server` command

---

## Chunk 1: Package Scaffold + SSE Helper

### Task 1: Create package scaffold

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.mts`
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Create `packages/server/package.json`**

```json
{
  "name": "@primo512109/agentforge-server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext .ts",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@primo512109/agentforge": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0",
    "rimraf": "^5.0.7"
  },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=18.0.0" }
}
```

- [ ] **Step 2: Create `packages/server/tsconfig.json`**

Follow the parent project's strict TS config pattern (from `C:\Users\90514\bug\agentforge\tsconfig.json`), with `rootDir: "./src"`, `outDir: "./dist"`, and same strict flags including `verbatimModuleSyntax: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

- [ ] **Step 3: Create `packages/server/vitest.config.mts`**

Same as parent project's `vitest.config.mts` but with `include: ['tests/**/*.spec.ts']`.

- [ ] **Step 4: Create `packages/server/src/index.ts`**

Placeholder that will export public API. For now:

```typescript
/**
 * @primo512109/agentforge-server
 *
 * HTTP/SSE server for AgentForge Studio.
 * @module
 */

export { createAgentForgeServer } from './server.js';
export { observableToSSE, parseSSEStream } from './sse.js';
export { InMemorySessionStore } from './session-store.js';
export { FileConfigStore } from './config-store.js';
export type { RequestContext, AgentForgeServer, Session, ChatMessage } from './types.js';
```

- [ ] **Step 5: Run `pnpm install` from repo root to link workspace dependency**

Run: `pnpm install` from `C:\Users\90514\bug\agentforge`
Expected: Installs dependencies, links `@primo512109/agentforge` workspace reference.

- [ ] **Step 6: Commit**

```bash
git add packages/server/
git commit -m "feat(server): scaffold @primo512109/agentforge-server package"
```

---

### Task 2: Implement SSE helper (`observableToSSE` + `parseSSEStream`)

**Files:**
- Create: `packages/server/src/sse.ts`
- Create: `packages/server/tests/sse.spec.ts`

- [ ] **Step 1: Write failing tests for `observableToSSE`**

```typescript
// packages/server/tests/sse.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { observableToSSE, parseSSEStream } from '../src/sse.js';
import type { AgentEvent } from '@primo512109/agentforge';

describe('observableToSSE', () => {
  it('should convert a single event to SSE format', async () => {
    const event: AgentEvent = {
      type: 'agent.start',
      timestamp: new Date().toISOString(),
      sessionId: 'test-123',
      input: 'hello',
      agentName: 'test-agent',
      model: { provider: 'openai', model: 'gpt-4o' },
    } as AgentEvent;

    const events = [event];
    const response = observableToSSE(toAsyncGen(events));

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');

    const text = await response.text();
    expect(text).toContain(`data: ${JSON.stringify(event)}`);
    expect(text).toContain('data: [DONE]');
  });

  it('should convert multiple events to SSE format', async () => {
    const events: AgentEvent[] = [
      { type: 'agent.step', timestamp: new Date().toISOString(), sessionId: 's1', step: 1, maxSteps: 5 } as AgentEvent,
      { type: 'agent.complete', timestamp: new Date().toISOString(), sessionId: 's1', output: 'done' } as AgentEvent,
    ];

    const response = observableToSSE(toAsyncGen(events));
    const text = await response.text();

    expect(text).toContain('"type":"agent.step"');
    expect(text).toContain('"type":"agent.complete"');
    expect(text).toContain('data: [DONE]');
  });

  it('should handle errors', async () => {
    async function* errorGen(): AsyncGenerator<AgentEvent> {
      throw new Error('LLM failed');
    }

    const response = observableToSSE(errorGen());
    const text = await response.text();

    expect(text).toContain('"type":"agent.error"');
    expect(text).toContain('data: [DONE]');
  });

  it('should unsubscribe on AbortSignal', async () => {
    const controller = new AbortController();
    
    // Emit one event then wait
    async function* slowGen(): AsyncGenerator<AgentEvent> {
      yield { type: 'agent.step', timestamp: new Date().toISOString(), sessionId: 's1', step: 1, maxSteps: 5 } as AgentEvent;
      await new Promise(r => setTimeout(r, 1000)); // Long delay
      yield { type: 'agent.complete', timestamp: new Date().toISOString(), sessionId: 's1', output: 'done' } as AgentEvent;
    }

    const response = observableToSSE(slowGen(), controller.signal);

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);

    // The response stream should close
    const reader = response.body!.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // Stream may throw on abort
    }
  });

  it('should clean up abort listener on completion', async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [
      { type: 'agent.complete', timestamp: new Date().toISOString(), sessionId: 's1', output: 'done' } as AgentEvent,
    ];

    // Track listener count before
    const initialListenerCount = controller.signal.listeners('abort').length;

    const response = observableToSSE(toAsyncGen(events), controller.signal);
    await response.text();

    // After completion, listener should be cleaned up
    await new Promise((r) => setTimeout(r, 10));

    const finalListenerCount = controller.signal.listeners('abort').length;
    expect(finalListenerCount).toBe(initialListenerCount);
  });
});

describe('parseSSEStream', () => {
  it('should parse SSE text into events', () => {
    const sseText = [
      'data: {"type":"agent.step","step":1}',
      '',
      'data: {"type":"agent.complete","output":"hello"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const events: AgentEvent[] = [];
    parseSSEStream(sseText, (event) => events.push(event));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('agent.step');
    expect(events[1].type).toBe('agent.complete');
  });

  it('should call onDone when [DONE] is received', () => {
    const sseText = 'data: [DONE]\n\n';
    let doneCalled = false;

    parseSSEStream(sseText, () => {}, () => { doneCalled = true; });
    expect(doneCalled).toBe(true);
  });

  it('should skip malformed events', () => {
    const sseText = [
      'data: {"type":"agent.step","step":1}',
      '',
      'data: not-json',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const events: AgentEvent[] = [];
    parseSSEStream(sseText, (event) => events.push(event));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent.step');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL — module not found for `../src/sse.js`

- [ ] **Step 3: Implement `observableToSSE` and `parseSSEStream`**

```typescript
// packages/server/src/sse.ts
import type { AgentEvent } from '@primo512109/agentforge';

/**
 * Convert an AsyncGenerator<AgentEvent> stream to an SSE Response.
 *
 * Handles:
 * - Normal events → `data: <JSON>\n\n`
 * - Terminal event → `data: [DONE]\n\n`
 * - Errors → `data: {"type":"agent.error",...}\n\n` + `data: [DONE]\n\n`
 * - Client disconnect (AbortSignal) → close stream
 * - Memory cleanup → remove abort listener on all exit paths
 */
export function observableToSSE(
  events: AsyncGenerator<AgentEvent>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  const encoder = new TextEncoder();
  
  try {
    for await (const event of events) {
      if (signal?.aborted) break;
      yield `data: ${JSON.stringify(event)}\n\n`;
    }
  } catch (err: unknown) {
    const errorEvent = {
      type: 'agent.error',
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? { name: err.name, message: err.message } : { name: 'UnknownError', message: String(err) },
    };
    yield `data: ${JSON.stringify(errorEvent)}\n\n`;
  } finally {
    yield 'data: [DONE]\n\n';
  }
}

/**
 * Parse SSE text data into events (for testing and client-side parsing).
 * This is a synchronous parser suitable for test environments.
 * The actual client SDK uses the async parseSSEStream() in the client package.
 */
export function parseSSEStream(
  sseText: string,
  onEvent: (event: AgentEvent) => void,
  onDone?: () => void,
): void {
  const lines = sseText.split('\n');

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;

    const data = line.slice(6); // Remove 'data: ' prefix

    if (data === '[DONE]') {
      onDone?.();
      return;
    }

    try {
      const event = JSON.parse(data) as AgentEvent;
      onEvent(event);
    } catch {
      // Skip malformed events
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && pnpm test -- tests/sse.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sse.ts packages/server/tests/sse.spec.ts
git commit -m "feat(server): implement observableToSSE with AbortSignal cleanup and SSE parser"
```

---

## Chunk 2: Session Store + Config Store

### Task 3: Implement InMemorySessionStore

**Files:**
- Create: `packages/server/src/types.ts`
- Create: `packages/server/src/session-store.ts`
- Create: `packages/server/tests/session-store.spec.ts`

- [ ] **Step 1: Write failing tests for InMemorySessionStore**

Test:
- `create()` returns a session with id, empty messages/events
- `get()` returns session by id
- `get()` returns undefined for unknown id
- `delete()` removes a session
- `addMessage()` adds a message to session
- `addEvent()` adds an event to session
- `clear()` empties messages and events but keeps session
- Concurrent safety: adding messages to the same session doesn't lose data

- [ ] **Step 2: Run tests, verify failures**

Run: `cd packages/server && pnpm test -- tests/session-store.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `types.ts` with shared interfaces**

```typescript
// packages/server/src/types.ts
import type { AgentEvent, Message } from '@primo512109/agentforge';
import type { L1AgentConfig } from '@primo512109/agentforge/l1';
import type { DefaultHITLController } from '@primo512109/agentforge';

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
  /** HITL controller lives as long as the session, not the agent instance */
  hitlController: DefaultHITLController;
  /** Tracks active run for concurrency control and cancellation */
  activeRun: AbortController | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestContext {
  server: AgentForgeServer;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  request: Request;
}

export interface AgentForgeServer {
  configStore: import('./config-store.js').ConfigStore;
  sessionStore: import('./session-store.js').InMemorySessionStore;
  agentFactory: import('./agent-factory.js').AgentFactory;
  configDir: string;
  version: string;
}
```

- [ ] **Step 4: Implement `session-store.ts`**

```typescript
// packages/server/src/session-store.ts
import { generateId } from '@primo512109/agentforge';
import { DefaultHITLController } from '@primo512109/agentforge';
import type { AgentEvent } from '@primo512109/agentforge';
import type { L1AgentConfig } from '@primo512109/agentforge/l1';
import type { ChatMessage, Session } from './types.js';

export class InMemorySessionStore {
  private sessions = new Map<string, Session>();

  create(agentConfigId: string, configOverrides?: Partial<L1AgentConfig>): Session {
    const id = `sess_${generateId()}`;
    const now = new Date().toISOString();
    const session: Session = {
      id,
      agentConfigId,
      configOverrides,
      messages: [],
      events: [],
      hitlController: new DefaultHITLController(),
      activeRun: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (session?.activeRun) {
      session.activeRun.abort();
    }
    return this.sessions.delete(id);
  }

  addMessage(id: string, message: ChatMessage): void {
    const session = this.sessions.get(id);
    if (session) {
      session.messages.push(message);
      session.updatedAt = new Date().toISOString();
    }
  }

  addEvent(id: string, event: AgentEvent): void {
    const session = this.sessions.get(id);
    if (session) {
      session.events.push(event);
      session.updatedAt = new Date().toISOString();
    }
  }

  clear(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.messages = [];
      session.events = [];
      session.updatedAt = new Date().toISOString();
    }
  }
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd packages/server && pnpm test -- tests/session-store.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/session-store.ts packages/server/tests/session-store.spec.ts
git commit -m "feat(server): implement InMemorySessionStore with concurrency control"
```

---

### Task 4: Implement FileConfigStore

**Files:**
- Create: `packages/server/src/config-store.ts`
- Create: `packages/server/tests/config-store.spec.ts`

- [ ] **Step 1: Write failing tests for FileConfigStore**

Test:
- `listAgentConfigs()` returns all configs from a directory
- `getAgentConfig(id)` returns a specific config by ID (filename without extension)
- `getAgentConfig(id)` returns null for unknown ID
- `saveAgentConfig(id, config)` writes a validated config to disk
- `saveAgentConfig(id, invalidConfig)` throws ValidationError
- `saveAgentConfig()` uses atomic write (temp file + rename)
- `deleteAgentConfig(id)` removes the config file

- [ ] **Step 2: Run tests, verify failures**

- [ ] **Step 3: Implement `config-store.ts`**

Uses `fs/promises` for async I/O, `L1AgentConfigSchema.safeParse()` for validation, and atomic write (`writeFile(tmp) → rename(tmp, target)`).

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/config-store.ts packages/server/tests/config-store.spec.ts
git commit -m "feat(server): implement FileConfigStore with async atomic writes"
```

---

### Task 5: Implement AgentFactory

**Files:**
- Create: `packages/server/src/agent-factory.ts`
- Create: `packages/server/tests/agent-factory.spec.ts`

- [ ] **Step 1: Write failing tests for AgentFactory**

```typescript
// packages/server/tests/agent-factory.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentFactory } from '../src/agent-factory.js';
import type { L1AgentConfig } from '@primo512109/agentforge/l1';

// AgentFactory wraps createAgent/loadAgentFromConfig.
// We test that it:
// 1. Creates an agent from a valid L1 config
// 2. Passes history (messages) to the agent config
// 3. Passes HITLController to the agent context
// 4. Throws on invalid config
```

- [ ] **Step 2: Run tests, verify failures**

- [ ] **Step 3: Implement `agent-factory.ts`**

```typescript
// packages/server/src/agent-factory.ts
import { createAgent, type Agent } from '@primo512109/agentforge';
import { loadAgentFromConfig, type L1AgentConfig } from '@primo512109/agentforge/l1';
import type { Message } from '@primo512109/agentforge';
import type { DefaultHITLController } from '@primo512109/agentforge';

export interface AgentFactoryOptions {
  history?: Message[];
  hitlController?: DefaultHITLController;
}

export class AgentFactory {
  /**
   * Creates an ephemeral agent from an L1 config.
   * Each chat turn creates a new agent with accumulated session history.
   * The agent is destroyed after the response stream completes.
   */
  async create(config: L1AgentConfig, options?: AgentFactoryOptions): Promise<Agent> {
    const l2Config: Record<string, unknown> = {
      name: config.name,
      model: config.model,
      maxSteps: config.maxSteps,
      streaming: config.streaming,
      parallelToolCalls: config.parallelToolCalls,
    };

    // Apply optional fields (exactOptionalPropertyTypes)
    if (config.systemPrompt !== undefined) {
      l2Config.systemPrompt = config.systemPrompt;
    }
    if (config.timeout !== undefined) {
      l2Config.timeout = config.timeout;
    }
    if (config.preset !== undefined) {
      l2Config.preset = config.preset;
    }
    if (config.tools && config.tools.length > 0) {
      l2Config.tools = config.tools;
    }
    if (config.retry !== undefined) {
      l2Config.retry = config.retry.maxAttempts;
      l2Config.retryDelay = config.retry.delayMs;
    }

    // History from session (multi-turn conversation)
    if (options?.history && options.history.length > 0) {
      l2Config.history = options.history;
    }

    // Use loadAgentFromConfig which validates with Zod and creates the agent
    return loadAgentFromConfig(config);
  }
}
```

> **Note**: The `loadAgentFromConfig()` function already validates the config with Zod and creates the agent. The `options.history` needs to be passed through to the agent. Since `loadAgentFromConfig` doesn't accept history directly, we may need to use `createAgent()` instead for history support. This will be determined during implementation — the factory pattern abstracts this choice.

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agent-factory.ts packages/server/tests/agent-factory.spec.ts
git commit -m "feat(server): implement AgentFactory for ephemeral agent creation"
```

---

## Chunk 3: HTTP Handlers + Router + Server

### Task 6: Implement Session handlers

**Files:**
- Create: `packages/server/src/handlers/sessions.ts`
- Create: `packages/server/src/handlers/config.ts`
- Create: `packages/server/src/handlers/health.ts`

- [ ] **Step 1: Implement session handlers**

```typescript
// packages/server/src/handlers/sessions.ts
// Implements all 7 session endpoints that playground.html expects:
// POST   /api/sessions          → create session
// GET    /api/sessions          → list sessions
// GET    /api/sessions/:id      → get session (with eventLimit pagination)
// DELETE /api/sessions/:id      → delete session
// POST   /api/sessions/:id/clear → clear session messages/events
// POST   /api/sessions/:id/chat/stream → SSE streaming chat
// POST   /api/sessions/:id/hitl/answer → HITL answer
```

Key implementation details:
- `chat/stream` creates an ephemeral agent from session's config, appends user message to session, pipes `agent.run$()` to SSE
- Concurrency guard: if `session.activeRun` is set, return 409
- HITL answer: finds the `hitlController` on the session, calls `answer(askId, answer)`

- [ ] **Step 2: Implement config handler** (`GET /api/config`)

Returns: `{ version, availableModels, availableTools, configDir }`

- [ ] **Step 3: Implement health handler** (`GET /health`, `GET /ready`, `GET /metrics`)

Reuses the Application class concepts but implemented as simple handler functions.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/handlers/
git commit -m "feat(server): implement session, config, and health handlers"
```

---

### Task 7: Implement agent handlers

**Files:**
- Create: `packages/server/src/handlers/agents.ts`

- [ ] **Step 1: Implement agent handlers**

```typescript
// packages/server/src/handlers/agents.ts
// GET  /api/agents       → list all agent configs from config dir
// GET  /api/agents/:id   → get agent config by ID
// PUT  /api/agents/:id   → create/update agent config (for Config Editor)
// DELETE /api/agents/:id → delete agent config file
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/handlers/agents.ts
git commit -m "feat(server): implement agent config CRUD handlers"
```

---

### Task 8: Implement router + server entry point

**Files:**
- Create: `packages/server/src/router.ts`
- Create: `packages/server/src/server.ts`

- [ ] **Step 1: Implement `router.ts`**

URL path → handler function routing. Simple pattern matching (no framework dependency for Phase 0):

```typescript
// packages/server/src/router.ts
import type { RequestContext } from './types.js';

export type Handler = (ctx: RequestContext) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    // Convert /api/sessions/:id to /api/sessions/([^/]+) regex
    const paramNames: string[] = [];
    const pattern = path.replace(/:(\w+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${pattern}$`), paramNames, handler });
  }

  resolve(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]!);
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}
```

- [ ] **Step 2: Implement `server.ts`** — the main `createAgentForgeServer()` function

Creates an `http.Server`, registers all routes, wires up config/session stores and agent factory.

```typescript
// packages/server/src/server.ts
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { Router, type Handler } from './router.js';
import { InMemorySessionStore } from './session-store.js';
import { FileConfigStore } from './config-store.js';
import { AgentFactory } from './agent-factory.js';
import type { AgentForgeServer } from './types.js';

export interface ServerOptions {
  port?: number;
  configDir: string;
  version?: string;
}

export function createAgentForgeServer(options: ServerOptions): { server: Server; start: () => Promise<void> } {
  const sessionStore = new InMemorySessionStore();
  const configStore = new FileConfigStore(options.configDir);
  const agentFactory = new AgentFactory();

  const serverState: AgentForgeServer = {
    configStore,
    sessionStore,
    agentFactory,
    configDir: options.configDir,
    version: options.version ?? '0.1.0',
  };

  const router = new Router();

  // Register all routes...
  // POST /api/sessions
  // GET  /api/sessions
  // GET  /api/sessions/:id
  // DELETE /api/sessions/:id
  // POST /api/sessions/:id/clear
  // POST /api/sessions/:id/chat/stream
  // POST /api/sessions/:id/hitl/answer
  // POST /api/sessions/:id/cancel
  // GET  /api/config
  // GET  /api/agents
  // GET  /api/agents/:id
  // PUT  /api/agents/:id
  // DELETE /api/agents/:id
  // GET  /health
  // GET  /ready
  // GET  /metrics

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Route resolution → handler execution → send response
  });

  return {
    server: httpServer,
    start: () => new Promise<void>((resolve, reject) => {
      httpServer.listen(options.port ?? 3000, () => resolve());
      httpServer.on('error', reject);
    }),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/router.ts packages/server/src/server.ts
git commit -m "feat(server): implement router and HTTP server with all endpoints"
```

---

### Task 9: Integration test — playground.html should work

**Files:**
- Create: `packages/server/tests/server.spec.ts`

- [ ] **Step 1: Write integration test**

Start the server, create a session, POST chat message, verify SSE response structure (events with `data:` prefix, ending with `data: [DONE]`). Use mock LLM adapter to avoid real API calls.

- [ ] **Step 2: Run test, verify it fails (no handlers registered yet)**

- [ ] **Step 3: Wire up all route registrations in `server.ts` and make test pass**

- [ ] **Step 4: Commit**

```bash
git add packages/server/tests/server.spec.ts
git commit -m "feat(server): add integration test for full SSE flow"
```

---

## Chunk 4: CLI Command + Exports

### Task 10: Add `agentforge server` CLI command

**Files:**
- Modify: `src/cli/index.ts` (add `server` subcommand, ~15 lines)
- Or create: `src/cli/server.ts` (dedicated file, preferred)

- [ ] **Step 1: Create `src/cli/server.ts`**

```typescript
// src/cli/server.ts
import { createAgentForgeServer } from '@primo512109/agentforge-server';
import { resolve } from 'path';

export async function startServer(options: { port?: number; configDir?: string }) {
  const configDir = resolve(options.configDir ?? './agents');
  const port = options.port ?? 3000;

  console.log(`Starting AgentForge Server on port ${port}`);
  console.log(`Config directory: ${configDir}`);

  const { server, start } = createAgentForgeServer({ port, configDir });
  await start();

  console.log(`AgentForge Server running at http://localhost:${port}`);
  console.log(`Playground: http://localhost:${port}/playground`);
}
```

- [ ] **Step 2: Register the command in `src/cli/index.ts`**

Add a `server` subcommand to the Commander program. Similar to how `create-agentforge` is registered.

- [ ] **Step 3: Add `agentforge/server` export to root `package.json` exports map**

In `C:\Users\90514\bug\agentforge\package.json`, add to the `exports` object:

```json
"./server": {
  "types": "./dist/server/index.d.ts",
  "import": "./dist/server/index.js"
}
```

Wait — actually for Phase 0, the server is a separate workspace package (`packages/server/`), not a sub-path export of the main package. The CLI command just imports it. No changes to root `package.json` exports needed.

- [ ] **Step 4: Manually test: start server and open playground.html**

Run: `cd C:\Users\90514\bug\agentforge && pnpm build && node dist/cli/index.js server --port 3000 --config-dir ./agents`

Expected: Server starts on port 3000. Opening `scripts/playground.html` (or serving it via a simple static server) connects to the API.

- [ ] **Step 5: Commit**

```bash
git add src/cli/server.ts src/cli/index.ts
git commit -m "feat(cli): add agentforge server command"
```

---

### Task 11: Update index.ts exports and run full test suite

**Files:**
- Modify: `packages/server/src/index.ts` (finalize exports)

- [ ] **Step 1: Update `packages/server/src/index.ts` with final exports**

Ensure all public types and functions are exported: `createAgentForgeServer`, `observableToSSE`, `parseSSEStream`, `InMemorySessionStore`, `FileConfigStore`, `AgentFactory`, all type interfaces.

- [ ] **Step 2: Run `pnpm build` in `packages/server/` and verify no TypeScript errors**

Run: `cd packages/server && pnpm build`
Expected: Exit code 0, `dist/` directory created with `.js` and `.d.ts` files.

- [ ] **Step 3: Run full test suite**

Run: `cd packages/server && pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/
git commit -m "feat(server): finalize exports and verify build"
```

---

### Task 12: Serve playground.html from the server

**Files:**
- Modify: `packages/server/src/server.ts` (add static file serving for playground.html)

- [ ] **Step 1: Add static file serving for `playground.html`**

When `GET /` or `GET /playground` is requested, serve `scripts/playground.html` from the repo root. Use a simple `fs.readFile` approach (no Express.static dependency).

Also update `playground.html` to make the API base URL configurable (it currently hardcodes `/api/` endpoints which is correct, but the server host should be configurable).

- [ ] **Step 2: Manual test — open browser**

Run: `agentforge server --port 3000 --config-dir ./agents`
Open: `http://localhost:3000/playground`
Expected: Playground UI loads, can create session, send message, see streaming response.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/server.ts scripts/playground.html
git commit -m "feat(server): serve playground.html and verify end-to-end flow"
```

---

## Summary

| Task | Description | Key Deliverable |
|------|---------|---------|
| 1 | Package scaffold | `packages/server/` with package.json, tsconfig, vitest config |
| 2 | SSE helper | `observableToSSE()` with AbortSignal cleanup, `parseSSEStream()` |
| 3 | Session store | `InMemorySessionStore` with concurrency guard |
| 4 | Config store | `FileConfigStore` with async I/O and atomic writes |
| 5 | Agent factory | `AgentFactory` wrapping `loadAgentFromConfig()` |
| 6 | Session handlers | 7 endpoints matching playground.html expectations |
| 7 | Agent handlers | Config CRUD endpoints |
| 8 | Router + Server | URL routing and `createAgentForgeServer()` |
| 9 | Integration test | Full SSE flow test |
| 10 | CLI command | `agentforge server` command |
| 11 | Final exports | Build passes, all tests pass |
| 12 | Playground serving | Static file serving, manual E2E verification |

**No existing core code is modified** (except adding the `server` CLI subcommand to `src/cli/index.ts`). All new code lives in `packages/server/`.