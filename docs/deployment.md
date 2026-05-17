# Deployment Guide

Guide for deploying AgentForge in production environments.

## Docker

AgentForge includes a multi-stage Dockerfile for optimized production images.

### Build and Run

```bash
# Build the image
docker build -t agentforge .

# Run with environment variables
docker run -p 3000:3000 \
  -e DEEPSEEK_API_KEY=sk-xxx \
  agentforge

# Run with config mounted
docker run -p 3000:3000 \
  -v ./config:/app/.agentforge \
  agentforge
```

### Docker Compose

```yaml
services:
  agentforge:
    build: .
    ports:
      - "${AGENTFORGE_PORT:-3000}:3000"
    env_file:
      - path: .env
        required: false
    volumes:
      - ./config:/app/.agentforge
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/live"]
      interval: 30s
      timeout: 3s
      retries: 3
```

### Image Details

- **Base image**: `node:22-bookworm-slim`
- **Build stage**: Installs pnpm, native build tools (for better-sqlite3), runs `pnpm build`
- **Runtime stage**: Prod-only install, compiled JS only
- **Entrypoint**: `node packages/server/dist/bin.js serve`
- **Exposed port**: 3000

## Health Checks

AgentForge provides two health check endpoints:

| Endpoint | Purpose | Status Codes |
|----------|---------|-------------|
| `GET /health/live` | Liveness -- is the process running? | 200 (alive) |
| `GET /health/ready` | Readiness -- can it serve requests? | 200 (ready), 503 (not ready) |

The readiness check verifies that at least one agent is registered in the registry.

### Response Format

```json
{
  "status": "ok",
  "version": "0.0.1",
  "uptime": 3600,
  "agents": 3
}
```

## Authentication

### Static API Key

Pass an API key to enable Bearer token authentication:

```typescript
const server = new AgentForgeServer({
  apiKey: 'my-secret-key',
});
```

Clients must include the header: `Authorization: Bearer my-secret-key`

### Custom Auth Adapter

Implement the `AuthAdapter` interface for custom authentication:

```typescript
import type { AuthAdapter, AuthResult } from '@primo-ai/sdk';

const jwtAdapter: AuthAdapter = {
  async authenticate(request): Promise<AuthResult> {
    const token = request.header('Authorization')?.replace('Bearer ', '');
    try {
      // Verify your JWT
      return { authenticated: true };
    } catch {
      return { authenticated: false, error: 'Invalid token' };
    }
  },
};

const server = new AgentForgeServer({ authAdapter: jwtAdapter });
```

## CORS

Configure CORS for browser-based clients:

```typescript
const server = new AgentForgeServer({
  cors: {
    origin: 'https://your-app.example.com',
    methods: ['GET', 'POST'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
    maxAge: 86400,
  },
});
```

## Configuration

### Config File

Mount or copy your config to `/app/.agentforge/config.jsonc`:

```jsonc
{
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are a helpful assistant.",
      "maxIterations": 5
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | - | DeepSeek API key |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | - | Google AI API key |
| `AGENTFORGE_API_KEY` | - | Server auth key (enables Bearer auth) |
| `AGENTFORGE_PORT` | `3000` | Server listen port |

## Graceful Shutdown

The server handles graceful shutdown:

1. Stops accepting new connections
2. Waits for in-flight requests to complete (configurable timeout)
3. Closes all WebSocket connections
4. Shuts down plugin resources

```typescript
const handle = await server.start();

process.on('SIGTERM', async () => {
  await handle.close();
  process.exit(0);
});
```

Default shutdown timeout is 10 seconds. Configure via:

```typescript
const server = new AgentForgeServer({
  shutdownTimeout: 30_000,  // 30 seconds
});
```

## Timeouts

| Timeout | Default | Description |
|---------|---------|-------------|
| `requestTimeout` | 30s | HTTP request timeout |
| `shutdownTimeout` | 10s | Graceful shutdown wait |

```typescript
const server = new AgentForgeServer({
  requestTimeout: 60_000,   // 60 seconds for long LLM calls
  shutdownTimeout: 30_000,
});
```

## WebSocket

Enable WebSocket support for real-time communication:

```typescript
const server = new AgentForgeServer({
  enableWebSocket: true,
});
```

The WebSocket bridge handles agent run requests bidirectionally. Requires the `ws` npm package.

## Session Storage

### File-based (default for production)

Sessions are stored as JSONL files. Configure the storage path:

```jsonc
{
  "session": {
    "storage": "file",
    "path": "./sessions"
  }
}
```

### In-memory

For testing or stateless deployments:

```jsonc
{
  "session": {
    "storage": "memory"
  }
}
```

### Custom Storage

Implement the `SessionStorage` interface:

```typescript
import type { SessionStorage, SessionEvent, SessionRecord } from '@primo-ai/sdk';

class RedisSessionStorage implements SessionStorage {
  async append(sessionId: string, event: SessionEvent): Promise<void> { /* ... */ }
  async read(sessionId: string): AsyncIterable<SessionEvent> { /* ... */ }
  async list(filter?: { parentSessionId?: string; status?: SessionStatus }): Promise<SessionRecord[]> { /* ... */ }
  async updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void> { /* ... */ }
}
```
