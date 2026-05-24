# Framework Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Add lint/format, tests, middleware, retry, cache, config validation, schema export, and error types

**Architecture:** 分模块独立实现，通过子任务分发

**Tech Stack:** ESLint, Prettier, Vitest, Zod

---

## 文件结构

### 新增文件
- `.eslintrc.cjs` - ESLint 配置
- `.prettierrc` - Prettier 配置
- `vitest.config.ts` - Vitest 配置
- `src/config/index.ts` - 配置验证
- `src/config/schema.ts` - 配置 schema
- `src/errors/index.ts` - 错误类型
- `src/errors/types.ts` - 错误类定义
- `src/cache/index.ts` - 缓存模块
- `tests/unit/` - 单元测试目录
- `tests/integration/` - 集成测试目录

### 修改文件
- `package.json` - 添加 lint/scripts
- `src/agent/agent.ts` - 添加重试
- `src/registry.ts` - 添加缓存
- `src/server/index.ts` - 添加中间件
- `src/index.ts` - 导出新模块

---

## Chunk 1: Lint/Format + Test Setup

### Task 1.1: 配置 ESLint + Prettier

**Files:**
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`
- Modify: `package.json`

- [ ] **Step 1: 创建 .eslintrc.cjs**

```javascript
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
  ignorePatterns: ['dist', 'node_modules', '*.d.ts'],
};
```

- [ ] **Step 2: 创建 .prettierrc**

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- [ ] **Step 3: 更新 package.json scripts**

```json
{
  "scripts": {
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "format": "prettier --write \"src/**/*.ts\""
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add .eslintrc.cjs .prettierrc package.json
git commit -m "chore: add ESLint and Prettier config"
```

### Task 1.2: 配置 Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/registry.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

- [ ] **Step 2: 写测试文件 tests/unit/registry.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/registry';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register a tool', () => {
    const tool = {
      name: 'test-tool',
      description: 'A test tool',
      execute: async (args: Record<string, unknown>) => 'result',
    };
    registry.register(tool);
    expect(registry.get('test-tool')).toBeDefined();
  });

  it('should list all tools', () => {
    registry.register({
      name: 'tool1',
      description: 'Tool 1',
      execute: async () => '1',
    });
    registry.register({
      name: 'tool2',
      description: 'Tool 2',
      execute: async () => '2',
    });
    expect(registry.list()).toHaveLength(2);
  });

  it('should throw error for missing tool', () => {
    expect(() => registry.execute('missing', {})).toThrow('Tool not found');
  });

  it('should execute a tool', async () => {
    registry.register({
      name: 'echo',
      description: 'Echoes input',
      execute: async (args: Record<string, unknown>) => JSON.stringify(args),
    });
    const result = await registry.execute('echo', { foo: 'bar' });
    expect(result).toBe('{"foo":"bar"}');
  });
});
```

- [ ] **Step 3: 更新 package.json**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/ package.json
git commit -m "test: add Vitest configuration and registry tests"
```

---

## Chunk 2: Error Types + Config Validation

### Task 2.1: 错误类型定义

**Files:**
- Create: `src/errors/types.ts`
- Create: `src/errors/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 创建 src/errors/types.ts**

```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super('BAD_REQUEST', message, 400);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
  }
}

export class ToolNotFoundError extends AppError {
  constructor(toolName: string) {
    super('TOOL_NOT_FOUND', `Tool not found: ${toolName}`, 404);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolExecuteError extends AppError {
  constructor(toolName: string, message: string) {
    super('TOOL_EXECUTE_ERROR', `Tool ${toolName} failed: ${message}`, 500);
    this.name = 'ToolExecuteError';
  }
}

export class LLMError extends AppError {
  constructor(message: string) {
    super('LLM_ERROR', message, 500);
    this.name = 'LLMError';
  }
}
```

- [ ] **Step 2: 创建 src/errors/index.ts**

```typescript
export * from './types';

export function toErrorResponse(error: Error): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: error.message } },
    { status: 500 }
  );
}
```

- [ ] **Step 3: 更新 src/index.ts**

```typescript
export * from './errors/index.js';
```

- [ ] **Step 4: Commit**

```bash
git add src/errors/
git commit -m "feat: add error types (AppError, NotFoundError, LLMError, etc.)"
```

### Task 2.2: 配置验证

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 创建 src/config/schema.ts**

```typescript
import { z } from 'zod';

export const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  apiKey: z.string().optional(),
  corsOrigins: z.union([z.string(), z.array(z.string())]).default('*'),
  compactionThreshold: z.number().default(20),
  compactionEnabled: z.boolean().default(true),
});

export const AgentConfigSchema = z.object({
  model: z.string().default('gpt-4-turbo'),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  maxSteps: z.number().default(Infinity),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

- [ ] **Step 2: 创建 src/config/index.ts**

```typescript
import { ServerConfigSchema, AgentConfigSchema, type ServerConfig, type AgentConfig } from './schema.js';

export function validateServerConfig(config: unknown): ServerConfig {
  return ServerConfigSchema.parse(config);
}

export function validateAgentConfig(config: unknown): AgentConfig {
  return AgentConfigSchema.parse(config);
}

export { ServerConfigSchema, AgentConfigSchema };
export type { ServerConfig, AgentConfig };
```

- [ ] **Step 3: 更新 src/index.ts**

```typescript
export * from './config/index.js';
```

- [ ] **Step 4: Commit**

```bash
git add src/config/
git commit -m "feat: add config validation with Zod schemas"
```

---

## Chunk 3: Middleware

### Task 3.1: 中间件

**Files:**
- Modify: `src/server/index.ts`
- Create: `src/server/middleware/error.ts`
- Create: `src/server/middleware/logging.ts`
- Create: `src/server/middleware/rate-limit.ts`

- [ ] **Step 1: 创建 src/server/middleware/error.ts**

```typescript
import type { Context, Next } from 'hono';
import { toErrorResponse } from '../../errors/index.js';

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    console.error('Server error:', err);
    return toErrorResponse(err instanceof Error ? err : new Error(String(err)));
  }
}
```

- [ ] **Step 2: 创建 src/server/middleware/logging.ts**

```typescript
import type { Context, Next } from 'hono';
import { createLogger } from '../../logger/index.js';

const log = createLogger('request');

export async function loggingMiddleware(c: Context, next: Next) {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  log.info('Request', { method, path, status: c.res.status, duration });
}
```

- [ ] **Step 3: 创建 src/server/middleware/rate-limit.ts**

```typescript
import type { Context, Next } from 'hono';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware(options?: { windowMs?: number; limit?: number }) {
  const windowMs = options?.windowMs ?? 60000;
  const limit = options?.limit ?? 100;

  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (record.count >= limit) {
      return c.json({ error: { code: 'RATE_LIMIT', message: 'Too many requests' } }, 429);
    }

    record.count++;
    await next();
  };
}
```

- [ ] **Step 4: 更新 src/server/index.ts**

```typescript
import { errorMiddleware } from './middleware/error.js';
import { loggingMiddleware } from './middleware/logging.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';

// 在 app 初始化后添加
app.use('*', errorMiddleware);
app.use('*', loggingMiddleware);
app.use('*', rateLimitMiddleware());
```

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/
git commit -m "feat: add middleware (error, logging, rate-limit)"
```

---

## Chunk 4: Retry + Cache

### Task 4.1: 重试机制

**Files:**
- Create: `src/retry/index.ts`
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: 创建 src/retry/index.ts**

```typescript
export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: number;
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = 2, shouldRetry } = options;

  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts) break;
      if (shouldRetry && !shouldRetry(lastError)) break;

      const delay = delayMs * Math.pow(backoff, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError!;
}
```

- [ ] **Step 2: 修改 src/agent/agent.ts**

```typescript
import { withRetry } from '../retry/index.js';

// 在工具执行处添加重试
const execResult = await withRetry(
  () => this.registry.execute(toolCall.name, args),
  { maxAttempts: 2, shouldRetry: (e) => !e.message.includes('rate limit') }
);
```

- [ ] **Step 3: Commit**

```bash
git add src/retry/ src/agent/agent.ts
git commit -m "feat: add retry mechanism for tool execution"
```

### Task 4.2: 缓存

**Files:**
- Create: `src/cache/index.ts`
- Modify: `src/registry.ts`

- [ ] **Step 1: 创建 src/cache/index.ts**

```typescript
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ToolCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  set(key: string, value: unknown, ttlMs: number = 300000): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

export const toolCache = new ToolCache();
```

- [ ] **Step 2: 修改 src/registry.ts**

```typescript
import { toolCache } from '../cache/index.js';

async execute(name: string, args: Record<string, unknown>): Promise<string> {
  const cacheKey = `${name}:${JSON.stringify(args)}`;
  const cached = toolCache.get<string>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const tool = this.tools.get(name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  const result = String(await tool.execute(args));
  
  toolCache.set(cacheKey, result, 60000);
  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cache/ src/registry.ts
git commit -m "feat: add tool result cache"
```

---

## Chunk 5: Schema Export + Documentation

### Task 5.1: Schema 导出

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 更新 src/types.ts**

```typescript
// 在文件末尾添加
export const schemas = {
  Message: MessageSchema,
  Tool: ToolSchema,
  ToolCall: ToolCallSchema,
  ToolResult: ToolResultSchema,
  LLMResponse: LLMResponseSchema,
  StreamEvent: StreamEventSchema,
  TaskStatus: TaskStatusSchema,
} as const;

export type Schemas = typeof schemas;
```

- [ ] **Step 2: 更新 src/index.ts**

```typescript
export { schemas, type Schemas } from './types.js';
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "feat: export Zod schemas for consumers"
```

### Task 5.2: 框架使用文档

**Files:**
- Create: `docs/superpowers/framework-usage.md`

- [ ] **Step 1: 创建文档**

```markdown
# Primo Agent 框架使用文档

## 快速开始

```typescript
import { Agent, InMemoryHistory, ToolRegistry, AIAdapter, createLogger } from 'primo-agent';

const adapter = new AIAdapter({ model: 'gpt-4-turbo', apiKey: 'xxx' });
const registry = new ToolRegistry();
registry.register(myTool);
adapter.setTools(registry.list());

const agent = new Agent(adapter, new InMemoryHistory(), registry);
const result = await agent.run('Your prompt');
```

## 配置验证

```typescript
import { validateServerConfig, validateAgentConfig } from 'primo-agent';

const serverConfig = validateServerConfig({ port: 3000 });
const agentConfig = validateAgentConfig({ model: 'gpt-4' });
```

## 错误处理

```typescript
import { AppError, NotFoundError, ToolExecuteError } from 'primo-agent';

try {
  await agent.run('prompt');
} catch (err) {
  if (err instanceof NotFoundError) {
    // 处理未找到
  } else if (err instanceof ToolExecuteError) {
    // 工具执行失败
  }
}
```

## Schema 使用

```typescript
import { schemas, MessageSchema } from 'primo-agent';

const validMessage = MessageSchema.parse({ role: 'user', content: 'Hello' });
```

更多内容见 architecture.md
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/framework-usage.md
git commit -m "docs: add framework usage documentation"
```

---

## 完成

所有任务完成后，运行 lint 和测试：

```bash
pnpm lint
pnpm lint:fix
pnpm format
pnpm test
```
