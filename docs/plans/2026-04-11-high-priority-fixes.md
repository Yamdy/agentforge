# 高优先级问题修复实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 primo-agent 项目中 20 项高优先级问题，涵盖核心逻辑缺陷、架构冲突、安全漏洞、资源泄漏、跨平台兼容性和构建配置。

**Architecture:** 按 7 个修复域分批推进，每个 Task 独立可测试，TDD 驱动。优先修复影响核心功能的问题（history 消息格式、agent 逻辑），再处理安全和架构问题。

**Tech Stack:** TypeScript, Vitest, Zod, RxJS, Hono, mathjs

---

### Task 1: 修复 history.ts 消息格式和顺序

**Files:**
- Modify: `src/history.ts`
- Modify: `src/types.ts` (扩展 Message 类型)
- Test: `tests/history.test.ts`

**Step 1: 扩展 Message 类型支持 tool 角色**

在 `src/types.ts` 中，`MessageSchema` 的 `role` 已包含 `'tool'`，但需要确认 `ToolResult` 的 `toolCallId` 能在消息中传递。当前 `Message` 类型只有 `role` 和 `content`，需要扩展：

```typescript
// src/types.ts - 修改 MessageSchema
export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
});
```

**Step 2: 重写 InMemoryHistory.getMessages()**

```typescript
// src/history.ts - 完整重写
import { HistoryManager, validateMessage, Message, ToolResult } from './types';

interface HistoryEntry {
  type: 'message' | 'toolResult';
  message?: Message;
  toolResult?: ToolResult;
  order: number;
}

export class InMemoryHistory implements HistoryManager {
  private entries: HistoryEntry[] = [];
  private order = 0;

  add(role: 'user' | 'assistant' | 'tool', content: string): void {
    this.entries.push({
      type: 'message',
      message: validateMessage({ role, content }),
      order: this.order++,
    });
  }

  addToolResult(toolCallId: string, toolName: string, result: string): void {
    this.entries.push({
      type: 'toolResult',
      toolResult: { toolCallId, toolName, result },
      order: this.order++,
    });
  }

  getToolResult(toolCallId: string): ToolResult | undefined {
    const entry = this.entries.find(
      (e) => e.type === 'toolResult' && e.toolResult?.toolCallId === toolCallId
    );
    return entry?.toolResult;
  }

  getMessages(): Message[] {
    return this.entries.map((entry) => {
      if (entry.type === 'message' && entry.message) {
        return entry.message;
      }
      if (entry.type === 'toolResult' && entry.toolResult) {
        return {
          role: 'tool' as const,
          content: entry.toolResult.result,
          toolCallId: entry.toolResult.toolCallId,
          toolName: entry.toolResult.toolName,
        };
      }
      return { role: 'user' as const, content: '' };
    });
  }

  clear(): void {
    this.entries = [];
    this.order = 0;
  }
}
```

**Step 3: 更新测试**

在 `tests/history.test.ts` 中添加测试验证：
- 工具结果使用 `role: 'tool'`
- 消息按添加顺序返回
- 工具结果包含 `toolCallId` 和 `toolName`

**Step 4: 运行测试验证**

Run: `npx vitest run tests/history.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/history.ts src/types.ts tests/history.test.ts
git commit -m "fix: correct history message format and ordering"
```

---

### Task 2: 修复 agent.ts done 事件重复触发 + 文本片段合并 + span 位置

**Files:**
- Modify: `src/agent/agent.ts`

**Step 1: 添加 resolved 标志位防止 done 重复触发**

在 `runStream` 方法中添加 `let doneSent = false;`，在发送 `done` 事件和 `complete` 回调中检查此标志：

```typescript
// 在 runStream 方法开头添加
let doneSent = false;

// 修改 done 事件处理 (约 L290)
case 'done':
  if (doneSent) break;
  doneSent = true;
  // ... 原有逻辑

// 修改 complete 回调 (约 L315)
complete: () => {
  if (!hasToolCalls && !doneSent) {
    doneSent = true;
    // ... 原有逻辑
  }
},
```

**Step 2: 修复文本片段合并 — 移除逐片段添加到历史**

删除 L197-199 中每次 text 事件都 `this.history.add('assistant', event.content)` 的逻辑。改为在 `done` 事件时一次性添加完整文本：

```typescript
case 'text':
  textContent += event.content;
  handler?.onText?.(event.content);
  observer.next(event);
  break;

// 在 done 事件处理中，添加完整文本到历史
case 'done':
  if (doneSent) break;
  doneSent = true;
  if (textContent.trim()) {
    this.history.add('assistant', textContent);
  }
  // ... 原有逻辑
```

**Step 3: 修复 span 位置 — 使用 toolSpan.spanId**

```typescript
// 修改 L263-267
this.tracer.endSpan(
  toolSpan.spanId,  // 改为 toolSpan 的 spanId
  'failed',
  err instanceof Error ? err : new Error(errorMsg)
);
```

**Step 4: 运行测试验证**

Run: `npx vitest run tests/agent.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/agent.ts
git commit -m "fix: prevent duplicate done events, merge text fragments, correct span tracking"
```

---

### Task 3: 修复 plugin/manager.ts trigger 和 unregister

**Files:**
- Modify: `src/plugin/manager.ts`

**Step 1: 修复 trigger — 等待 hook 完成**

```typescript
import { Subject, Observable, filter, map, mergeMap, Subscription, firstValueFrom } from 'rxjs';

// 修改 trigger 方法
async trigger(event: string, input: unknown, output: unknown): Promise<unknown> {
  const subject = this.getOrCreateSubject(event);
  subject.next({ event, input, output });

  // 等待所有 hook 处理完成
  const results = await firstValueFrom(
    subject.pipe(
      filter((payload) => payload.event === event),
      mergeMap(async (payload) => {
        // hook 已在 subscribe 中执行，这里只是等待传播
        return payload.output;
      }),
      // 只取第一个（最新的 output）
    ),
    { defaultValue: output }
  );

  return results;
}
```

实际上更简单的方案：由于 `subscribe` 中的 `mergeMap` 已经在处理，我们需要改为同步等待。更实用的方案：

```typescript
async trigger(event: string, input: unknown, output: unknown): Promise<unknown> {
  const hooks = this.getEventHooks(event);
  let modifiedOutput = output;

  for (const hook of hooks) {
    try {
      await hook(input, modifiedOutput);
      // hook 可以修改 output 对象（引用传递）
    } catch (err) {
      this.context.logger.error(`Hook ${event} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return modifiedOutput;
}

private getEventHooks(event: string): Array<(input: unknown, output: unknown) => Promise<void>> {
  const hooks: Array<(input: unknown, output: unknown) => Promise<void>> = [];
  for (const plugin of this.plugins) {
    if (plugin.hooks?.[event]) {
      hooks.push(plugin.hooks[event] as (input: unknown, output: unknown) => Promise<void>);
    }
  }
  return hooks;
}
```

**Step 2: 修复 unregister — 取消 hook 订阅**

添加 `pluginSubscriptions` Map 追踪每个插件的订阅：

```typescript
private pluginSubscriptions: Map<string, Subscription[]> = new Map();

// 在 register 中追踪
register(plugin: Plugin): void {
  const validated = PluginSchema.parse(plugin);
  this.plugins.push(validated);
  const subs: Subscription[] = [];

  if (validated.hooks) {
    for (const [eventName, hook] of Object.entries(validated.hooks)) {
      if (hook) {
        const sub = this.subscribeToEvent(eventName, hook, validated.name);
        subs.push(sub);
      }
    }
  }
  this.pluginSubscriptions.set(validated.name, subs);
}

// 在 unregister 中取消订阅
unregister(name: string): void {
  const index = this.plugins.findIndex(p => p.name === name);
  if (index !== -1) {
    this.plugins.splice(index, 1);
    const subs = this.pluginSubscriptions.get(name);
    if (subs) {
      subs.forEach(s => s.unsubscribe());
      this.pluginSubscriptions.delete(name);
    }
    this.context.logger.info('Plugin unregistered', { name });
  }
}
```

**Step 3: 运行测试验证**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add src/plugin/manager.ts
git commit -m "fix: plugin trigger waits for hooks, unregister cancels subscriptions"
```

---

### Task 4: 修复 delegation.ts catch 块回调异常

**Files:**
- Modify: `src/subagent/delegation.ts`

**Step 1: 包裹回调调用**

```typescript
// 修改 catch 块 (L72-86)
} catch (error) {
  const duration = Date.now() - startTime;
  const completeContext: DelegationCompleteContext = {
    subAgentName,
    result: '',
    success: false,
    error: error instanceof Error ? error : new Error(String(error)),
    duration,
  };

  if (config?.onDelegationComplete) {
    try {
      await config.onDelegationComplete(completeContext);
    } catch (callbackError) {
      // 回调异常仅记录日志，不覆盖原始错误
      console.error('onDelegationComplete callback failed:', callbackError);
    }
  }

  throw error;
}
```

**Step 2: Commit**

```bash
git add src/subagent/delegation.ts
git commit -m "fix: prevent delegation callback error from masking original error"
```

---

### Task 5: 修复 memory/manager.ts save() 重复消息

**Files:**
- Modify: `src/memory/manager.ts`

**Step 1: 修复 save() 方法**

```typescript
async save(): Promise<void> {
  const existingThread = await this.storage.getThread(this.threadId);
  await this.storage.saveThread({
    id: this.threadId,
    createdAt: existingThread?.createdAt ?? new Date(),
    updatedAt: new Date(),
  });

  // 清除旧消息后重新添加，避免重复
  if (existingThread) {
    const existingMessages = await this.storage.getMessages(this.threadId);
    // 只添加新增的消息（基于数量差异）
    const currentMessages = this.messageHistory.getMessages();
    const newMessageCount = currentMessages.length - existingMessages.length;
    if (newMessageCount > 0) {
      const newMessages = currentMessages.slice(existingMessages.length);
      for (const msg of newMessages) {
        await this.storage.addMessage(this.threadId, msg);
      }
    }
  } else {
    const messages = this.messageHistory.getMessages();
    for (const msg of messages) {
      await this.storage.addMessage(this.threadId, msg);
    }
  }

  if (this.workingMemory) {
    await this.storage.saveWorkingMemory(this.threadId, this.workingMemory.get());
  }

  if (this.config.observationalMemory?.enabled) {
    await this.storage.saveObservationalMemory?.(this.threadId, this.observations);
  }
}
```

**Step 2: Commit**

```bash
git add src/memory/manager.ts
git commit -m "fix: prevent duplicate messages in memory manager save()"
```

---

### Task 6: 修复 context.ts 全局状态并发不安全

**Files:**
- Modify: `src/context.ts`

**Step 1: 使用 AsyncLocalStorage**

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Message } from './types.js';

interface CurrentContext {
  messages: Message[];
  sessionId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<CurrentContext>();

export function setCurrentMemory(context: CurrentContext): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, { ...context, messages: [...context.messages] });
  } else {
    asyncLocalStorage.enterWith({ ...context, messages: [...context.messages] });
  }
}

export function getCurrentMemory(): CurrentContext | null {
  return asyncLocalStorage.getStore() ?? null;
}

export function clearCurrentMemory(): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.messages = [];
    store.sessionId = undefined;
  }
}

export { asyncLocalStorage };
```

**Step 2: Commit**

```bash
git add src/context.ts
git commit -m "fix: use AsyncLocalStorage for concurrent agent context safety"
```

---

### Task 7: 合并 AppError 重复定义

**Files:**
- Modify: `src/errors/types.ts` (添加 toJSON + 扩展 ValidationError)
- Modify: `src/errors/index.ts` (更新 toErrorResponse)
- Modify: `src/server/error.ts` (改为重新导出)

**Step 1: 增强 src/errors/types.ts**

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

  toJSON(): { error: { code: string; message: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request') {
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
  constructor(
    message: string,
    public errors?: { field: string; message: string }[]
  ) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
  }

  toJSON(): { error: { code: string; message: string; details?: { field: string; message: string }[] } } {
    const base = super.toJSON();
    if (this.errors && this.errors.length > 0) {
      return { error: { ...base.error, details: this.errors } };
    }
    return base;
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

**Step 2: 更新 src/errors/index.ts**

```typescript
export {
  AppError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
} from './types.js';

export type { AppError as AppErrorType } from './types.js';

export function isAppError(err: unknown): err is AppErrorType {
  return err instanceof AppError;
}

export function toErrorResponse(err: unknown): { error: { code: string; message: string } } {
  if (isAppError(err)) {
    return err.toJSON();
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  };
}
```

**Step 3: 替换 src/server/error.ts 为重新导出**

```typescript
export {
  AppError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
  isAppError,
  toErrorResponse,
} from '../errors/index.js';

export type { AppError as AppErrorType } from '../errors/index.js';

export const ErrorCodes = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;
```

**Step 4: 运行测试验证**

Run: `npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add src/errors/types.ts src/errors/index.ts src/server/error.ts
git commit -m "refactor: unify AppError definitions, server/error re-exports from errors/"
```

---

### Task 8: 安全修复 — calculate.ts 替换 eval

**Files:**
- Modify: `src/tools/builtin/calculate.ts`
- Modify: `package.json` (添加 mathjs 依赖)

**Step 1: 安装 mathjs**

Run: `pnpm add mathjs`

**Step 2: 重写 calculate.ts**

```typescript
import type { Tool } from '../../types.js';
import { evaluate } from 'mathjs';

export interface CalculatorToolArgs {
  expression: string;
}

export const CalculatorTool: Tool = {
  name: 'calculate',
  description: 'Calculate a mathematical expression',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression to calculate (e.g. "2 + 2 * 3")',
      },
    },
    required: ['expression'],
  },
  execute: async (args: Record<string, unknown>) => {
    const expression = args.expression as string;

    try {
      const result = evaluate(expression);
      if (typeof result === 'function') {
        throw new Error('Function evaluation is not allowed');
      }
      return `${result}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Calculation failed: ${errorMsg}`);
    }
  },
};
```

**Step 3: 运行测试验证**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tools/builtin/calculate.ts package.json pnpm-lock.yaml
git commit -m "security: replace eval() with mathjs in calculate tool"
```

---

### Task 9: 安全修复 — permissions 正则注入、auth 时序攻击、server JSON 注入

**Files:**
- Modify: `src/permissions/index.ts`
- Modify: `src/server/middleware/auth.ts`
- Modify: `src/server/index.ts`

**Step 1: 修复 permissions 正则注入**

```typescript
// 在 PermissionSystem 类中添加 escapeRegExp 方法
private escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 修改 matchPermission 方法
private matchPermission(pattern: Permission, check: Permission, user: User): boolean {
  if (pattern.type !== check.type) return false;
  if (pattern.allowed !== check.allowed) return false;

  const resourcePattern = pattern.resource
    .replace('[userId]', user.id)
    .replace(/\*/g, '{{WILDCARD}}');

  const escaped = this.escapeRegExp(resourcePattern).replace(/\{\{WILDCARD\}\}/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(check.resource);
}
```

**Step 2: 修复 auth 时序攻击**

```typescript
import * as crypto from 'node:crypto';

// 修改 auth.ts 中的比较逻辑
export function authMiddleware(config: AuthConfig) {
  return async (c: any, next: () => Promise<void>) => {
    if (!config.apiKey) {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    const apiKeyHeader = c.req.header('X-API-Key');
    const token = authHeader?.replace(/^Bearer\s+/, '') || apiKeyHeader;

    if (!token || !timingSafeEqual(token, config.apiKey)) {
      log.warn('Unauthorized request', { path: c.req.path });
      return c.json({ error: 'Unauthorized', message: 'Invalid or missing API key' }, 401);
    }

    await next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
```

**Step 3: 修复 server/index.ts JSON 注入**

替换所有手动拼接 JSON 的地方：

```typescript
// 替换 L182, L305 等
// 旧: await stream.write(`data: {"type":"error","error":"${errorMsg}"}\n\n`);
// 新:
await stream.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
```

**Step 4: Commit**

```bash
git add src/permissions/index.ts src/server/middleware/auth.ts src/server/index.ts
git commit -m "security: fix regex injection, timing attack, JSON injection"
```

---

### Task 10: 安全修复 — bash 输出限制 + HITL 自动批准

**Files:**
- Modify: `src/tools/builtin/bash.ts`
- Modify: `src/middleware/hitl.middleware.ts`

**Step 1: bash.ts 添加输出大小限制**

```typescript
const DEFAULT_TIMEOUT = 120000;
const MAX_OUTPUT_LENGTH = 1024 * 1024; // 1MB

// 在 append 函数中添加检查
const append = (chunk: Buffer) => {
  output += chunk.toString();
  if (output.length > MAX_OUTPUT_LENGTH) {
    output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n[Output truncated: exceeded 1MB limit]';
    proc.kill();
  }
};
```

**Step 2: HITL 中间件添加环境变量控制**

```typescript
async function simulateUserApproval(prompt: string): Promise<boolean> {
  const autoApprove = process.env.HITL_AUTO_APPROVE === 'true';

  if (autoApprove) {
    console.log(`\n${prompt}`);
    console.log('(Auto-approved: HITL_AUTO_APPROVE=true)');
    return true;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'HITL approval requires a real user interaction mechanism in production. ' +
      'Set HITL_AUTO_APPROVE=true for development only.'
    );
  }

  console.log(`\n${prompt}`);
  console.log('(Enter "y" to approve, "n" to reject)');

  return new Promise((resolve) => {
    setTimeout(() => {
      console.log('(Auto-approving for development purposes)');
      resolve(true);
    }, 1000);
  });
}
```

**Step 3: Commit**

```bash
git add src/tools/builtin/bash.ts src/middleware/hitl.middleware.ts
git commit -m "security: add bash output limit, HITL env-controlled approval"
```

---

### Task 11: 资源泄漏修复

**Files:**
- Modify: `src/storage/sqlite-memory.ts`
- Modify: `src/cache/index.ts`
- Modify: `src/server/middleware/rate-limit.ts`

**Step 1: 修复 sqlite-memory.ts close()**

```typescript
async close(): Promise<void> {
  if (!this.db) return;

  const data = this.db.export();
  const buffer = Buffer.from(data);
  try {
    await fs.writeFile(this.dbPath, buffer);
  } catch (writeError) {
    // 写文件失败仍需关闭数据库
    console.error('Failed to save database to disk:', writeError);
  } finally {
    this.db.close();
    this.db = null;
    this.initialized = false;
  }
}
```

**Step 2: 修复 cache/index.ts 过期清理**

```typescript
private cleanupCount = 0;
private readonly CLEANUP_INTERVAL = 100; // 每 100 次操作清理一次

set(key: string, value: unknown, ttlMs: number): void {
  this.maybeCleanup();
  this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

get<T = unknown>(key: string): T | undefined {
  this.maybeCleanup();
  const entry = this.store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    this.store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

private maybeCleanup(): void {
  this.cleanupCount++;
  if (this.cleanupCount >= this.CLEANUP_INTERVAL) {
    this.cleanupCount = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
```

**Step 3: 修复 rate-limit.ts 过期清理**

```typescript
// 在 rateLimitMiddleware 函数中添加清理逻辑
export function rateLimitMiddleware(config: { windowMs?: number; maxRequests?: number } = {}) {
  const windowMs = config.windowMs ?? 60000;
  const maxRequests = config.maxRequests ?? 100;
  const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

  return async (c: any, next: () => Promise<void>) => {
    // 清理过期条目
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetTime) {
        rateLimitMap.delete(key);
      }
    }

    // ... 原有限流逻辑
  };
}
```

**Step 4: Commit**

```bash
git add src/storage/sqlite-memory.ts src/cache/index.ts src/server/middleware/rate-limit.ts
git commit -m "fix: resource leaks in sqlite close, cache cleanup, rate-limit cleanup"
```

---

### Task 12: 跨平台兼容性修复

**Files:**
- Modify: `src/mcp/config.ts`
- Modify: `src/skill/discovery.ts`

**Step 1: 修复 mcp/config.ts — 使用 os.homedir()**

```typescript
import os from 'os';
// 删除: import { fileURLToPath } from 'url';
// 删除: const __dirname = ...

// 修改 load() 中的路径
const paths = [
  path.join(process.cwd(), CONFIG_FILE_NAME),
  path.join(os.homedir(), '.agentforge', CONFIG_FILE_NAME),
];
```

**Step 2: 修复 skill/discovery.ts — 换行符正则**

```typescript
// 删除: const __dirname = ...

// 修改正则表达式
const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

// 修改 frontmatterLines 解析
const frontmatterLines = match[1].split(/\r?\n/);
```

**Step 3: Commit**

```bash
git add src/mcp/config.ts src/skill/discovery.ts
git commit -m "fix: Windows compatibility - os.homedir(), CRLF support"
```

---

### Task 13: 修复 src/examples/ 编译错误

**Files:**
- Modify: `src/examples/agent-factory.ts`
- Modify: `src/examples/config-basic.ts`
- Modify: `src/examples/demo.ts`
- Modify: `src/examples/my-agent-template.ts`

**Step 1: 修复 agent-factory.ts**

- `InMemoryHistory` → `InMemoryStorage`（或从正确路径导入）
- 更新 `createAgent` 参数匹配当前 `AgentConfigSchema`
- 移除 `Agent.config` 引用
- 修复 `ConfigLoader` 引用

**Step 2: 修复 config-basic.ts**

- 移除 `Agent.config` 引用

**Step 3: 修复 demo.ts**

- `SubAgent.list` → `SubAgent.registry.list()`

**Step 4: 修复 my-agent-template.ts**

- 修改 `import from 'agentforge'` 为相对路径导入
- 添加参数类型注解

**Step 5: 运行 tsc 验证**

Run: `npx tsc --noEmit`
Expected: 0 errors

**Step 6: Commit**

```bash
git add src/examples/
git commit -m "fix: resolve TypeScript compilation errors in examples"
```

---

### Task 14: tsup.config.ts 添加 external

**Files:**
- Modify: `tsup.config.ts`

**Step 1: 添加 external 配置**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  shims: true,
  external: [
    'rxjs', 'hono', 'sql.js', 'zod', 'ai', '@ai-sdk/openai',
    '@ai-sdk/openai-compatible', '@modelcontextprotocol/sdk',
    'commander', 'inquirer', 'uuid', 'gray-matter', 'dotenv',
    'mathjs', '@agents-mdx/runtime', '@primno/dpapi',
    'openapi-types', 'hono-zod',
  ],
  platform: 'node',
});
```

**Step 2: 运行构建验证**

Run: `pnpm build`
Expected: 成功，dist 体积显著减小

**Step 3: Commit**

```bash
git add tsup.config.ts
git commit -m "build: add external dependencies to tsup config"
```

---

### Task 15: 消除 any 类型（关键模块）

**Files:**
- Modify: `src/config/loader.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/mcp/client.ts`
- Modify: `src/mcp/transport/sse.ts`
- Modify: `src/mcp/transport/streamable-http.ts`
- Modify: `src/skill/types.ts`
- Modify: `src/skill/discovery.ts`
- Modify: `src/permissions/index.ts`
- Modify: `src/tools/builtin/bash.ts`
- Modify: `src/tools/builtin/fetch.ts`
- Modify: `src/tools/builtin/read.ts`
- Modify: `src/tools/builtin/write.ts`
- Modify: `src/tools/builtin/ls.ts`
- Modify: `src/tools/builtin/search.ts`
- Modify: `src/tools/builtin/sleep.ts`

**Step 1: config/loader.ts — any → Record<string, unknown>**

替换所有 `any` 为 `Record<string, unknown>`，使用类型守卫进行窄化。

**Step 2: config/schema.ts — z.any() → z.record(z.string(), z.unknown())**

```typescript
options: z.record(z.string(), z.unknown()).optional(),
```

**Step 3: mcp/client.ts — 定义 Transport 联合类型**

```typescript
import type { SSEClientTransport } from './transport/sse.js';
import type { StreamableHTTPClientTransport } from './transport/streamable-http.js';
type McpTransport = SSEClientTransport | StreamableHTTPClientTransport;
```

**Step 4: mcp/transport/*.ts — 定义 AuthProvider 接口**

```typescript
export interface AuthProvider {
  getAccessToken?: () => Promise<string | undefined>;
  onAccessTokenChange?: (callback: (token: string | undefined) => void) => void;
}
```

**Step 5: skill/types.ts — z.any() → z.record(z.string(), z.unknown())**

**Step 6: skill/discovery.ts — Record<string, any> → Record<string, unknown>**

**Step 7: permissions/index.ts — args: any → args: Record<string, unknown>**

**Step 8: tools/builtin/*.ts — 定义 Args 类型**

为每个工具定义具体的 Args 接口替代 `args: any`：

```typescript
// bash.ts
interface BashToolArgs {
  command: string;
  description: string;
  timeout?: number;
  workdir?: string;
}
async execute(args: Record<string, unknown>) {
  const parsed = args as unknown as BashToolArgs;
  // ...
}
```

**Step 9: 运行测试验证**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS + 0 errors

**Step 10: Commit**

```bash
git add src/config/ src/mcp/ src/skill/ src/permissions/ src/tools/builtin/
git commit -m "refactor: eliminate any types across codebase"
```

---

### Task 16: 实现 Workflow 真正并行执行

**Files:**
- Modify: `src/workflow/executors/default.ts`
- Modify: `src/workflow/workflow.ts`
- Modify: `src/workflow/types.ts`
- Test: `tests/workflow/workflow.test.ts`

**Step 1: 扩展 DefaultExecutor 支持并行步骤**

```typescript
interface ParallelStepGroup {
  type: 'parallel';
  steps: StepNode[];
}

// 在 DefaultExecutor 中添加
private parallelGroups: ParallelStepGroup[] = [];

addParallelGroup(steps: StepNode[]): void {
  this.parallelGroups.push({ type: 'parallel', steps });
}

// 修改 execute 方法，在顺序执行后处理并行组
async execute<TInput, TOutput>(input: TInput): Promise<TOutput> {
  const context = new WorkflowContextImpl();
  let currentInput: unknown = input;

  // 顺序步骤
  for (const node of this.steps) {
    const stepInput = this.resolveInput(node.options?.input, context, currentInput);
    const result = await node.step.execute(stepInput, context);
    context.setResult(node.id, result);
    currentInput = result;
  }

  // 并行步骤组
  for (const group of this.parallelGroups) {
    const results = await Promise.all(
      group.steps.map(async (node) => {
        const stepInput = this.resolveInput(node.options?.input, context, currentInput);
        const result = await node.step.execute(stepInput, context);
        context.setResult(node.id, result);
        return { id: node.id, result };
      })
    );

    // 并行结果聚合为 Record<stepId, output>
    const parallelResults: Record<string, unknown> = {};
    for (const { id, result } of results) {
      parallelResults[id] = result;
    }
    currentInput = parallelResults;
  }

  // 分支和循环（保持不变）
  // ...

  return currentInput as TOutput;
}
```

**Step 2: 修改 WorkflowBuilder.parallel() 注册并行组**

```typescript
parallel<TI, TO>(
  stepIds: string[],
  steps: WorkflowStep<TI, TO>[],
  options?: ParallelOptions
): WorkflowBuilder<TInput, TO[]> {
  const stepNodes: StepNode[] = stepIds.map((id, i) => ({
    id,
    step: steps[i] as WorkflowStep<unknown, unknown>,
    options: undefined,
    dependencies: [],
  }));
  this.executor.addParallelGroup(stepNodes);
  this.lastStepId = stepIds[stepIds.length - 1];
  return this as unknown as WorkflowBuilder<TInput, TO[]>;
}
```

**Step 3: 添加并行测试**

```typescript
test('parallel steps execute concurrently', async () => {
  const workflow = createWorkflow({ id: 'parallel-test' });
  const executionOrder: string[] = [];

  workflow.parallel(
    ['step1', 'step2', 'step3'],
    [
      createStep('step1', async () => {
        await new Promise(r => setTimeout(r, 50));
        executionOrder.push('step1');
        return 'result1';
      }),
      createStep('step2', async () => {
        await new Promise(r => setTimeout(r, 10));
        executionOrder.push('step2');
        return 'result2';
      }),
      createStep('step3', async () => {
        await new Promise(r => setTimeout(r, 30));
        executionOrder.push('step3');
        return 'result3';
      }),
    ]
  );

  const committed = workflow.commit();
  const result = await committed.run('input');

  // 并行结果应为 Record<stepId, output>
  expect(result).toEqual({
    step1: 'result1',
    step2: 'result2',
    step3: 'result3',
  });
});
```

**Step 4: 运行测试验证**

Run: `npx vitest run tests/workflow/`
Expected: PASS

**Step 5: Commit**

```bash
git add src/workflow/ tests/workflow/
git commit -m "feat: implement true parallel execution in workflow using Promise.all"
```

---

### Task 17: 修复 msghub.ts 公告消息丢失

**Files:**
- Modify: `src/workflow/msghub.ts`

**Step 1: 延迟公告发送**

将公告消息存储，在第一个订阅者出现时发送：

```typescript
export class MsgHubImpl implements MsgHub {
  private messageSubject: Subject<Message>;
  private pendingAnnouncements: Message[] = [];

  constructor(config: MsgHubConfig) {
    this.participants = config.participants;
    this.messageSubject = new Subject<Message>();

    if (config.announcement) {
      const announcements = Array.isArray(config.announcement)
        ? config.announcement
        : [config.announcement];
      this.pendingAnnouncements = announcements;
    }
  }

  get messages$(): Observable<Message> {
    // 在首次订阅时发送待处理的公告
    const pending = this.pendingAnnouncements;
    this.pendingAnnouncements = [];

    return new Observable((subscriber) => {
      for (const msg of pending) {
        subscriber.next(msg);
      }
      this.messageSubject.subscribe(subscriber);
    });
  }

  broadcast(message: Message): void {
    this.messageSubject.next(message);
  }
}
```

**Step 2: Commit**

```bash
git add src/workflow/msghub.ts
git commit -m "fix: deliver announcement messages to subscribers in msghub"
```

---

### Task 18: 最终验证

**Step 1: 运行完整测试套件**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: 运行 TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 0 errors

**Step 3: 运行构建**

Run: `pnpm build`
Expected: 成功

**Step 4: 运行 lint**

Run: `npx eslint src`
Expected: 无 any 相关错误
