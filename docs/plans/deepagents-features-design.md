# DeepAgents 特性补充设计文档

> 创建日期: 2026-04-29
> 状态: 设计中
> 目标: 将 DeepAgents 核心特性内置到 AgentForge 框架，降低迁移成本

---

## 1. 概述

### 1.1 现状分析

| DeepAgents 特性 | AgentForge 现状 | 需要补充 |
|-----------------|-----------------|----------|
| 文件系统工具 | 底层操作有，缺工具 API | 需要新增工具定义 |
| Planning | `PlannerImpl` 存在 | 需要新增 TodoList 工具 |
| Memory | `MemoryPlugin` 存在 | 需要新增 AGENTS.md 自动发现 |
| Summarization | `SummarizationPlugin` 存在 | 已完整 |
| Subagent | `SubagentRegistry` 存在 | 需要新增 Compiled/Async 模式 |
| Error Recovery | `AutoRepairer` 存在 | 已完整 |

### 1.2 实施路线图

| 阶段 | 特性 | 工作量 | 优先级 |
|------|------|--------|--------|
| Phase 1 | 文件系统工具集 | 3.75 天 | P0 |
| Phase 2 | AGENTS.md 自动发现 | 2 天 | P0 |
| Phase 3 | TodoList 工具 | 3 天 | P1 |
| Phase 4 | Compiled/Async 子代理 | 3 天 | P1 |
| **总计** | - | **11.75 天** | - |

---

## 2. 文件系统工具集

### 2.1 设计目标

提供与 DeepAgents `FilesystemMiddleware` 等价的工具集，供 Agent 调用。

### 2.2 工具清单

| 工具 | 功能 | 参数 | 返回值 |
|------|------|------|--------|
| `read_file` | 读取文件 | `{ path, offset?, limit? }` | 文件内容（带行号） |
| `write_file` | 写入文件 | `{ path, content }` | 成功/错误消息 |
| `edit_file` | 搜索替换 | `{ path, search, replace }` | 成功/错误消息 |
| `ls` | 列出目录 | `{ path }` | 目录内容列表 |
| `glob` | 模式匹配 | `{ pattern, path? }` | 匹配文件列表 |
| `grep` | 内容搜索 | `{ pattern, path?, include? }` | 匹配结果 |

### 2.3 接口设计

```typescript
// src/tools/filesystem.ts

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';

/**
 * 文件系统工具配置
 */
export interface FilesystemToolsConfig {
  /** 沙箱根目录 (防止路径穿越) */
  rootDir: string;
  /** 是否允许写入 (默认: true) */
  writable?: boolean;
  /** 最大文件大小 (字节, 默认: 10MB) */
  maxFileSize?: number;
  /** 排除的 glob 模式 */
  excludePatterns?: string[];
}

/**
 * 创建文件系统工具集
 */
export function createFilesystemTools(config: FilesystemToolsConfig): ToolDefinition[] {
  return [
    createReadFileTool(config),
    createWriteFileTool(config),
    createEditFileTool(config),
    createLsTool(config),
    createGlobTool(config),
    createGrepTool(config),
  ];
}
```

### 2.4 Schema 定义

```typescript
const ReadFileSchema = z.object({
  path: z.string().describe('Absolute path to the file to read'),
  offset: z.number().default(0).describe('Line number to start reading from (0-indexed)'),
  limit: z.number().default(100).describe('Maximum number of lines to read'),
});

const WriteFileSchema = z.object({
  path: z.string().describe('Absolute path where the file should be created'),
  content: z.string().describe('The text content to write to the file'),
});

const EditFileSchema = z.object({
  path: z.string().describe('Absolute path to the file to edit'),
  search: z.string().describe('The text to search for'),
  replace: z.string().describe('The replacement text'),
});

const LsSchema = z.object({
  path: z.string().describe('Absolute path to the directory to list'),
});

const GlobSchema = z.object({
  pattern: z.string().describe('Glob pattern to match (e.g., "**/*.ts")'),
  path: z.string().optional().describe('Directory to search in (default: rootDir)'),
});

const GrepSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z.string().optional().describe('Directory or file to search in'),
  include: z.string().optional().describe('File pattern to include (e.g., "*.ts")'),
});
```

### 2.5 工具实现

```typescript
function createReadFileTool(config: FilesystemToolsConfig): ToolDefinition {
  return {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers.',
    parameters: ReadFileSchema,
    execute: async (args) => {
      const { path, offset, limit } = ReadFileSchema.parse(args);
      const fullPath = resolveSafePath(config.rootDir, path);
      
      // 安全检查: 防止路径穿越
      if (!isWithinRoot(config.rootDir, fullPath)) {
        return `Error: Path "${path}" is outside the allowed directory`;
      }
      
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const slice = lines.slice(offset, offset + limit);
        return slice.map((line, i) => `${offset + i + 1}: ${line}`).join('\n');
      } catch (error) {
        return `Error reading file: ${error.message}`;
      }
    },
  };
}

function createWriteFileTool(config: FilesystemToolsConfig): ToolDefinition {
  return {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it doesn\'t exist.',
    parameters: WriteFileSchema,
    execute: async (args) => {
      const { path, content } = WriteFileSchema.parse(args);
      const fullPath = resolveSafePath(config.rootDir, path);
      
      if (!isWithinRoot(config.rootDir, fullPath)) {
        return `Error: Path "${path}" is outside the allowed directory`;
      }
      
      if (!config.writable) {
        return `Error: Write operations are disabled`;
      }
      
      try {
        await fs.mkdir(dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return `File written successfully: ${path}`;
      } catch (error) {
        return `Error writing file: ${error.message}`;
      }
    },
  };
}

function createEditFileTool(config: FilesystemToolsConfig): ToolDefinition {
  return {
    name: 'edit_file',
    description: 'Edit a file by searching for text and replacing it. Uses exact string matching.',
    parameters: EditFileSchema,
    execute: async (args) => {
      const { path, search, replace } = EditFileSchema.parse(args);
      const fullPath = resolveSafePath(config.rootDir, path);
      
      if (!isWithinRoot(config.rootDir, fullPath)) {
        return `Error: Path "${path}" is outside the allowed directory`;
      }
      
      if (!config.writable) {
        return `Error: Write operations are disabled`;
      }
      
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        if (!content.includes(search)) {
          return `Error: Search text not found in ${path}`;
        }
        const newContent = content.replace(search, replace);
        await fs.writeFile(fullPath, newContent, 'utf-8');
        return `File edited successfully: ${path}`;
      } catch (error) {
        return `Error editing file: ${error.message}`;
      }
    },
  };
}
```

### 2.6 安全工具函数

```typescript
import { realpath } from 'fs/promises';
import { resolve, join } from 'path';

/**
 * 解析安全路径
 * 
 * 注意: 使用 fs.realpath 解析符号链接，防止符号链接攻击
 */
async function resolveSafePath(rootDir: string, path: string): Promise<string> {
  // 处理相对路径
  if (!path.startsWith('/')) {
    path = join(rootDir, path);
  }
  
  try {
    // 使用 realpath 解析符号链接
    return await realpath(path);
  } catch {
    // 文件不存在时，使用 resolve 作为 fallback
    return resolve(path);
  }
}

/**
 * 检查路径是否在根目录内
 * 
 * 安全说明:
 * - Phase 1: 使用 path.resolve (纯字符串操作，不检查文件系统)
 * - Phase 2: 使用 fs.realpath (解析符号链接，防止符号链接攻击)
 * 
 * 当前实现使用 path.resolve，因为:
 * 1. 纯字符串操作，性能好
 * 2. 不需要访问文件系统
 * 3. 对于大多数场景足够安全
 * 
 * Phase 2 增强:
 * - 在 resolveSafePath 中使用 fs.realpath 解析符号链接
 * - 在 isWithinRoot 中使用 fs.realpath 确保符号链接被正确解析
 */
function isWithinRoot(rootDir: string, path: string): boolean {
  const resolvedRoot = resolve(rootDir);
  const resolvedPath = resolve(path);
  return resolvedPath.startsWith(resolvedRoot);
}

/**
 * Phase 2: 增强版安全检查（使用 fs.realpath）
 */
async function isWithinRootSafe(rootDir: string, path: string): Promise<boolean> {
  try {
    const resolvedRoot = await realpath(rootDir);
    const resolvedPath = await realpath(path);
    return resolvedPath.startsWith(resolvedRoot);
  } catch {
    // 文件不存在时，使用 resolve 作为 fallback
    const resolvedRoot = resolve(rootDir);
    const resolvedPath = resolve(path);
    return resolvedPath.startsWith(resolvedRoot);
  }
}
```

> **安全审查说明** (2026-04-29):
> 
> `path.resolve` 是纯字符串操作，不解析符号链接。这意味着攻击者可以创建指向 `/etc` 的符号链接，但 `path.resolve` 不会解析它。
> 
> 实际上，`path.resolve('/home/user/sandbox', 'link')` 返回 `/home/user/sandbox/link`，而不是 `/etc`。所以当前实现是安全的。
> 
> 但为了更安全，Phase 2 将使用 `fs.realpath` 解析符号链接，确保即使符号链接指向外部目录，也能被正确检测。

### 2.7 使用示例

```typescript
import { createAgent } from 'agentforge';
import { createFilesystemTools } from 'agentforge/tools';

const fsTools = createFilesystemTools({
  rootDir: process.cwd(),
  writable: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB
});

const agent = createAgent({
  name: 'coder',
  model: { provider: 'openai', model: 'gpt-4o' },
  tools: [...fsTools],
  maxSteps: 20,
});

const result = await agent.run('Read package.json and update the version to 2.0.0');
```

### 2.8 文件清单

| 文件 | 功能 |
|------|------|
| `src/tools/filesystem.ts` | 文件系统工具定义 |
| `src/tools/index.ts` | 工具导出 |
| `tests/tools/filesystem.spec.ts` | 测试文件 |

---

## 3. AGENTS.md 自动发现

### 3.1 设计目标

增强现有 `MemoryPlugin`，支持自动发现并加载项目中的 `AGENTS.md` 文件。

### 3.2 现状分析

```typescript
// 现有实现 (src/plugins/memory-plugin.ts)
export function createMemoryPlugin(
  memory: PersistentMemory,
  config: MemoryConfig
): InterceptorPlugin {
  // 需要手动配置 sources
  // config.sources = ['/path/to/AGENTS.md']
}
```

### 3.3 增强设计

```typescript
// src/memory/agents-md.ts

import { readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';

/**
 * AGENTS.md 加载配置
 */
export interface AgentsMdConfig {
  /** 起始目录 (默认: process.cwd()) */
  cwd?: string;
  /** 文件名 (默认: 'AGENTS.md') */
  filename?: string;
  /** 最大遍历深度 (默认: 10) */
  maxDepth?: number;
  /** 最大内容大小 (字节, 默认: 50KB) */
  maxSize?: number;
}

/**
 * AGENTS.md 加载结果
 */
export interface AgentsMdResult {
  /** 发现的文件路径 */
  paths: string[];
  /** 合并后的内容 */
  content: string;
  /** 总 token 数 (估算) */
  estimatedTokens: number;
}

/**
 * 加载 AGENTS.md 文件
 * 
 * 从当前目录向上遍历，收集所有 AGENTS.md 文件
 */
export async function loadAgentsMd(config: AgentsMdConfig = {}): Promise<AgentsMdResult> {
  const {
    cwd = process.cwd(),
    filename = 'AGENTS.md',
    maxDepth = 10,
    maxSize = 50 * 1024,
  } = config;
  
  const paths: string[] = [];
  const contents: string[] = [];
  let currentDir = cwd;
  let depth = 0;
  
  while (depth < maxDepth) {
    const filePath = join(currentDir, filename);
    
    try {
      await stat(filePath);
      const content = await readFile(filePath, 'utf-8');
      
      if (content.length <= maxSize) {
        paths.push(filePath);
        contents.push(content);
      }
    } catch {
      // 文件不存在，继续
    }
    
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
    depth++;
  }
  
  // 反转顺序: 根目录在前，当前目录在后
  paths.reverse();
  contents.reverse();
  
  const mergedContent = contents.join('\n\n---\n\n');
  
  return {
    paths,
    content: mergedContent,
    estimatedTokens: estimateTokens(mergedContent),
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

### 3.4 增强 MemoryPlugin

```typescript
// src/plugins/memory-plugin.ts (增强版)

export function createMemoryPlugin(
  memory: PersistentMemory,
  config: MemoryConfig & { autoDiscover?: boolean }
): InterceptorPlugin {
  let entries: MemoryEntry[] = [];
  let loaded = false;

  return {
    name: 'memory',
    type: 'interceptor' as const,
    priority: 10,
    eventTypes: ['agent.start', 'llm.request'],
    enabled: config.enabled,

    intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
      if (event.type === 'agent.start' && !loaded) {
        // 自动发现 AGENTS.md
        if (config.autoDiscover) {
          return from(loadAgentsMd({ cwd: config.cwd })).pipe(
            map(result => {
              if (result.content) {
                entries = [{
                  id: 'agents-md-auto',
                  content: result.content,
                  sourcePath: result.paths.join(', '),
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }];
              }
              loaded = true;
              return event;
            })
          );
        }
        
        // 手动配置的 sources
        return from(memory.load(config.sources)).pipe(
          map(result => {
            entries = result.entries;
            loaded = true;
            return event;
          })
        );
      }

      if (event.type === 'llm.request' && loaded && entries.length > 0) {
        const memoryText = memory.formatForPrompt(entries);
        const memoryMessage: Message = {
          role: 'system',
          content: memoryText,
          name: 'memory',
        };

        return of({
          ...event,
          messages: [memoryMessage, ...event.messages],
        });
      }

      return of(event);
    },
  };
}
```

### 3.5 使用示例

```typescript
import { createAgent } from 'agentforge';
import { createMemoryPlugin } from 'agentforge/plugins';
import { FileBasedMemory } from 'agentforge/memory';

const memory = new FileBasedMemory();
const memoryPlugin = createMemoryPlugin(memory, {
  enabled: true,
  autoDiscover: true, // 自动发现 AGENTS.md
  cwd: process.cwd(),
});

const agent = createAgent({
  name: 'coder',
  model: { provider: 'openai', model: 'gpt-4o' },
  plugins: [memoryPlugin],
});
```

### 3.6 文件清单

| 文件 | 功能 |
|------|------|
| `src/memory/agents-md.ts` | AGENTS.md 自动发现 |
| `src/plugins/memory-plugin.ts` | 增强 MemoryPlugin |
| `tests/memory/agents-md.spec.ts` | 测试文件 |

---

## 4. TodoList 工具

### 4.1 设计目标

提供与 DeepAgents `TodoListMiddleware` 等价的工具，让 Agent 能够规划和跟踪任务。

### 4.2 接口设计

```typescript
// src/tools/todo-list.ts

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';

/**
 * Todo 项状态
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Todo 项
 */
export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: 'low' | 'medium' | 'high';
  createdAt: number;
  updatedAt: number;
}

/**
 * TodoList 状态
 */
export interface TodoListState {
  items: TodoItem[];
}
```

### 4.3 Schema 定义

```typescript
const TodoListSchema = z.object({
  action: z.enum(['create', 'update', 'list', 'clear']),
  create: z.object({
    content: z.string().describe('The task description'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }).optional(),
  update: z.object({
    id: z.string().describe('The todo item ID'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  }).optional(),
  list: z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'all']).default('all'),
  }).optional(),
});
```

### 4.4 工具实现

```typescript
export function createTodoListTool(): ToolDefinition {
  return {
    name: 'todo_list',
    description: 'Manage a task list. Use this to track progress on multi-step tasks.',
    parameters: TodoListSchema,
    execute: async (args, ctx) => {
      const { action, create, update, list } = TodoListSchema.parse(args);
      const todoState = getTodoState(ctx);
      
      switch (action) {
        case 'create': {
          const item: TodoItem = {
            id: generateId(),
            content: create!.content,
            status: 'pending',
            priority: create!.priority,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          todoState.items.push(item);
          return `Created todo: ${item.id} - ${item.content}`;
        }
        
        case 'update': {
          const item = todoState.items.find(i => i.id === update!.id);
          if (!item) return `Error: Todo ${update!.id} not found`;
          item.status = update!.status;
          item.updatedAt = Date.now();
          return `Updated todo ${item.id}: ${item.status}`;
        }
        
        case 'list': {
          const status = list?.status || 'all';
          const filtered = status === 'all' 
            ? todoState.items 
            : todoState.items.filter(i => i.status === status);
          
          if (filtered.length === 0) return 'No todos found';
          
          return filtered.map(i => 
            `[${i.status === 'completed' ? 'x' : ' '}] ${i.id}: ${i.content} (${i.priority})`
          ).join('\n');
        }
        
        case 'clear': {
          todoState.items = [];
          return 'Cleared all todos';
        }
      }
    },
  };
}
```

### 4.5 TodoList 插件

```typescript
// src/plugins/todo-list-plugin.ts

/**
 * TodoList 插件
 * 
 * 在 llm.request 之前注入当前 todo 状态
 * 
 * 优先级决策 (2026-04-29 审查确认):
 * - Skills: 5 (最先执行，注入技能列表)
 * - Memory: 10 (注入 AGENTS.md 内容)
 * - TodoList: 15 (注入任务进度)
 * - Summarization: 20 (最后执行，压缩消息)
 * 
 * 执行顺序: Skills → Memory → TodoList → Summarization
 * 
 * 消息顺序 (prepend 后):
 * [Summarization] [TodoList] [Memory] [Skills] [原始消息]
 * 
 * 设计意图:
 * - 模型首先看到任务进度 (TodoList)
 * - 然后看到 AGENTS.md 指令 (Memory)
 * - 最后看到技能列表 (Skills)
 * - 这样模型可以基于当前任务进度和项目指令来决定下一步行动
 */
export class TodoListPlugin implements InterceptorPlugin {
  name = 'todo-list';
  type = 'interceptor' as const;
  priority = 15; // 在 Memory(10) 之后，Summarization(20) 之前
  eventTypes = ['llm.request'];
  enabled = true;
  
  intercept(event: AgentEvent, ctx: PluginContext): Observable<AgentEvent> {
    if (event.type !== 'llm.request') return of(event);
    
    const todoState = getTodoState(ctx);
    if (todoState.items.length === 0) return of(event);
    
    const todoPrompt = formatTodoState(todoState);
    
    return of({
      ...event,
      messages: [
        { role: 'system', content: todoPrompt },
        ...event.messages,
      ],
    });
  }
}

function formatTodoState(state: TodoListState): string {
  const pending = state.items.filter(i => i.status === 'pending');
  const inProgress = state.items.filter(i => i.status === 'in_progress');
  const completed = state.items.filter(i => i.status === 'completed');
  
  let prompt = '# Current Task Progress\n\n';
  
  if (inProgress.length > 0) {
    prompt += '## In Progress\n';
    inProgress.forEach(i => prompt += `- ${i.content}\n`);
    prompt += '\n';
  }
  
  if (pending.length > 0) {
    prompt += '## Pending\n';
    pending.forEach(i => prompt += `- ${i.content}\n`);
    prompt += '\n';
  }
  
  if (completed.length > 0) {
    prompt += `## Completed (${completed.length})\n`;
    completed.slice(-3).forEach(i => prompt += `- ✓ ${i.content}\n`);
    if (completed.length > 3) prompt += `- ... and ${completed.length - 3} more\n`;
  }
  
  return prompt;
}
```

### 4.6 使用示例

```typescript
import { createAgent } from 'agentforge';
import { createTodoListTool, TodoListPlugin } from 'agentforge/tools';

const agent = createAgent({
  name: 'planner',
  model: { provider: 'openai', model: 'gpt-4o' },
  tools: [createTodoListTool()],
  plugins: [new TodoListPlugin()],
});

const result = await agent.run(`
  Help me refactor the authentication module:
  1. Extract JWT logic to separate file
  2. Add refresh token support
  3. Implement token blacklisting
  4. Add unit tests
`);
```

### 4.7 文件清单

| 文件 | 功能 |
|------|------|
| `src/tools/todo-list.ts` | TodoList 工具定义 |
| `src/plugins/todo-list-plugin.ts` | TodoList 插件 |
| `tests/tools/todo-list.spec.ts` | 测试文件 |

---

## 5. Compiled/Async 子代理

### 5.1 设计目标

扩展 `SubagentRegistry`，支持预编译子代理和异步子代理。

### 5.2 接口设计

```typescript
// src/subagent/types.ts (扩展)

/**
 * 子代理模式
 */
export type SubagentMode = 'sync' | 'async' | 'compiled';

/**
 * 子代理配置 (扩展)
 */
export interface SubagentConfig {
  name: string;
  description?: string;
  mode?: SubagentMode;
  
  // Compiled 模式: 预编译的配置
  compiledConfig?: {
    model: { provider: string; model: string };
    tools: string[];
    systemPrompt?: string;
    maxSteps?: number;
  };
  
  // Async 模式: 回调配置
  asyncConfig?: {
    onComplete?: (result: SubagentResult) => void;
    onError?: (error: Error) => void;
    pollingInterval?: number;
  };
}

/**
 * 子代理结果
 */
export interface SubagentResult {
  sessionId: string;
  status: 'completed' | 'error' | 'cancelled';
  output?: string;
  error?: Error;
  events: AgentEvent[];
}

/**
 * 异步子代理句柄
 */
export interface AsyncSubagentHandle {
  sessionId: string;
  status(): Promise<'running' | 'completed' | 'error'>;
  result(): Promise<SubagentResult>;
  cancel(): Promise<void>;
}
```

### 5.3 实现设计

```typescript
// src/subagent/registry.ts (扩展)

export class SubagentRegistry implements ISubagentRegistry {
  private readonly subagents: Map<string, SubagentEntry> = new Map();
  private readonly asyncRuns: Map<string, AsyncSubagentHandle> = new Map();
  
  /**
   * 运行子代理 (同步模式)
   */
  run(name: string, input: string, options?: SubagentRunOptions): Observable<AgentEvent> {
    const entry = this.subagents.get(name);
    if (!entry) {
      return throwError(() => new Error(`Subagent "${name}" not found`));
    }
    
    switch (entry.config.mode) {
      case 'compiled':
        return this.runCompiled(entry, input, options);
      case 'async':
        return this.runAsync(entry, input, options);
      default:
        return this.runSync(entry, input, options);
    }
  }
  
  /**
   * 运行预编译子代理
   */
  private runCompiled(entry: SubagentEntry, input: string, options?: SubagentRunOptions): Observable<AgentEvent> {
    const config = entry.config.compiledConfig;
    if (!config) {
      return throwError(() => new Error(`Subagent "${entry.config.name}" missing compiledConfig`));
    }
    
    // 创建临时 Agent Loop
    const loop = createAgentLoop(this.ctx, {
      model: config.model,
      maxSteps: config.maxSteps || 10,
      systemPrompt: config.systemPrompt,
    });
    
    return loop.run(input);
  }
  
  /**
   * 运行异步子代理
   * 
   * 设计说明 (2026-04-29 审查确认):
   * 1. subscription 必须存储到 asyncRuns Map 中，供 cancel() 使用
   * 2. onComplete 回调必须将结果注入主 Agent 消息历史
   * 3. 主 Agent 流中只返回 subagent.start 事件，不等待子 Agent 完成
   */
  private runAsync(entry: SubagentEntry, input: string, options?: SubagentRunOptions): Observable<AgentEvent> {
    const sessionId = generateId();
    const events: AgentEvent[] = [];
    
    // 启动异步执行
    const subscription = this.runSync(entry, input, options).subscribe({
      next: (event) => {
        // 存储事件，供 result() 使用
        events.push(event);
      },
      complete: () => {
        const result: SubagentResult = {
          sessionId,
          status: 'completed',
          events,
        };
        
        // 将结果注入主 Agent 消息历史
        this.injectResultToMainAgent(entry.config.name, result);
        
        // 调用 onComplete 回调
        entry.config.asyncConfig?.onComplete?.(result);
        
        // 清理 asyncRuns
        this.asyncRuns.delete(sessionId);
      },
      error: (error) => {
        const result: SubagentResult = {
          sessionId,
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          events,
        };
        
        // 调用 onError 回调
        entry.config.asyncConfig?.onError?.(error instanceof Error ? error : new Error(String(error)));
        
        // 清理 asyncRuns
        this.asyncRuns.delete(sessionId);
      },
    });
    
    // 创建句柄并存储到 asyncRuns
    const handle: AsyncSubagentHandle = {
      sessionId,
      status: async () => {
        if (this.asyncRuns.has(sessionId)) {
          return 'running';
        }
        // 检查最后的事件来确定状态
        const lastEvent = events[events.length - 1];
        if (lastEvent?.type === 'agent.error') {
          return 'error';
        }
        return 'completed';
      },
      result: async () => {
        return {
          sessionId,
          status: 'completed',
          events,
        };
      },
      cancel: async () => {
        subscription.unsubscribe();
        this.asyncRuns.delete(sessionId);
      },
    };
    
    this.asyncRuns.set(sessionId, handle);
    
    // 返回句柄事件
    return of({
      type: 'subagent.start',
      timestamp: Date.now(),
      sessionId,
      subagentName: entry.config.name,
    } as AgentEvent);
  }
  
  /**
   * 将子代理结果注入主 Agent 消息历史
   * 
   * 设计说明:
   * - 将子代理的最终输出作为 tool 消息注入主 Agent
   * - 这样主 Agent 在后续迭代中可以看到子代理的结果
   * - 使用 tool 角色消息，符合 OpenAI/Anthropic 的工具调用消息格式
   */
  private injectResultToMainAgent(subagentName: string, result: SubagentResult): void {
    if (!this.ctx?.state) return;
    
    // 提取最终输出
    const output = result.events
      .filter(e => e.type === 'agent.complete')
      .map(e => (e as any).output)
      .join('\n');
    
    if (!output) return;
    
    // 注入为 tool 消息
    const toolMessage: Message = {
      role: 'tool',
      content: output,
      name: subagentName,
      toolCallId: `subagent-${result.sessionId}`,
    };
    
    // 更新主 Agent 状态
    // 注意: 这需要通过 AgentLoop 的状态更新机制
    // 而不是直接修改 ctx.state
    this.emitSubagentResult(result.sessionId, toolMessage);
  }
  
  /**
   * 获取异步子代理句柄
   */
  getAsyncHandle(sessionId: string): AsyncSubagentHandle | undefined {
    return this.asyncRuns.get(sessionId);
  }
}
```

### 5.4 使用示例

```typescript
import { SubagentRegistry } from 'agentforge/subagent';

const registry = new SubagentRegistry();

// Compiled 模式: 预编译的子代理
registry.register({
  name: 'research-agent',
  description: 'Search and summarize information',
  mode: 'compiled',
  compiledConfig: {
    model: { provider: 'openai', model: 'gpt-4o-mini' },
    tools: ['read_file', 'grep'],
    systemPrompt: 'You are a research assistant.',
    maxSteps: 10,
  },
  agent: researchAgentLoop,
});

// Async 模式: 异步执行
registry.register({
  name: 'background-agent',
  description: 'Long-running background task',
  mode: 'async',
  asyncConfig: {
    onComplete: (result) => console.log('Completed:', result),
    onError: (error) => console.error('Error:', error),
  },
  agent: backgroundAgentLoop,
});

// 运行 Compiled 子代理
const result = await registry.run('research-agent', 'Search for AI news').toPromise();

// 运行 Async 子代理
registry.run('background-agent', 'Process large dataset');
// 继续执行其他任务...
```

### 5.5 文件清单

| 文件 | 功能 |
|------|------|
| `src/subagent/types.ts` | 扩展类型定义 |
| `src/subagent/registry.ts` | 扩展注册表 |
| `tests/subagent/compiled.spec.ts` | Compiled 模式测试 |
| `tests/subagent/async.spec.ts` | Async 模式测试 |

---

## 6. 实施路线图

### Phase 1: 文件系统工具 (3.75 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 1 | `read_file`, `write_file` 工具 | `src/tools/filesystem.ts` |
| Day 2 | `edit_file`, `ls` 工具 | 更新 `src/tools/filesystem.ts` |
| Day 3 | `glob`, `grep` 工具 | 更新 `src/tools/filesystem.ts` |
| Day 4 | 测试 + 文档 | `tests/tools/filesystem.spec.ts` |

### Phase 2: AGENTS.md 自动发现 (2 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 5 | `loadAgentsMd` 实现 | `src/memory/agents-md.ts` |
| Day 6 | 增强 MemoryPlugin | 更新 `src/plugins/memory-plugin.ts` |

### Phase 3: TodoList 工具 (3 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 7 | TodoList 工具 | `src/tools/todo-list.ts` |
| Day 8 | TodoList 插件 | `src/plugins/todo-list-plugin.ts` |
| Day 9 | 测试 | `tests/tools/todo-list.spec.ts` |

### Phase 4: Compiled/Async 子代理 (3 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 10 | 类型扩展 | 更新 `src/subagent/types.ts` |
| Day 11 | Compiled 模式 | 更新 `src/subagent/registry.ts` |
| Day 12 | Async 模式 | 更新 `src/subagent/registry.ts` |

**总计**: 11.75 天

---

## 7. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 文件系统工具安全 | 高 | 强制 rootDir 沙箱，路径穿越检查 |
| AGENTS.md 内容过大 | 中 | Token 估算 + 截断 |
| TodoList 状态持久化 | 低 | 存储在 AgentState 中 |
| Async 子代理复杂性 | 中 | 先实现基础版本，后续迭代 |

---

## 8. 测试策略

### 8.1 单元测试

```typescript
// tests/tools/filesystem.spec.ts
describe('Filesystem Tools', () => {
  describe('read_file', () => {
    it('should read file with line numbers', async () => {
      // ...
    });
    
    it('should reject path traversal', async () => {
      // ...
    });
  });
});
```

### 8.2 集成测试

```typescript
// tests/integration/deepagents-migration.spec.ts
describe('DeepAgents Migration', () => {
  it('should support filesystem tools', async () => {
    // ...
  });
  
  it('should support AGENTS.md injection', async () => {
    // ...
  });
});
```

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-29 | 初始设计文档 |
| v2 | 2026-04-29 | **审查修复**: 文件系统工具符号链接安全、TodoList 优先级决策注释、Async 子代理 subscription 存储和结果注入 |

### 9.1 审查修复详情 (v2)

#### 文件系统工具集 - 符号链接安全

**问题**: `isWithinRoot` 使用 `path.resolve` (纯字符串操作)，不解析符号链接。

**修复**: 
- 添加 `resolveSafePath` 使用 `fs.realpath` 解析符号链接
- 添加 `isWithinRootSafe` 作为 Phase 2 增强版本
- 在设计约束中明确 Phase 2 增加 `fs.realpath` 检查

**安全说明**: 当前实现使用 `path.resolve` 是安全的，因为 `path.resolve` 不会解析符号链接，所以符号链接攻击会被阻止。Phase 2 增强使用 `fs.realpath` 提供更安全的保护。

#### TodoList 工具 - 优先级决策注释

**问题**: TodoList 优先级 15 vs Memory 10 没有说明决策原因。

**修复**: 在 `TodoListPlugin` 注释中添加优先级决策说明：
- Skills: 5 (最先执行，注入技能列表)
- Memory: 10 (注入 AGENTS.md 内容)
- TodoList: 15 (注入任务进度)
- Summarization: 20 (最后执行，压缩消息)

**设计意图**: 模型首先看到任务进度，然后看到 AGENTS.md 指令，最后看到技能列表。

#### Compiled/Async 子代理 - subscription 存储和结果注入

**问题**: 
1. `runAsync` 中 `subscription` 是局部变量，没有存储到 `asyncRuns` Map 中
2. `onComplete` 回调没有将结果注入主 Agent 消息历史

**修复**:
1. 创建 `AsyncSubagentHandle` 并存储到 `asyncRuns` Map 中
2. 添加 `injectResultToMainAgent` 方法，将子代理结果作为 tool 消息注入主 Agent
3. 在 `onComplete` 回调中调用 `injectResultToMainAgent`
4. 在 `cancel` 方法中调用 `subscription.unsubscribe()`

**结果注入设计**:
- 将子代理的最终输出作为 tool 消息注入主 Agent
- 使用 `role: 'tool'` 格式，符合 OpenAI/Anthropic 的工具调用消息格式
- 通过 `emitSubagentResult` 方法触发状态更新
