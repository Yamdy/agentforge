# Hook 系统增强实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增强 AgentForge 的 Hook 系统，添加阻塞能力、多执行后端支持、敏感路径保护功能。

**Architecture:** 在现有 PluginManager 基础上扩展，新增独立的 HookExecutor 模块，支持 function/command/http 三种执行后端，通过渐进式增强保持向后兼容。

**Tech Stack:** TypeScript, Zod (验证), minimatch (模式匹配), RxJS (现有)

---

## Task 1: 创建 Hook 类型定义

**Files:**
- Create: `src/hooks/types.ts`
- Create: `src/hooks/index.ts`

**Step 1: 创建 hooks 目录和类型文件**

```typescript
// src/hooks/types.ts

export type HookType = 'function' | 'command' | 'http';

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact';

export interface HookDefinition {
  type: HookType;
  matcher?: string;
  blockOnFailure: boolean;
  timeout?: number;
  handler?: string | HookFunction;
  command?: string;
  url?: string;
  headers?: Record<string, string>;
}

export type HookFunction = (
  input: Record<string, unknown>,
  output: Record<string, unknown>
) => Promise<HookResult | void>;

export interface HookResult {
  success: boolean;
  blocked: boolean;
  reason?: string;
  output?: string;
}

export interface AggregatedHookResult {
  results: HookResult[];
  blocked: boolean;
  reason: string;
}

export interface HookConfig {
  hooks: Record<HookEvent, HookDefinition[]>;
}
```

**Step 2: 创建导出入口**

```typescript
// src/hooks/index.ts

export * from './types';
export { HookExecutor } from './executor';
export { loadHookConfig, mergeHookConfigs, resolveHookEnvVariables } from './config';
export { createHookExecutor } from './agent-integration';
```

**Step 3: 验证类型检查**

Run: `cd d:\bug\github\agentforge && npx tsc --noEmit src/hooks/types.ts src/hooks/index.ts`
Expected: 无错误

**Step 4: Commit**

```bash
git add src/hooks/types.ts src/hooks/index.ts
git commit -m "feat(hooks): add hook type definitions"
```

---

## Task 2: 实现 HookExecutor 核心逻辑

**Files:**
- Create: `src/hooks/executor.ts`

**Step 1: 安装 minimatch 依赖**

Run: `cd d:\bug\github\agentforge && pnpm add minimatch && pnpm add -D @types/minimatch`
Expected: 依赖安装成功

**Step 2: 实现 HookExecutor**

```typescript
// src/hooks/executor.ts

import { minimatch } from 'minimatch';
import { spawn } from 'child_process';
import type {
  HookDefinition,
  HookResult,
  AggregatedHookResult,
  HookFunction,
  HookEvent,
} from './types';

export class HookExecutor {
  private registry: Map<HookEvent, HookDefinition[]> = new Map();
  private functionRegistry: Map<string, HookFunction> = new Map();

  register(event: HookEvent, hook: HookDefinition): void {
    if (!this.registry.has(event)) {
      this.registry.set(event, []);
    }
    this.registry.get(event)!.push(hook);
  }

  registerAll(event: HookEvent, hooks: HookDefinition[]): void {
    for (const hook of hooks) {
      this.register(event, hook);
    }
  }

  registerFunction(name: string, fn: HookFunction): void {
    this.functionRegistry.set(name, fn);
  }

  async execute(
    event: HookEvent,
    payload: Record<string, unknown>
  ): Promise<AggregatedHookResult> {
    const hooks = this.registry.get(event) ?? [];
    const results: HookResult[] = [];

    for (const hook of hooks) {
      if (hook.matcher && !this.match(hook.matcher, payload)) {
        continue;
      }

      const result = await this.executeWithTimeout(hook, payload);
      results.push(result);

      if (!result.success && hook.blockOnFailure) {
        return {
          results,
          blocked: true,
          reason: result.reason ?? 'Hook blocked the operation',
        };
      }
    }

    return {
      results,
      blocked: false,
      reason: '',
    };
  }

  private match(pattern: string, payload: Record<string, unknown>): boolean {
    const toolName = payload.toolName ?? payload.tool;
    if (typeof toolName !== 'string') return true;

    const patterns = pattern.split('|').map((p) => p.trim());
    return patterns.some((p) => minimatch(toolName, p));
  }

  private async executeWithTimeout(
    hook: HookDefinition,
    payload: Record<string, unknown>
  ): Promise<HookResult> {
    const timeout = hook.timeout ?? 30000;

    try {
      return await Promise.race([
        this.executeHook(hook, payload),
        this.createTimeoutResult(timeout),
      ]);
    } catch (err) {
      return {
        success: false,
        blocked: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeHook(
    hook: HookDefinition,
    payload: Record<string, unknown>
  ): Promise<HookResult> {
    switch (hook.type) {
      case 'function':
        return this.executeFunction(hook, payload);
      case 'command':
        return this.executeCommand(hook, payload);
      case 'http':
        return this.executeHttp(hook, payload);
      default:
        return { success: false, blocked: false, reason: 'Unknown hook type' };
    }
  }

  private async executeFunction(
    hook: HookDefinition,
    payload: Record<string, unknown>
  ): Promise<HookResult> {
    if (!hook.handler) {
      return { success: false, blocked: false, reason: 'No handler specified' };
    }

    let fn: HookFunction | undefined;

    if (typeof hook.handler === 'function') {
      fn = hook.handler;
    } else if (typeof hook.handler === 'string') {
      fn = this.functionRegistry.get(hook.handler);
    }

    if (!fn) {
      return { success: false, blocked: false, reason: 'Handler not found' };
    }

    try {
      const output: Record<string, unknown> = {};
      const result = await fn(payload, output);

      if (result === undefined) {
        return { success: true, blocked: false };
      }

      return result;
    } catch (err) {
      return {
        success: false,
        blocked: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeCommand(
    hook: HookDefinition,
    payload: Record<string, unknown>
  ): Promise<HookResult> {
    if (!hook.command) {
      return { success: false, blocked: false, reason: 'No command specified' };
    }

    return new Promise((resolve) => {
      const proc = spawn(hook.command!, [], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdin?.write(JSON.stringify(payload));
      proc.stdin?.end();

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data;
      });
      proc.stderr?.on('data', (data) => {
        stderr += data;
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout);
            resolve({
              success: true,
              blocked: parsed.blocked ?? false,
              reason: parsed.reason,
              output: stdout,
            });
          } catch {
            resolve({ success: true, blocked: false, output: stdout });
          }
        } else {
          resolve({
            success: false,
            blocked: true,
            reason: stderr || `Command exited with code ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, blocked: false, reason: err.message });
      });
    });
  }

  private async executeHttp(
    hook: HookDefinition,
    payload: Record<string, unknown>
  ): Promise<HookResult> {
    if (!hook.url) {
      return { success: false, blocked: false, reason: 'No URL specified' };
    }

    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...hook.headers,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          blocked: data.blocked ?? false,
          reason: data.reason,
          output: JSON.stringify(data),
        };
      } else {
        return {
          success: false,
          blocked: true,
          reason: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (err) {
      return {
        success: false,
        blocked: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private createTimeoutResult(ms: number): Promise<HookResult> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Hook timeout after ${ms}ms`)), ms);
    });
  }

  clear(): void {
    this.registry.clear();
    this.functionRegistry.clear();
  }
}
```

**Step 3: 验证类型检查**

Run: `cd d:\bug\github\agentforge && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add src/hooks/executor.ts package.json pnpm-lock.yaml
git commit -m "feat(hooks): implement HookExecutor with function/command/http support"
```

---

## Task 3: 实现敏感路径保护

**Files:**
- Create: `src/permissions/sensitive-paths.ts`

**Step 1: 创建敏感路径模块**

```typescript
// src/permissions/sensitive-paths.ts

import { minimatch } from 'minimatch';
import type { HookResult } from '../hooks/types';

export const BUILTIN_SENSITIVE_PATHS: readonly string[] = [
  '**/.ssh/**',
  '**/.ssh/id_*',
  '**/.ssh/authorized_keys',
  '**/.ssh/known_hosts',
  '**/.aws/credentials',
  '**/.aws/config',
  '**/.config/gcloud/**',
  '**/.azure/**',
  '**/.azure/accessTokens.json',
  '**/.kube/config',
  '**/.env',
  '**/.env.*',
  '**/.env.local',
  '**/.env.development.local',
  '**/.env.test.local',
  '**/.env.production.local',
  '**/secrets/**',
  '**/.secrets/**',
  '**/credentials.json',
  '**/service-account.json',
  '**/service_account.json',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.crt',
  '**/*.cer',
  '**/.git/**',
  '**/.password-store/**',
  '**/.gnupg/**',
  '**/.vscode/settings.json',
  '**/.idea/workspace.xml',
  '**/.docker/config.json',
  '**/.npmrc',
  '**/.yarnrc.yml',
];

export interface SensitivePathConfig {
  enableBuiltin: boolean;
  additionalPatterns: string[];
  excludePatterns: string[];
}

export function isSensitivePath(
  filePath: string,
  config: SensitivePathConfig = { enableBuiltin: true, additionalPatterns: [], excludePatterns: [] }
): { sensitive: boolean; matchedPattern?: string } {
  for (const pattern of config.excludePatterns) {
    if (minimatch(filePath, pattern, { dot: true })) {
      return { sensitive: false };
    }
  }

  const patterns: string[] = [];

  if (config.enableBuiltin) {
    patterns.push(...BUILTIN_SENSITIVE_PATHS);
  }

  patterns.push(...config.additionalPatterns);

  for (const pattern of patterns) {
    if (minimatch(filePath, pattern, { dot: true })) {
      return { sensitive: true, matchedPattern: pattern };
    }
  }

  return { sensitive: false };
}

export function createSensitivePathHook(
  config?: SensitivePathConfig
): (input: Record<string, unknown>, output: Record<string, unknown>) => Promise<HookResult> {
  return async (input) => {
    const toolName = input.toolName as string;
    const args = input.args as Record<string, unknown> | undefined;

    const fileTools = ['read', 'write', 'edit', 'Read', 'Write', 'Edit', 'bash', 'Bash'];
    if (!fileTools.includes(toolName)) {
      return { success: true, blocked: false };
    }

    let filePath: string | undefined;

    if (toolName.toLowerCase() === 'bash') {
      const command = args?.command as string | undefined;
      if (command) {
        filePath = extractPathFromCommand(command);
      }
    } else {
      filePath = (args?.filePath ?? args?.path ?? args?.file) as string | undefined;
    }

    if (!filePath) {
      return { success: true, blocked: false };
    }

    const result = isSensitivePath(filePath, config);

    if (result.sensitive) {
      return {
        success: false,
        blocked: true,
        reason: `Access denied: "${filePath}" matches sensitive path pattern "${result.matchedPattern}". This path requires explicit permission.`,
      };
    }

    return { success: true, blocked: false };
  };
}

function extractPathFromCommand(command: string): string | undefined {
  const pathPatterns = [
    /["']([^"']+\.[a-zA-Z]+)["']/,
    /["']([^"']+\/[^"']+)["']/,
    /\s([^\s]+\.[a-zA-Z]+)\s/,
    /\s([^\s]+\/[^\s]*)\s/,
  ];

  for (const pattern of pathPatterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}
```

**Step 2: 更新 permissions/index.ts 导出**

```typescript
// src/permissions/index.ts (在文件末尾添加)

export * from './sensitive-paths';
```

**Step 3: 验证类型检查**

Run: `cd d:\bug\github\agentforge && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add src/permissions/sensitive-paths.ts src/permissions/index.ts
git commit -m "feat(permissions): add sensitive path protection with builtin patterns"
```

---

## Task 4: 实现配置加载器

**Files:**
- Create: `src/hooks/config.ts`

**Step 1: 创建配置加载模块**

```typescript
// src/hooks/config.ts

import { z } from 'zod';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import type { HookDefinition, HookEvent, HookConfig } from './types';

const HookDefinitionSchema = z.object({
  type: z.enum(['function', 'command', 'http']),
  matcher: z.string().optional(),
  blockOnFailure: z.boolean().default(false),
  timeout: z.number().min(1000).max(300000).default(30000),
  handler: z.union([z.string(), z.function()]).optional(),
  command: z.string().optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
});

const HookConfigSchema = z.object({
  hooks: z.record(
    z.enum(['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact']),
    z.array(HookDefinitionSchema)
  ),
});

export interface HookConfigLoaderOptions {
  configPath?: string;
  cwd?: string;
}

const DEFAULT_CONFIG_PATHS = [
  '.agentforge/hooks.json',
  '.agentforge/config.json',
];

export async function loadHookConfig(
  options: HookConfigLoaderOptions = {}
): Promise<Map<HookEvent, HookDefinition[]>> {
  const cwd = options.cwd ?? process.cwd();

  let configPath = options.configPath;
  if (!configPath) {
    configPath = await findConfigFile(cwd);
  }

  if (!configPath) {
    return new Map();
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const json = JSON.parse(content);

    const configData = json.hooks ? json : { hooks: json };

    const config = HookConfigSchema.parse(configData);

    return convertConfigToMap(config);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map();
    }
    throw new Error(`Failed to load hook config from ${configPath}: ${err}`);
  }
}

async function findConfigFile(cwd: string): Promise<string | undefined> {
  for (const relativePath of DEFAULT_CONFIG_PATHS) {
    const fullPath = join(cwd, relativePath);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      // continue
    }
  }
  return undefined;
}

function convertConfigToMap(config: HookConfig): Map<HookEvent, HookDefinition[]> {
  const map = new Map<HookEvent, HookDefinition[]>();

  for (const [event, hooks] of Object.entries(config.hooks)) {
    map.set(event as HookEvent, hooks as HookDefinition[]);
  }

  return map;
}

export function mergeHookConfigs(
  base: Map<HookEvent, HookDefinition[]>,
  override: Map<HookEvent, HookDefinition[]>
): Map<HookEvent, HookDefinition[]> {
  const result = new Map<HookEvent, HookDefinition[]>();

  for (const [event, hooks] of base) {
    result.set(event, [...hooks]);
  }

  for (const [event, hooks] of override) {
    const existing = result.get(event) ?? [];
    result.set(event, [...existing, ...hooks]);
  }

  return result;
}

export function resolveEnvVariables(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      console.warn(`Environment variable ${varName} is not defined`);
      return '';
    }
    return value;
  });
}

export function resolveHookEnvVariables(hook: HookDefinition): HookDefinition {
  const resolved = { ...hook };

  if (resolved.command) {
    resolved.command = resolveEnvVariables(resolved.command);
  }

  if (resolved.url) {
    resolved.url = resolveEnvVariables(resolved.url);
  }

  if (resolved.headers) {
    resolved.headers = Object.fromEntries(
      Object.entries(resolved.headers).map(([k, v]) => [k, resolveEnvVariables(v)])
    );
  }

  return resolved;
}
```

**Step 2: 更新 hooks/index.ts 导出**

```typescript
// src/hooks/index.ts (确认已包含)

export * from './types';
export { HookExecutor } from './executor';
export { loadHookConfig, mergeHookConfigs, resolveHookEnvVariables } from './config';
export { createHookExecutor } from './agent-integration';
```

**Step 3: 验证类型检查**

Run: `cd d:\bug\github\agentforge && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add src/hooks/config.ts src/hooks/index.ts
git commit -m "feat(hooks): add hook config loader with env variable support"
```

---

## Task 5: 实现 Agent 集成

**Files:**
- Create: `src/hooks/agent-integration.ts`

**Step 1: 创建 Agent 集成模块**

```typescript
// src/hooks/agent-integration.ts

import { HookExecutor } from './executor';
import { loadHookConfig, resolveHookEnvVariables } from './config';
import { createSensitivePathHook, type SensitivePathConfig } from '../permissions/sensitive-paths';
import type { HookEvent, HookDefinition } from './types';

export interface AgentHookConfig {
  enableSensitivePathProtection?: boolean;
  sensitivePathConfig?: SensitivePathConfig;
  additionalHooks?: Map<HookEvent, HookDefinition[]>;
  configPath?: string;
}

export async function createHookExecutor(
  config: AgentHookConfig = {}
): Promise<HookExecutor> {
  const executor = new HookExecutor();

  if (config.enableSensitivePathProtection !== false) {
    executor.registerFunction('checkSensitivePath', createSensitivePathHook(config.sensitivePathConfig));

    executor.register('PreToolUse', {
      type: 'function',
      handler: 'checkSensitivePath',
      matcher: 'read|write|edit|Read|Write|Edit|bash|Bash',
      blockOnFailure: true,
      timeout: 5000,
    });
  }

  const configHooks = await loadHookConfig({ configPath: config.configPath });

  for (const [event, hooks] of configHooks) {
    for (const hook of hooks) {
      executor.register(event, resolveHookEnvVariables(hook));
    }
  }

  if (config.additionalHooks) {
    for (const [event, hooks] of config.additionalHooks) {
      for (const hook of hooks) {
        executor.register(event, hook);
      }
    }
  }

  return executor;
}
```

**Step 2: 验证类型检查**

Run: `cd d:\bug\github\agentforge && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add src/hooks/agent-integration.ts
git commit -m "feat(hooks): add agent integration with sensitive path protection"
```

---

## Task 6: 扩展 PluginManager

**Files:**
- Modify: `src/plugin/manager.ts`

**Step 1: 修改 PluginManager 集成 HookExecutor**

在文件开头添加导入：

```typescript
// src/plugin/manager.ts (添加导入)

import { HookExecutor } from '../hooks/executor';
import type { HookDefinition, HookResult, HookEvent } from '../hooks/types';
```

在类中添加属性和方法：

```typescript
// src/plugin/manager.ts (在 PluginManager 类中添加)

export class PluginManager {
  // ... 现有属性 ...
  
  private hookExecutor: HookExecutor;

  constructor(config: PluginManagerConfig = {}, directory: string = process.cwd()) {
    this.context = createPluginContext({ plugins: [] }, directory);
    this.hookExecutor = new HookExecutor();  // 添加这行
    
    if (config.plugins) {
      this.plugins = config.plugins;
      this.registerPluginHooks();
    }
  }

  getHookExecutor(): HookExecutor {
    return this.hookExecutor;
  }

  async executeHook(
    event: HookEvent,
    payload: Record<string, unknown>
  ): Promise<{ blocked: boolean; reason: string }> {
    const result = await this.hookExecutor.execute(event, payload);
    return {
      blocked: result.blocked,
      reason: result.reason,
    };
  }

  registerHook(event: HookEvent, hook: HookDefinition): void {
    this.hookExecutor.register(event, hook);
  }

  registerHookFunction(
    name: string,
    fn: (input: Record<string, unknown>, output: Record<string, unknown>) => Promise<HookResult>
  ): void {
    this.hookExecutor.registerFunction(name, fn);
  }

  // 在 destroy() 方法中添加
  destroy(): void {
    this.subscriptions.unsubscribe();
    this.subjects.forEach((subject) => subject.complete());
    this.subjects.clear();
    this.pluginSubscriptions.clear();
    this.hookExecutor.clear();  // 添加这行
  }
}
```

**Step 2: 验证类型检查**

Run: `cd d:\bug\github\agentforge && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add src/plugin/manager.ts
git commit -m "feat(plugin): integrate HookExecutor into PluginManager"
```

---

## Task 7: 更新主入口导出

**Files:**
- Modify: `src/index.ts`

**Step 1: 添加 hooks 模块导出**

```typescript
// src/index.ts (添加导出)

export * from './hooks';
```

**Step 2: 验证类型检查**

Run: `cd d:\bug\github\agentforge && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export hooks module from main entry"
```

---

## Task 8: 运行完整测试

**Step 1: 运行类型检查**

Run: `cd d:\bug\github\agentforge && pnpm typecheck`
Expected: 无错误

**Step 2: 运行 lint**

Run: `cd d:\bug\github\agentforge && pnpm lint`
Expected: 无错误

**Step 3: 运行测试**

Run: `cd d:\bug\github\agentforge && pnpm test:run`
Expected: 所有测试通过

**Step 4: 构建验证**

Run: `cd d:\bug\github\agentforge && pnpm build`
Expected: 构建成功

**Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat(hooks): complete hook system enhancement

- Add HookExecutor with function/command/http support
- Add sensitive path protection with 40+ builtin patterns
- Add hook config loader with env variable support
- Integrate with PluginManager for backward compatibility
- Support blocking capability for security control"
```

---

## 文件清单总结

| 文件 | 操作 |
|------|------|
| `src/hooks/types.ts` | 新增 |
| `src/hooks/index.ts` | 新增 |
| `src/hooks/executor.ts` | 新增 |
| `src/hooks/config.ts` | 新增 |
| `src/hooks/agent-integration.ts` | 新增 |
| `src/permissions/sensitive-paths.ts` | 新增 |
| `src/permissions/index.ts` | 修改 |
| `src/plugin/manager.ts` | 修改 |
| `src/index.ts` | 修改 |
| `package.json` | 修改 (添加 minimatch) |
