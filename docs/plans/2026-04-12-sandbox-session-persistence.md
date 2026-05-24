# 沙箱与会话持久化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为端侧 Agent 框架添加进程级沙箱隔离和会话检查点持久化功能。

**Architecture:** 渐进式增强现有架构，新增 sandbox 模块处理命令隔离，扩展 session 模块支持检查点和压缩。

**Tech Stack:** TypeScript, Node.js child_process, Vitest

---

## Task 1: 沙箱类型定义

**Files:**
- Create: `src/sandbox/types.ts`

**Step 1: 创建沙箱类型定义**

```typescript
/**
 * 沙箱安全策略配置
 */
export interface SandboxPolicy {
  /** 允许访问的目录白名单 */
  allowedPaths: string[];
  /** 禁止访问的目录黑名单（优先级高于白名单） */
  deniedPaths: string[];
  /** 命令执行超时时间（毫秒） */
  timeout: number;
  /** 最大输出大小（字节） */
  maxOutputSize: number;
}

/**
 * 沙箱执行结果
 */
export interface SandboxResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 执行时长（毫秒） */
  duration: number;
}

/**
 * 沙箱执行选项
 */
export interface SandboxExecuteOptions {
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
}
```

**Step 2: 提交**

```bash
git add src/sandbox/types.ts
git commit -m "feat(sandbox): add type definitions"
```

---

## Task 2: 安全策略配置

**Files:**
- Create: `src/sandbox/policy.ts`
- Create: `tests/sandbox/policy.test.ts`

**Step 1: 编写策略验证测试**

```typescript
import { describe, it, expect } from 'vitest';
import { createPolicy, isPathAllowed } from '../../src/sandbox/policy.js';

describe('SandboxPolicy', () => {
  const policy = createPolicy({
    allowedPaths: ['/home/user/project'],
    deniedPaths: ['/etc/passwd'],
  });

  it('should allow paths in whitelist', () => {
    expect(isPathAllowed(policy, '/home/user/project/src/index.ts')).toBe(true);
  });

  it('should deny paths not in whitelist', () => {
    expect(isPathAllowed(policy, '/etc/config.json')).toBe(false);
  });

  it('should deny paths in blacklist even if in whitelist', () => {
    const policyWithConflict = createPolicy({
      allowedPaths: ['/etc'],
      deniedPaths: ['/etc/passwd'],
    });
    expect(isPathAllowed(policyWithConflict, '/etc/passwd')).toBe(false);
  });

  it('should use default values', () => {
    const defaultPolicy = createPolicy({});
    expect(defaultPolicy.timeout).toBe(60000);
    expect(defaultPolicy.maxOutputSize).toBe(1024 * 1024);
  });
});
```

**Step 2: 运行测试确认失败**

```bash
pnpm test tests/sandbox/policy.test.ts
```

Expected: FAIL - 模块不存在

**Step 3: 实现策略配置**

```typescript
import path from 'path';
import type { SandboxPolicy } from './types.js';

export interface PolicyOptions {
  allowedPaths?: string[];
  deniedPaths?: string[];
  timeout?: number;
  maxOutputSize?: number;
}

/**
 * 创建沙箱安全策略
 */
export function createPolicy(options: PolicyOptions): SandboxPolicy {
  return {
    allowedPaths: options.allowedPaths ?? [process.cwd()],
    deniedPaths: options.deniedPaths ?? [],
    timeout: options.timeout ?? 60000,
    maxOutputSize: options.maxOutputSize ?? 1024 * 1024,
  };
}

/**
 * 规范化路径（解析相对路径、符号链接等）
 */
function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

/**
 * 检查路径是否在允许列表中
 */
export function isPathAllowed(policy: SandboxPolicy, filePath: string): boolean {
  const normalizedPath = normalizePath(filePath);

  // 先检查黑名单
  for (const denied of policy.deniedPaths) {
    if (normalizedPath.startsWith(normalizePath(denied))) {
      return false;
    }
  }

  // 再检查白名单
  for (const allowed of policy.allowedPaths) {
    if (normalizedPath.startsWith(normalizePath(allowed))) {
      return true;
    }
  }

  return false;
}
```

**Step 4: 运行测试确认通过**

```bash
pnpm test tests/sandbox/policy.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add src/sandbox/policy.ts tests/sandbox/policy.test.ts
git commit -m "feat(sandbox): implement policy configuration"
```

---

## Task 3: 命令执行器

**Files:**
- Create: `src/sandbox/executor.ts`
- Create: `tests/sandbox/executor.test.ts`

**Step 1: 编写执行器测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandExecutor } from '../../src/sandbox/executor.js';
import { createPolicy } from '../../src/sandbox/policy.js';

describe('CommandExecutor', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    const policy = createPolicy({
      allowedPaths: [process.cwd()],
      timeout: 5000,
    });
    executor = new CommandExecutor(policy);
  });

  afterEach(() => {
    executor.dispose();
  });

  it('should execute simple command', async () => {
    const result = await executor.execute('echo', ['hello']);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('should capture stderr', async () => {
    const result = await executor.execute('node', ['-e', 'console.error("error")']);
    expect(result.stderr.trim()).toBe('error');
  });

  it('should timeout on long running command', async () => {
    const shortPolicy = createPolicy({ timeout: 100 });
    const shortExecutor = new CommandExecutor(shortPolicy);
    
    const result = await shortExecutor.execute('sleep', ['10']);
    expect(result.timedOut).toBe(true);
    
    shortExecutor.dispose();
  }, 10000);

  it('should track duration', async () => {
    const result = await executor.execute('echo', ['test']);
    expect(result.duration).toBeGreaterThan(0);
  });
});
```

**Step 2: 运行测试确认失败**

```bash
pnpm test tests/sandbox/executor.test.ts
```

Expected: FAIL - 模块不存在

**Step 3: 实现命令执行器**

```typescript
import { spawn, ChildProcess } from 'child_process';
import type { SandboxPolicy, SandboxResult, SandboxExecuteOptions } from './types.js';

/**
 * 命令执行器 - 负责在隔离环境中执行命令
 */
export class CommandExecutor {
  private policy: SandboxPolicy;
  private activeProcesses: Set<ChildProcess> = new Set();

  constructor(policy: SandboxPolicy) {
    this.policy = policy;
  }

  /**
   * 执行命令
   */
  async execute(
    command: string,
    args: string[] = [],
    options: SandboxExecuteOptions = {}
  ): Promise<SandboxResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let truncated = false;

      const proc = spawn(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
        shell: true,
      });

      this.activeProcesses.add(proc);

      // 设置超时
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, this.policy.timeout);

      // 收集输出
      proc.stdout?.on('data', (data: Buffer) => {
        if (!truncated && stdout.length < this.policy.maxOutputSize) {
          stdout += data.toString('utf8');
          if (stdout.length >= this.policy.maxOutputSize) {
            stdout = stdout.slice(0, this.policy.maxOutputSize);
            truncated = true;
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        if (!truncated && stderr.length < this.policy.maxOutputSize) {
          stderr += data.toString('utf8');
          if (stderr.length >= this.policy.maxOutputSize) {
            stderr = stderr.slice(0, this.policy.maxOutputSize);
            truncated = true;
          }
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          timedOut,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);

        resolve({
          stdout,
          stderr: err.message,
          exitCode: 1,
          timedOut: false,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * 终止所有活跃进程
   */
  killAll(): void {
    for (const proc of this.activeProcesses) {
      proc.kill('SIGKILL');
    }
    this.activeProcesses.clear();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.killAll();
  }
}
```

**Step 4: 运行测试确认通过**

```bash
pnpm test tests/sandbox/executor.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add src/sandbox/executor.ts tests/sandbox/executor.test.ts
git commit -m "feat(sandbox): implement command executor with timeout"
```

---

## Task 4: Sandbox 核心类

**Files:**
- Create: `src/sandbox/sandbox.ts`
- Create: `tests/sandbox/sandbox.test.ts`

**Step 1: 编写 Sandbox 测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sandbox, createSandbox } from '../../src/sandbox/sandbox.js';

describe('Sandbox', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = createSandbox({
      allowedPaths: [process.cwd()],
      timeout: 5000,
    });
  });

  afterEach(() => {
    sandbox.dispose();
  });

  it('should execute command and return result', async () => {
    const result = await sandbox.execute('echo hello');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('should validate paths before execution', async () => {
    // 命令尝试访问不允许的路径
    const result = await sandbox.execute('cat /etc/passwd');
    expect(result.stderr).toContain('Path not allowed');
  });

  it('should check if path is allowed', () => {
    expect(sandbox.isPathAllowed('./src/index.ts')).toBe(true);
    expect(sandbox.isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('should kill running process', async () => {
    const executePromise = sandbox.execute('sleep 10');
    
    // 稍后终止
    setTimeout(() => sandbox.kill(), 100);
    
    const result = await executePromise;
    expect(result.timedOut).toBe(true);
  }, 10000);
});
```

**Step 2: 运行测试确认失败**

```bash
pnpm test tests/sandbox/sandbox.test.ts
```

Expected: FAIL - 模块不存在

**Step 3: 实现 Sandbox 核心类**

```typescript
import { CommandExecutor } from './executor.js';
import { createPolicy, isPathAllowed, type PolicyOptions } from './policy.js';
import type { SandboxResult, SandboxExecuteOptions } from './types.js';

/**
 * 沙箱类 - 提供安全的命令执行环境
 */
export class Sandbox {
  private executor: CommandExecutor;
  private policy: ReturnType<typeof createPolicy>;
  private currentProcess: Promise<SandboxResult> | null = null;

  constructor(options: PolicyOptions) {
    this.policy = createPolicy(options);
    this.executor = new CommandExecutor(this.policy);
  }

  /**
   * 执行命令
   */
  async execute(command: string, options?: SandboxExecuteOptions): Promise<SandboxResult> {
    // 提取命令中的路径并验证
    const pathsInCommand = this.extractPaths(command);
    for (const p of pathsInCommand) {
      if (!this.isPathAllowed(p)) {
        return {
          stdout: '',
          stderr: `Error: Path not allowed: ${p}`,
          exitCode: 1,
          timedOut: false,
          duration: 0,
        };
      }
    }

    this.currentProcess = this.executor.execute(command, [], options);
    return this.currentProcess;
  }

  /**
   * 检查路径是否允许访问
   */
  isPathAllowed(filePath: string): boolean {
    return isPathAllowed(this.policy, filePath);
  }

  /**
   * 终止当前执行的命令
   */
  kill(): void {
    this.executor.killAll();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.kill();
    this.executor.dispose();
  }

  /**
   * 从命令字符串中提取路径
   * 简单实现：匹配引号内的内容和常见路径模式
   */
  private extractPaths(command: string): string[] {
    const paths: string[] = [];
    
    // 匹配引号内的内容
    const quotedPattern = /["']([^"']+)["']/g;
    let match;
    while ((match = quotedPattern.exec(command)) !== null) {
      paths.push(match[1]);
    }

    // 匹配以 / 或 ./ 开头的路径
    const pathPattern = /(?<=\s)(\/[^\s]+|\.[\/\\][^\s]+)/g;
    while ((match = pathPattern.exec(command)) !== null) {
      paths.push(match[0]);
    }

    return paths;
  }
}

/**
 * 创建沙箱实例
 */
export function createSandbox(options: PolicyOptions): Sandbox {
  return new Sandbox(options);
}
```

**Step 4: 运行测试确认通过**

```bash
pnpm test tests/sandbox/sandbox.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add src/sandbox/sandbox.ts tests/sandbox/sandbox.test.ts
git commit -m "feat(sandbox): implement Sandbox core class"
```

---

## Task 5: Sandbox 模块导出

**Files:**
- Create: `src/sandbox/index.ts`

**Step 1: 创建导出文件**

```typescript
export { Sandbox, createSandbox } from './sandbox.js';
export { CommandExecutor } from './executor.js';
export { createPolicy, isPathAllowed, type PolicyOptions } from './policy.js';
export type { SandboxPolicy, SandboxResult, SandboxExecuteOptions } from './types.js';
```

**Step 2: 更新主入口**

修改 `src/index.ts`，添加：

```typescript
export * from './sandbox/index.js';
```

**Step 3: 提交**

```bash
git add src/sandbox/index.ts src/index.ts
git commit -m "feat(sandbox): export sandbox module"
```

---

## Task 6: 检查点类型定义

**Files:**
- Create: `src/session/types.ts`

**Step 1: 创建检查点类型**

```typescript
import type { TaskState } from '../types.js';

/**
 * 会话消息
 */
export interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
}

/**
 * 待执行的工具调用
 */
export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * 检查点
 */
export interface Checkpoint {
  /** 检查点 ID */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** Agent 执行步骤索引 */
  stepIndex: number;
  /** 消息快照 */
  messages: SessionMessage[];
  /** 待执行的工具调用 */
  toolCalls: PendingToolCall[];
  /** Agent 状态 */
  state: TaskState;
  /** 创建时间 */
  createdAt: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 会话配置
 */
export interface SessionConfig {
  /** 自动创建检查点 */
  autoCheckpoint?: boolean;
  /** 检查点间隔（步数） */
  checkpointInterval?: number;
  /** 自动压缩 */
  autoCompact?: boolean;
  /** 最大消息数 */
  maxMessages?: number;
}
```

**Step 2: 提交**

```bash
git add src/session/types.ts
git commit -m "feat(session): add checkpoint type definitions"
```

---

## Task 7: 检查点管理

**Files:**
- Create: `src/session/checkpoint.ts`
- Create: `tests/session/checkpoint.test.ts`

**Step 1: 编写检查点测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CheckpointManager } from '../../src/session/checkpoint.js';
import type { Checkpoint, SessionMessage } from '../../src/session/types.js';

describe('CheckpointManager', () => {
  let manager: CheckpointManager;
  const sessionId = 'test-session-1';

  beforeEach(async () => {
    manager = new CheckpointManager();
    await manager.init();
  });

  it('should create checkpoint', async () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'hello', timestamp: Date.now() },
    ];

    const checkpoint = await manager.create(sessionId, 1, {
      messages,
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.sessionId).toBe(sessionId);
    expect(checkpoint.stepIndex).toBe(1);
    expect(checkpoint.messages).toHaveLength(1);
  });

  it('should list checkpoints', async () => {
    await manager.create(sessionId, 1, {
      messages: [],
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });
    await manager.create(sessionId, 2, {
      messages: [],
      toolCalls: [],
      state: { status: 'running', step: 2 },
    });

    const checkpoints = await manager.list(sessionId);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].stepIndex).toBe(2); // 最新的在前
  });

  it('should restore checkpoint', async () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'test message', timestamp: Date.now() },
    ];

    const checkpoint = await manager.create(sessionId, 1, {
      messages,
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });

    const restored = await manager.restore(checkpoint.id);
    expect(restored).toBeDefined();
    expect(restored?.messages).toHaveLength(1);
    expect(restored?.messages[0].content).toBe('test message');
  });

  it('should delete checkpoint', async () => {
    const checkpoint = await manager.create(sessionId, 1, {
      messages: [],
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });

    const deleted = await manager.delete(checkpoint.id);
    expect(deleted).toBe(true);

    const restored = await manager.restore(checkpoint.id);
    expect(restored).toBeNull();
  });
});
```

**Step 2: 运行测试确认失败**

```bash
pnpm test tests/session/checkpoint.test.ts
```

Expected: FAIL - 模块不存在

**Step 3: 实现检查点管理器**

```typescript
import { Storage, NotFoundError } from '../storage/index.js';
import type { Checkpoint, SessionMessage, PendingToolCall } from './types.js';
import type { TaskState } from '../types.js';

interface CreateCheckpointOptions {
  messages: SessionMessage[];
  toolCalls: PendingToolCall[];
  state: TaskState;
  metadata?: Record<string, unknown>;
}

/**
 * 检查点管理器
 */
export class CheckpointManager {
  /**
   * 初始化存储
   */
  async init(): Promise<void> {
    // Storage 模块自动初始化
  }

  /**
   * 创建检查点
   */
  async create(
    sessionId: string,
    stepIndex: number,
    options: CreateCheckpointOptions
  ): Promise<Checkpoint> {
    const id = `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const checkpoint: Checkpoint = {
      id,
      sessionId,
      stepIndex,
      messages: [...options.messages],
      toolCalls: [...options.toolCalls],
      state: { ...options.state },
      createdAt: Date.now(),
      metadata: options.metadata,
    };

    await Storage.write(['checkpoint', id], checkpoint);
    return checkpoint;
  }

  /**
   * 恢复检查点
   */
  async restore(checkpointId: string): Promise<Checkpoint | null> {
    try {
      return await Storage.read<Checkpoint>(['checkpoint', checkpointId]);
    } catch (e) {
      if (e instanceof NotFoundError) {
        return null;
      }
      throw e;
    }
  }

  /**
   * 列出会话的所有检查点
   */
  async list(sessionId: string): Promise<Checkpoint[]> {
    const allKeys = await Storage.list(['checkpoint']);
    const checkpoints: Checkpoint[] = [];

    for (const key of allKeys) {
      try {
        const checkpoint = await Storage.read<Checkpoint>(['checkpoint', key[key.length - 1]]);
        if (checkpoint.sessionId === sessionId) {
          checkpoints.push(checkpoint);
        }
      } catch {
        // 跳过无效条目
      }
    }

    // 按步骤索引降序排序（最新的在前）
    return checkpoints.sort((a, b) => b.stepIndex - a.stepIndex);
  }

  /**
   * 删除检查点
   */
  async delete(checkpointId: string): Promise<boolean> {
    try {
      await Storage.remove(['checkpoint', checkpointId]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理会话的所有检查点
   */
  async clear(sessionId: string): Promise<void> {
    const checkpoints = await this.list(sessionId);
    for (const cp of checkpoints) {
      await this.delete(cp.id);
    }
  }
}
```

**Step 4: 运行测试确认通过**

```bash
pnpm test tests/session/checkpoint.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add src/session/checkpoint.ts tests/session/checkpoint.test.ts
git commit -m "feat(session): implement checkpoint manager"
```

---

## Task 8: 会话压缩增强

**Files:**
- Modify: `src/session/compaction.ts`
- Create: `tests/session/compaction.test.ts`

**Step 1: 编写压缩测试**

```typescript
import { describe, it, expect } from 'vitest';
import { compactMessages, estimateTokens } from '../../src/session/compaction.js';
import type { SessionMessage } from '../../src/session/types.js';

describe('Compaction', () => {
  it('should estimate tokens correctly', () => {
    const text = 'Hello, world! This is a test message.';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });

  it('should compact messages when exceeding max', () => {
    const messages: SessionMessage[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push({
        role: 'user',
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      });
    }

    const result = compactMessages(messages, { maxMessages: 20 });
    expect(result.messages.length).toBeLessThanOrEqual(20);
    expect(result.originalCount).toBe(100);
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  it('should keep system messages', () => {
    const messages: SessionMessage[] = [
      { role: 'system', content: 'System prompt', timestamp: Date.now() },
      ...Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      })),
    ];

    const result = compactMessages(messages, {
      maxMessages: 20,
      keepSystemMessages: true,
    });

    const systemMessages = result.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
  });

  it('should keep tool results when configured', () => {
    const messages: SessionMessage[] = [
      { role: 'tool', content: 'Tool result 1', toolCallId: '1', toolName: 'test', timestamp: Date.now() },
      ...Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      })),
    ];

    const result = compactMessages(messages, {
      maxMessages: 20,
      keepToolResults: true,
    });

    const toolMessages = result.messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(1);
  });
});
```

**Step 2: 运行测试确认失败**

```bash
pnpm test tests/session/compaction.test.ts
```

Expected: FAIL - 函数不存在

**Step 3: 增强压缩实现**

修改 `src/session/compaction.ts`：

```typescript
import type { SessionMessage } from './types.js';

export interface CompactionConfig {
  /** 最大保留消息数 */
  maxMessages: number;
  /** 保留系统消息 */
  keepSystemMessages?: boolean;
  /** 保留工具结果 */
  keepToolResults?: boolean;
}

export interface CompactionResult {
  /** 压缩后的消息 */
  messages: SessionMessage[];
  /** 原始消息数 */
  originalCount: number;
  /** 压缩后消息数 */
  compactedCount: number;
  /** 节省的 token 数 */
  savedTokens: number;
}

/**
 * 估算文本的 token 数
 * 简单实现：按字符数估算（英文约 4 字符 = 1 token，中文约 2 字符 = 1 token）
 */
export function estimateTokens(text: string): number {
  // 简单估算：平均 3 字符 = 1 token
  return Math.ceil(text.length / 3);
}

/**
 * 压缩消息列表
 */
export function compactMessages(
  messages: SessionMessage[],
  config: CompactionConfig
): CompactionResult {
  const originalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  );

  if (messages.length <= config.maxMessages) {
    return {
      messages,
      originalCount: messages.length,
      compactedCount: messages.length,
      savedTokens: 0,
    };
  }

  const keepSystem = config.keepSystemMessages ?? true;
  const keepTools = config.keepToolResults ?? true;

  // 分离需要保留的消息
  const toKeep: SessionMessage[] = [];
  const toCompact: SessionMessage[] = [];

  for (const msg of messages) {
    if (keepSystem && msg.role === 'system') {
      toKeep.push(msg);
    } else if (keepTools && msg.role === 'tool') {
      toKeep.push(msg);
    } else {
      toCompact.push(msg);
    }
  }

  // 保留最新的消息
  const remainingSlots = config.maxMessages - toKeep.length;
  const recentMessages = toCompact.slice(-remainingSlots);

  const result = [...toKeep, ...recentMessages].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );

  const compactedTokens = result.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  );

  return {
    messages: result,
    originalCount: messages.length,
    compactedCount: result.length,
    savedTokens: originalTokens - compactedTokens,
  };
}
```

**Step 4: 运行测试确认通过**

```bash
pnpm test tests/session/compaction.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add src/session/compaction.ts tests/session/compaction.test.ts
git commit -m "feat(session): enhance compaction with token estimation"
```

---

## Task 9: 更新 Session 导出

**Files:**
- Modify: `src/session/index.ts`

**Step 1: 更新导出**

```typescript
import {
  initSessionStorage,
  closeSessionStorage,
  createSession,
  getSession,
  listSessions,
  updateSession,
  addMessageToSession,
  deleteSession,
  markSessionCompacted,
  type Session,
  type SessionMessage,
} from './storage.js';

export { CheckpointManager } from './checkpoint.js';
export { compactMessages, estimateTokens } from './compaction.js';
export type { CompactionConfig, CompactionResult } from './compaction.js';
export type { Checkpoint, SessionConfig, PendingToolCall } from './types.js';

export type { Session, SessionMessage };

export interface SessionAPI {
  init(): Promise<void>;
  close(): void;
  create(options?: {
    title?: string;
    messages?: SessionMessage[];
    parentId?: string;
    projectId?: string;
  }): Promise<Session>;
  get(id: string): Promise<Session | null>;
  list(options?: {
    limit?: number;
    offset?: number;
    parentId?: string;
    projectId?: string;
  }): Promise<Session[]>;
  update(
    id: string,
    updates: Partial<Pick<Session, 'title' | 'messages' | 'parentId' | 'projectId'>>
  ): Promise<Session | null>;
  addMessage(id: string, message: SessionMessage): Promise<Session | null>;
  delete(id: string): Promise<boolean>;
}

export function createSessionAPI(): SessionAPI {
  return {
    async init() {
      await initSessionStorage();
    },
    close() {
      closeSessionStorage();
    },
    async create(options) {
      const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      return createSession(id, options?.title ?? 'New Session', {
        parentId: options?.parentId,
        projectId: options?.projectId,
        messages: options?.messages,
      });
    },
    async get(id) {
      return getSession(id);
    },
    async list(options) {
      return listSessions(options);
    },
    async update(id, updates) {
      return updateSession(id, updates);
    },
    async addMessage(id, message) {
      return addMessageToSession(id, message);
    },
    async delete(id) {
      return deleteSession(id);
    },
  };
}
```

**Step 2: 提交**

```bash
git add src/session/index.ts
git commit -m "feat(session): export checkpoint and compaction modules"
```

---

## Task 10: 运行完整测试

**Step 1: 运行所有测试**

```bash
pnpm test
```

Expected: 所有测试通过

**Step 2: 运行类型检查**

```bash
pnpm typecheck || pnpm tsc --noEmit
```

Expected: 无类型错误

**Step 3: 最终提交**

```bash
git add -A
git commit -m "feat: add sandbox and session persistence

- Add process-level sandbox with path validation and timeout
- Add checkpoint manager for session recovery
- Enhance session compaction with token estimation"
```

---

## 验证清单

- [ ] Sandbox 可以执行命令并返回结果
- [ ] Sandbox 可以验证路径访问权限
- [ ] Sandbox 可以超时终止命令
- [ ] CheckpointManager 可以创建检查点
- [ ] CheckpointManager 可以恢复检查点
- [ ] Compaction 可以压缩消息列表
- [ ] 所有测试通过
- [ ] 类型检查通过
