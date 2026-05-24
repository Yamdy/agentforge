<!-- Generated: 2026-05-24 | Files scanned: 60 | Token estimate: ~800 -->

# Backend Architecture

## Server Stack

```
AgentForgeServer (Hono on Node.js)
  ├── Middleware: auth → logger → rate-limit → CORS
  ├── Routes
  ├── WebSocketBridge (optional, requires 'ws' package)
  └── StudioObservability (optional, mounted at /api/studio)
```

## API Routes

### Agents
```
GET    /agents                     → registry.list()
GET    /agents/:id                 → registry.get(id).state
POST   /agents/:id/run             → agent.run(input) → SSE stream
POST   /agents/:id/stream          → agent.stream(input) → SSE stream
POST   /agents/:id/resume          → agent.resume(sessionId)
```

### Sessions
```
GET    /sessions                   → storage.list(filter?)
GET    /sessions/status            → aggregated status counts
GET    /sessions/:id               → storage.get(id)
GET    /sessions/:id/messages      → storage.getMessages(id)
GET    /sessions/:id/events        → storage.read(id) → SSE stream
POST   /sessions/:id/abort         → agent.abort()
POST   /sessions/:id/prompt        → session prompt (non-stream)
POST   /sessions/:id/prompt/stream → session prompt (SSE stream)
DELETE /sessions/:id               → storage.delete(id)
```

### Permissions
```
GET    /permissions/pending                  → pendingPermissions.list()
GET    /permissions/pending/:permissionId    → pendingPermissions.get()
POST   /permissions/pending/:permissionId/respond → resolve permission
```

### Providers & MCP
```
GET    /providers                  → modelFactory.listProviders()
GET    /mcp                        → mcpManager.listStatus()
GET    /mcp/:name/tools            → mcpManager.listTools(name)
POST   /mcp                        → mcpManager.connect(config)
DELETE /mcp/:name                   → mcpManager.disconnect(name)
POST   /mcp/:name/reconnect        → mcpManager.reconnect(name)
```

### Health
```
GET    /health                     → { status, timestamp }
GET    /health/live                → liveness probe
GET    /health/ready               → readiness probe (checks registry)
```

### A2A Protocol (optional)
```
GET    /a2a/.well-known/agent-card.json → AgentCard
POST   /a2a/jsonrpc                      → JSON-RPC handler
GET    /a2a/tasks/:id/stream             → task event stream
```

### Studio API (optional)
```
GET    /api/studio/agents          → registered agents
GET    /api/studio/metrics         → histogram stats
GET    /api/studio/metrics/kpi     → KPI summary
GET    /api/studio/sessions        → session list
GET    /api/studio/sessions/:id    → session detail
GET    /api/studio/sessions/:id/events → session events
GET    /api/studio/traces          → trace list
GET    /api/studio/traces/:id      → trace detail
```

## Key Files

| File | Role |
|------|------|
| `server/src/server.ts` | AgentForgeServer class, route mounting, middleware |
| `server/src/registry.ts` | AgentRegistry — agent registration + lookup |
| `server/src/bridge/bridge.ts` | WebSocketBridge — live event forwarding |
| `server/src/session-event-stream.ts` | SSE adapter for session events |
| `server/src/sse.ts` | SSE serialization utilities |
| `server/src/middleware/auth.ts` | Auth middleware (pluggable AuthAdapter) |
| `server/src/middleware/rate-limit.ts` | Sliding window rate limiter |
| `server/src/middleware/logger.ts` | Request logging middleware |
| `server/src/a2a/server.ts` | A2A JSON-RPC request handler |
| `server/src/a2a/routes.ts` | A2A HTTP route mounting |
| `server/src/profiles/` | Agent profiles (coding, business, personal, data) |
| `server/src/config-loader.ts` | Config loading from .agentforge/ |

## Middleware Chain

```
Request → AuthAdapter → Logger → RateLimit → CORS → Route Handler → Response
```

Auth and RateLimit are optional (configured via ServerOptions).
