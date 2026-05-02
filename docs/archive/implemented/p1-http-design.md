# P1 设计方案：HTTP 服务层完善

> 创建时间：2026-04-28
> 状态：待审查

---

## 一、现状分析

### 已有功能

| 功能 | 状态 | 文件 |
|------|------|------|
| REST API (sessions, agents, config) | ✅ | `handlers/sessions.ts`, `handlers/agents.ts`, `handlers/config.ts` |
| SSE 流式输出 | ✅ | `sse.ts` |
| HITL 人工审批 | ✅ | `handlers/sessions.ts` |
| 会话取消 | ✅ | `handlers/sessions.ts` |
| 健康检查 / 就绪检查 / 指标 | ✅ | `handlers/health.ts` |
| 静态文件服务 (playground) | ✅ | `server.ts` |
| CLI 工具 | ✅ | `cli.ts` |
| 路由器 | ✅ | `router.ts` |

### 缺失功能

| 功能 | 说明 |
|------|------|
| OpenAPI 文档 | 自动生成 API 文档，支持 Swagger UI |
| 认证中间件 | API Key / JWT 认证，保护 API 端点 |
| CORS 支持 | 跨域请求支持 |
| 请求日志 | 记录所有请求 |
| 错误处理 | 统一错误格式 |

---

## 二、设计方案

### 2.1 文件结构

```
packages/server/src/
├── middleware/
│   ├── cors.ts           # 新增 - CORS 中间件
│   ├── auth.ts           # 新增 - 认证中间件
│   ├── logger.ts         # 新增 - 请求日志中间件
│   └── error-handler.ts  # 新增 - 统一错误处理
├── openapi/
│   ├── spec.ts           # 新增 - OpenAPI 规范定义
│   └── swagger-ui.ts     # 新增 - Swagger UI 服务
├── server.ts             # 修改 - 集成中间件
└── types.ts              # 修改 - 添加认证类型
```

### 2.2 CORS 中间件 (`middleware/cors.ts`)

```typescript
export interface CORSOptions {
  /** Allowed origins (default: '*') */
  origin?: string | string[];
  /** Allowed methods (default: 'GET,POST,PUT,DELETE,OPTIONS') */
  methods?: string[];
  /** Allowed headers (default: 'Content-Type,Authorization') */
  headers?: string[];
  /** Allow credentials (default: false) */
  credentials?: boolean;
  /** Max age for preflight cache (default: 86400) */
  maxAge?: number;
}

export function createCORSHandler(options?: CORSOptions) {
  const origin = options?.origin ?? '*';
  const methods = options?.methods?.join(',') ?? 'GET,POST,PUT,DELETE,OPTIONS';
  const headers = options?.headers?.join(',') ?? 'Content-Type,Authorization';
  const credentials = options?.credentials ?? false;
  const maxAge = options?.maxAge ?? 86400;

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', Array.isArray(origin) ? origin.join(',') : origin);
      res.setHeader('Access-Control-Allow-Methods', methods);
      res.setHeader('Access-Control-Allow-Headers', headers);
      if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', maxAge);
      res.statusCode = 204;
      res.end();
      return true; // Handled
    }

    // Set CORS headers for actual requests
    const reqOrigin = req.headers.origin;
    if (Array.isArray(origin)) {
      if (reqOrigin && origin.includes(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');

    return false; // Not handled, continue
  };
}
```

### 2.3 认证中间件 (`middleware/auth.ts`)

```typescript
export interface AuthOptions {
  /** API Key(s) for authentication */
  apiKeys?: string[];
  /** JWT secret for token verification */
  jwtSecret?: string;
  /** Paths that don't require authentication */
  publicPaths?: string[];
  /** Custom authentication function */
  customAuth?: (req: IncomingMessage) => Promise<boolean>;
}

export function createAuthHandler(options?: AuthOptions) {
  const publicPaths = new Set([
    '/health',
    '/ready',
    '/metrics',
    ...(options?.publicPaths ?? []),
  ]);

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const pathname = (req.url ?? '/').split('?')[0];
    
    // Skip auth for public paths
    if (publicPaths.has(pathname)) {
      return false; // Not handled, continue
    }

    // Skip auth for OPTIONS (CORS preflight)
    if (req.method === 'OPTIONS') {
      return false;
    }

    // Check API Key
    if (options?.apiKeys && options.apiKeys.length > 0) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (options.apiKeys.includes(token)) {
          return false; // Authenticated
        }
      }

      // Also check X-API-Key header
      const apiKeyHeader = req.headers['x-api-key'];
      if (typeof apiKeyHeader === 'string' && options.apiKeys.includes(apiKeyHeader)) {
        return false; // Authenticated
      }
    }

    // Check JWT
    if (options?.jwtSecret) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          // JWT verification would go here
          // For now, just check if token is not empty
          if (token) {
            return false; // Authenticated
          }
        } catch {
          // Invalid token
        }
      }
    }

    // Custom auth
    if (options?.customAuth) {
      const authenticated = await options.customAuth(req);
      if (authenticated) {
        return false; // Authenticated
      }
    }

    // Authentication failed
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return true; // Handled
  };
}
```

### 2.4 请求日志中间件 (`middleware/logger.ts`)

```typescript
export interface LoggerOptions {
  /** Log level (default: 'info') */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom logger function */
  logger?: (message: string) => void;
  /** Include request body in logs */
  includeBody?: boolean;
  /** Include response body in logs */
  includeResponse?: boolean;
}

export function createLoggerHandler(options?: LoggerOptions) {
  const logger = options?.logger ?? console.log;
  const level = options?.level ?? 'info';

  return (req: IncomingMessage, res: ServerResponse, startTime: number): void => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const userAgent = req.headers['user-agent'] ?? '-';
    const ip = req.socket.remoteAddress ?? '-';

    // Log on response finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      const contentLength = res.getHeader('content-length') ?? '-';

      const message = `${ip} - "${method} ${url}" ${statusCode} ${contentLength} ${duration}ms "${userAgent}"`;
      
      if (level === 'debug' || (level === 'info' && statusCode < 400)) {
        logger(message);
      } else if (level === 'warn' && statusCode >= 400 && statusCode < 500) {
        logger(`[WARN] ${message}`);
      } else if (level === 'error' && statusCode >= 500) {
        logger(`[ERROR] ${message}`);
      }
    });
  };
}
```

### 2.5 统一错误处理 (`middleware/error-handler.ts`)

```typescript
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
  timestamp: string;
}

export function createErrorHandler() {
  return (err: unknown, req: IncomingMessage, res: ServerResponse): void => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const code = err instanceof Error ? err.name : 'UnknownError';

    const response: ErrorResponse = {
      error: message,
      code,
      timestamp: new Date().toISOString(),
    };

    // Log error
    console.error(`[ERROR] ${req.method} ${req.url}:`, err);

    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  };
}
```

### 2.6 OpenAPI 规范 (`openapi/spec.ts`)

```typescript
export const openAPISpec = {
  openapi: '3.0.3',
  info: {
    title: 'AgentForge API',
    version: '0.1.0',
    description: 'HTTP/SSE server for AgentForge Studio',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  paths: {
    '/api/sessions': {
      post: {
        summary: 'Create a new session',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  agentConfigId: { type: 'string' },
                  configOverrides: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Session created' },
        },
      },
      get: {
        summary: 'List all sessions',
        responses: {
          '200': { description: 'List of sessions' },
        },
      },
    },
    '/api/sessions/{id}': {
      get: {
        summary: 'Get a session',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Session details' },
          '404': { description: 'Session not found' },
        },
      },
      delete: {
        summary: 'Delete a session',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '204': { description: 'Session deleted' },
          '404': { description: 'Session not found' },
        },
      },
    },
    '/api/sessions/{id}/chat/stream': {
      post: {
        summary: 'Stream chat with agent',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                },
                required: ['message'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'SSE stream' },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': { description: 'Health status' },
        },
      },
    },
    '/ready': {
      get: {
        summary: 'Readiness check',
        responses: {
          '200': { description: 'Readiness status' },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Metrics',
        responses: {
          '200': { description: 'Metrics data' },
        },
      },
    },
  },
};
```

### 2.7 Swagger UI 服务 (`openapi/swagger-ui.ts`)

```typescript
export function createSwaggerUIHandler(spec: object) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AgentForge API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      spec: ${JSON.stringify(spec)},
      dom_id: '#swagger-ui',
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`;

  return (_req: IncomingMessage, res: ServerResponse): void => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  };
}
```

### 2.8 服务器集成 (`server.ts` 修改)

```typescript
export function createAgentForgeServer(options: ServerOptions): {
  server: Server;
  start: () => Promise<void>;
  state: AgentForgeServer;
} {
  // ... existing code ...

  // Create middleware handlers
  const corsHandler = createCORSHandler(options.cors);
  const authHandler = createAuthHandler(options.auth);
  const loggerHandler = createLoggerHandler(options.logger);
  const errorHandler = createErrorHandler();

  // Swagger UI handler
  const swaggerHandler = createSwaggerUIHandler(openAPISpec);

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const startTime = Date.now();

      try {
        // 1. CORS (handles preflight)
        if (corsHandler(req, res)) return;

        // 2. Auth
        if (await authHandler(req, res)) return;

        // 3. Logger
        loggerHandler(req, res, startTime);

        // 4. Swagger UI
        const pathname = (req.url ?? '/').split('?')[0];
        if (pathname === '/docs' || pathname === '/swagger') {
          swaggerHandler(req, res);
          return;
        }

        // 5. Main request handling
        await handleRequest(req, res, router, serverState, playgroundPath);
      } catch (err) {
        errorHandler(err, req, res);
      }
    },
  );

  // ... rest of the code ...
}
```

### 2.9 配置选项 (`types.ts` 修改)

```typescript
export interface ServerOptions {
  port?: number;
  configDir: string;
  version?: string;
  playgroundPath?: string;
  
  /** CORS configuration */
  cors?: CORSOptions;
  
  /** Authentication configuration */
  auth?: AuthOptions;
  
  /** Logger configuration */
  logger?: LoggerOptions;
}
```

---

## 三、实现优先级

| 任务 | 工作量 | 依赖 | 优先级 |
|------|--------|------|--------|
| CORS 中间件 | 小 | 无 | P1 |
| 请求日志中间件 | 小 | 无 | P1 |
| 统一错误处理 | 小 | 无 | P1 |
| 认证中间件 | 中 | 无 | P1 |
| OpenAPI 规范 | 中 | 无 | P1 |
| Swagger UI | 小 | OpenAPI | P1 |
| 服务器集成 | 中 | 所有中间件 | P1 |

**总工作量**：约 1 天

---

## 四、测试策略

1. **单元测试**：每个中间件独立测试
2. **集成测试**：服务器 + 中间件端到端测试
3. **CORS 测试**：验证跨域请求
4. **认证测试**：验证 API Key / JWT 认证
5. **日志测试**：验证请求日志格式

---

## 五、风险与注意事项

1. **CORS 安全**：默认 `origin: '*'` 可能不安全，生产环境应限制
2. **认证性能**：JWT 验证可能有性能开销，考虑缓存
3. **日志隐私**：避免记录敏感信息（密码、token）
4. **OpenAPI 维护**：规范需要与代码同步更新

---

*文档结束*
