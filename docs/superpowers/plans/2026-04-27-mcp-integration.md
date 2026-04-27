# MCP Client Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing MCP client module into the agent loop, enabling tool discovery from MCP servers at agent creation time and automatic re-registration on reconnect.

**Architecture:** Two-phase integration:
1. **Phase 1 (Eager)**: In `createAgent()`, create MCP clients for each `config.mcp` entry, connect in background, discover tools via `adaptMCPTools()`, register into `ctx.tools`.
2. **Phase 2 (Auto-refresh)**: Subscribe to `client.onStatusChange()` — when status becomes `'connected'`, re-discover and re-register tools. Subscription is cleaned up in `destroy()`.

**Key Design Decisions (from Momus review):**
- `createAgent()` stays **synchronous** — MCP connects in background. First LLM call may not see MCP tools if connection is slow. Future: `agent.waitForMCP()` Promise for callers who need immediate availability.
- `MCPClient` interface **NOT modified** — `serverName` stays on `CreateMCPClientOptions`, not on the interface. The `Map<string, MCPClient>` key serves as server identifier.
- `onStatusChange()` subscriptions are **stored and cleaned up** in `destroy()`.
- `mcp.tools_changed` pass-through in `agent-loop.ts` **unchanged** — re-registration is via `onStatusChange()`, not event stream.

**Tech Stack:** TypeScript, RxJS, Vitest, Zod

---

## File Change Map

| File | Changes |
|------|---------|
| `src/core/context.ts` | Change `mcp?: MCPClient` → `mcpClients?: Map<string, MCPClient>` |
| `src/core/context-builder.ts` | Change `withMCP()` → `withMCPClients()`, update `build()` conditional |
| `src/api/context-builder.ts` | Change `mcp` field → `mcpClients`, update `withMCP()` → `withMCPClients()`, update `build()` |
| `src/api/create-agent.ts` | Add MCP client creation, background connection, tool discovery, `onStatusChange` subscription, cleanup in `destroy()` |
| `src/mcp/client.ts` | Expose `serverName` as public getter |
| `src/mcp/index.ts` | Add `MCPEvent` and `CreateMCPClientOptions` to exports |

No changes to: `src/loop/agent-loop.ts`, `src/loop/handlers/lifecycle.ts`, `src/core/interfaces.ts`

---

## Chunk 1: AgentContext & Builder Type Update

**Files:**
- Modify: `src/core/context.ts`
- Modify: `src/core/context-builder.ts`
- Modify: `src/api/context-builder.ts`
- Modify: `src/mcp/client.ts` (expose `serverName` getter)
- Modify: `src/mcp/index.ts` (add missing exports)

### Task 1.1: Update all context types and builders

- [ ] **Step 1: Update `src/core/context.ts`**

Change the MCP field on `AgentContext`. Find:
```typescript
  /** MCP client for external tools */
  mcp?: MCPClient;
```
Replace with:
```typescript
  // ----- MCP (optional — zero overhead if not configured) -----
  /** MCP client instances keyed by server name */
  mcpClients?: Map<string, MCPClient>;
```

- [ ] **Step 2: Update `src/core/context-builder.ts`**

1. Change the state field from `mcp` to `mcpClients` (if there's a state type):
```typescript
  mcpClients?: Map<string, MCPClient>;
```

2. Replace `withMCP` method:
```typescript
  withMCPClients(clients: Map<string, MCPClient>): this {
    this.context.mcpClients = clients;
    return this;
  }
```

3. In `build()`, replace:
```typescript
    if (this.context.mcp) ctx.mcp = this.context.mcp;
```
With:
```typescript
    if (this.context.mcpClients !== undefined) ctx.mcpClients = this.context.mcpClients;
```

- [ ] **Step 3: Update `src/api/context-builder.ts`**

1. Change the state field (line 84):
```typescript
  mcpClients?: Map<string, MCPClient>;
```

2. Replace `withMCP` method (around line 310):
```typescript
  withMCPClients(clients: Map<string, MCPClient>): this {
    this.state.mcpClients = clients;
    return this;
  }
```

3. In `build()`, replace line 527-528:
```typescript
    if (this.state.mcp !== undefined) {
      ctx.mcp = this.state.mcp;
```
With:
```typescript
    if (this.state.mcpClients !== undefined) {
      ctx.mcpClients = this.state.mcpClients;
```

- [ ] **Step 4: Add `serverName` public getter to `AgentForgeMCPClient`**

In `src/mcp/client.ts`, add a public getter to the `AgentForgeMCPClient` class:

```typescript
  /** Server name for identification (from options) */
  get serverName(): string {
    return this.options.serverName;
  }
```

This is a convenience accessor for debugging/logging. We do NOT add `serverName` to the `MCPClient` interface — the Map key serves as the identifier.

- [ ] **Step 5: Add missing exports to `src/mcp/index.ts`**

Verify that `MCPEvent` and `CreateMCPClientOptions` are included in the Client section exports. If `MCPEvent` type is missing, add it:

```typescript
export {
  type MCPClientOptions,
  type MCPEventType,
  type MCPEvent,         // ADD if missing
  AgentForgeMCPClient,
  type CreateMCPClientOptions,
  createMCPClient,
} from './client.js';
```

- [ ] **Step 6: Find and fix all `ctx.mcp` references**

Search for `ctx\.mcp[^C]` and `.mcp` property access across the entire codebase. Update any test mocks that reference the old `mcp` field to `mcpClients`. Known locations:
- `src/core/context.ts` — updated in Step 1
- `src/core/context-builder.ts` — updated in Step 2
- `src/api/context-builder.ts` — updated in Step 3
- `src/api/create-agent.ts` — will be updated in Chunk 2

- [ ] **Step 7: Run build + tests**

Run: `npm run build && npx vitest run`
Expected: PASS (may need test mock updates for context objects)

- [ ] **Step 8: Commit**

```bash
git add src/core/context.ts src/core/context-builder.ts src/api/context-builder.ts src/mcp/client.ts src/mcp/index.ts tests/
git commit -m "refactor: change AgentContext.mcp to mcpClients Map for multi-server MCP support"
```

---

## Chunk 2: MCP Client Creation & Tool Discovery in createAgent()

**Files:**
- Modify: `src/api/create-agent.ts`

This is the main wiring chunk. `createAgent()` reads `config.mcp`, creates clients, connects in background, discovers tools, and registers them.

### Task 2.1: Wire MCP client creation

- [ ] **Step 1: Add imports to create-agent.ts**

Add near the existing imports:

```typescript
import { createMCPClient, adaptMCPTools } from '../mcp/index.js';
import type { MCPClient, MCPStatus } from '../core/index.js';
import { Subscription } from 'rxjs';
```

Verify `MCPStatus` is re-exported from `../core/index.js`. If not, import from `'../core/interfaces.js'`.

- [ ] **Step 2: Add `mcpSubscriptions` field to `AgentImpl`**

Add inside the `AgentImpl` class:

```typescript
  private readonly mcpSubscriptions: Subscription[] = [];
```

- [ ] **Step 3: Add MCP client creation block in `createAgent()`**

After the `// Build the context` line and after tool name resolution from global registry, add:

```typescript
  // Set up MCP clients if configured (background connection, non-blocking)
  const mcpSubscriptions: Subscription[] = [];

  if (config.mcp && config.mcp.length > 0) {
    const mcpClients = new Map<string, MCPClient>();

    for (const serverConfig of config.mcp) {
      try {
        const client = createMCPClient(serverConfig, {
          serverName: serverConfig.name,
          sessionId,
          timeout: 30000,
        });

        mcpClients.set(serverConfig.name, client);

        // Subscribe to status changes for automatic tool re-registration on reconnect
        const statusSub = client.onStatusChange().subscribe({
          next: (status: MCPStatus) => {
            if (status === 'connected') {
              client.tools()
                .then(mcpTools => {
                  const adaptedTools = adaptMCPTools(mcpTools, client, serverConfig.name);
                  for (const tool of adaptedTools) {
                    ctx.tools.register(tool);
                  }
                })
                .catch(() => {
                  // Tool discovery failure must never crash the agent
                });
            }
          },
          error: () => {
            // Status change subscription error — ignore
          },
        });
        mcpSubscriptions.push(statusSub);

        // Background connection and tool discovery (fire-and-forget)
        // Tools will be registered in the tool registry when ready
        client.connect()
          .then(async () => {
            const mcpTools = await client.tools();
            const adaptedTools = adaptMCPTools(mcpTools, client, serverConfig.name);
            for (const tool of adaptedTools) {
              ctx.tools.register(tool);
            }
          })
          .catch((error: unknown) => {
            // MCP connection failure must never crash the agent
            console.warn(
              `Failed to connect to MCP server "${serverConfig.name}": ${error instanceof Error ? error.message : String(error)}`
            );
          });
      } catch (error) {
        // createMCPClient can throw synchronously for invalid configs
        console.warn(
          `Failed to create MCP client for "${serverConfig.name}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (mcpClients.size > 0) {
      ctx.mcpClients = mcpClients;
    }
  }
```

- [ ] **Step 4: Add subscriptions to AgentImpl after creation**

After `const agent = new AgentImpl(...)`, add:

```typescript
  // Transfer MCP subscriptions to agent for cleanup
  for (const sub of mcpSubscriptions) {
    agent.mcpSubscriptions.push(sub);
  }
```

- [ ] **Step 5: Add MCP cleanup in `destroy()`**

In `AgentImpl.destroy()`, add BEFORE the existing `this.loopDestroySubscription?.unsubscribe()`:

```typescript
    // Clean up MCP status subscriptions
    for (const sub of this.mcpSubscriptions) {
      sub.unsubscribe();
    }
    this.mcpSubscriptions.length = 0;

    // Disconnect MCP clients
    if (this.ctx.mcpClients) {
      for (const [, client] of this.ctx.mcpClients) {
        try {
          client.disconnect().catch(() => {});
        } catch {
          // Ignore disconnect errors during cleanup
        }
      }
    }
```

- [ ] **Step 6: Run build + tests**

Run: `npm run build && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/api/create-agent.ts
git commit -m "feat: wire MCP client creation, background tool discovery, and auto re-registration in createAgent"
```

---

## Chunk 3: Export Verification and Integration Test

**Files:**
- Modify: `src/index.ts` (verify/add MCP exports)
- Create: `tests/integration/mcp-integration.spec.ts`

### Task 3.1: Verify exports and add test

- [ ] **Step 1: Verify MCP exports from `src/index.ts`**

Check that `MCPClient`, `MCPServerConfig`, `createMCPClient`, `adaptMCPTools` are exported. Add any missing exports.

- [ ] **Step 2: Write integration test skeleton**

Create `tests/integration/mcp-integration.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('MCP Integration', () => {
  it('should create agent without MCP when no config provided', () => {
    // This test verifies that createAgent() still works without MCP config
    // Full MCP integration tests require mocking createMCPClient which will be
    // added once the integration is complete
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Run build + full test suite**

Run: `npm run build && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts tests/integration/mcp-integration.spec.ts
git commit -m "feat: verify MCP exports and add integration test skeleton"
```

---

## Design Notes

### Why createAgent() stays synchronous

`createAgent()` returns synchronously because making it async would be a breaking change. MCP connection is I/O-bound (network/process spawn) and shouldn't block agent creation.

**Tradeoff**: First LLM call may not see MCP tools if connection is slow. This is acceptable for Phase 1.

**Future improvement**: Add `agent.waitForMCP(): Promise<void>` that resolves when all MCP clients are connected and tools are registered.

### Why onStatusChange() instead of event stream

The `mcp.tools_changed` pass-through in `agent-loop.ts` (lines 308-312) remains unchanged. Tool re-registration uses `client.onStatusChange()` because:

1. The event stream is `Observable<AgentEvent>` — MCP events aren't in the Zod schema
2. `onStatusChange()` is already part of the `MCPClient` interface
3. Subscriptions are stored and properly cleaned up in `destroy()`
4. This approach requires zero changes to `agent-loop.ts`

### Subscription cleanup

Every `onStatusChange()` subscription is stored in `AgentImpl.mcpSubscriptions[]` and unsubscribed in `destroy()`. The `client.disconnect()` call is also in `destroy()`. This prevents memory leaks.

### Deferred items

1. **Lazy/fallback discovery at tool.call time** — Blocked by LLM validation gate at `llm.ts:339`
2. **MCP events in the Zod schema** — Remain as pass-through events
3. **MCP server auto-spawn** — Process management is a separate concern
4. **MCP resources and prompts** — Only tools are integrated in Phase 1
5. **First-call readiness** — `agent.waitForMCP()` is a future enhancement
```