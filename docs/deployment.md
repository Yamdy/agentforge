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
  "version": "0.1.5",
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

### Studio UI

The embedded Studio UI is built as part of the Docker image. To enable it, add the `--studio` flag:

```dockerfile
# Dockerfile entrypoint
ENTRYPOINT ["node", "packages/server/dist/bin.js", "serve", "--studio"]
```

Or override in docker-compose:

```yaml
services:
  agentforge:
    command: serve --studio --port 3000
```

The Studio SPA is served at `/studio/` with API endpoints at `/api/studio/*`.

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

### SQLite

基于 better-sqlite3 的 SQLite 存储（需安装 `better-sqlite3`）：

```jsonc
{
  "session": {
    "storage": "sqlite",
    "path": "./data/sessions.db"
  }
}
```

支持 WAL 模式并发读，`getMessages()` 支持 limit/before 分页查询。

> **依赖**: `npm install better-sqlite3`（可选，未安装时自动回退到文件模式）

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
  async get(sessionId: string): Promise<SessionRecord | undefined> { /* ... */ }
  async delete(sessionId: string): Promise<void> { /* ... */ }
  async getMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<Message[]> { /* ... */ }
}
```


## 可观测性

AgentForge 自动检测以下环境变量并启用 OTLP trace 导出：

| 环境变量 | 说明 |
|----------|------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP 导出端点（如 `http://localhost:4318/v1/traces`） |
| `OTEL_SERVICE_NAME` | 服务名称（默认 `agentforge`） |
| `OTEL_TRACES_SAMPLER` | 采样策略：`always_on` / `always_off` / `parentbased_traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | 采样比率（0.0-1.0，仅 `traceidratio` 模式生效） |

```bash
# 启用 OTLP trace 导出到 Jaeger
docker run -p 3000:3000 \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces \
  -e OTEL_TRACES_SAMPLER=always_on \
  agentforge
```

无需代码改动，Trace 自动关联跨服务调用链。也可编程式配置：

```typescript
import { autoDetectOtelTracer } from '@primo-ai/core';

const tracer = autoDetectOtelTracer({ ratio: 0.25 });
const agent = new Agent(config, { tracer });
```

## 限流

通过 `rateLimit` 配置服务器级限流：

```typescript
const server = new AgentForgeServer({
  rateLimit: {
    windowMs: 60_000,    // 滑动窗口时长（毫秒）
    maxRequests: 100,    // 窗口内最大请求数
  },
});
```

认证失败不计入限流（`429 Too Many Requests` 仅在成功认证后计数）。超出限制时返回 429 状态码，含标准 `Retry-After`、`X-RateLimit-Limit`、`X-RateLimit-Remaining` 响应头。
