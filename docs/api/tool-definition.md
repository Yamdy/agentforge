# ToolDefinition API

ToolDefinition 定义 Agent 可使用的工具，使用 Zod Schema 确保参数类型安全。

## 类型定义

```typescript
interface ToolDefinition<TSchema = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (args: unknown, ctx?: ToolContext) => Promise<string>;

  // 安全审批字段
  requiresApproval?: boolean;
  approvalMessage?: string;
  sandboxRequired?: boolean;
  riskLevel?: RiskLevel;
}
```

## RiskLevel

```typescript
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
```

| 等级 | 说明 |
|------|------|
| `low` | 只读操作，无副作用 |
| `medium` | 有限副作用，可逆 |
| `high` | 显著副作用，可能改变状态 |
| `critical` | 不可逆操作，破坏性动作 |

## ToolContext

```typescript
interface ToolContext {
  toolCallId: string;
  parentSessionId: string;
  timeout?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}
```

## FunctionDefinition

用于 LLM 的 JSON Schema 格式：

```typescript
interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}
```

## 定义工具

### 基本工具

```typescript
import { z } from 'zod';
import type { ToolDefinition } from 'agentforge';

const searchTool: ToolDefinition = {
  name: 'search',
  description: 'Search for information on the web',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10),
  }),
  execute: async (args) => {
    const { query, limit = 10 } = args as { query: string; limit?: number };
    return `Found ${limit} results for "${query}"`;
  },
};
```

### 带安全审批的工具

```typescript
const deleteFileTool: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file from the filesystem',
  parameters: z.object({
    path: z.string().describe('File path to delete'),
  }),
  execute: async (args) => {
    const { path } = args as { path: string };
    // 执行删除操作
    return `File deleted: ${path}`;
  },
  
  // 启用审批
  requiresApproval: true,
  approvalMessage: 'Are you sure you want to delete this file? This cannot be undone.',
  
  // 风险等级
  riskLevel: 'high',
  
  // 需要沙箱环境
  sandboxRequired: true,
};
```

### 使用执行上下文

```typescript
import type { ToolContext } from 'agentforge';

const longRunningTool: ToolDefinition = {
  name: 'long_process',
  description: 'Execute a long-running process',
  parameters: z.object({ command: z.string() }),
  execute: async (args, ctx?: ToolContext) => {
    if (ctx) {
      // 使用超时
      const timeout = ctx.timeout ?? 30000;
      
      // 检查取消信号
      if (ctx.signal?.aborted) {
        throw new Error('Operation cancelled');
      }
      
      // 记录日志
      console.log(`Tool call: ${ctx.toolCallId}`);
    }
    
    // 执行操作
    return 'Done';
  },
};
```

## ToolRegistry

```typescript
interface ToolRegistry {
  list(): string[];
  has(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  getFunctionDef(name: string): FunctionDefinition | undefined;
  getFunctionDefs(): FunctionDefinition[];
  execute(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<string>;
  register(tool: ToolDefinition): void;
  registerAll(tools: ToolDefinition[]): void;
}
```

### SimpleToolRegistry

```typescript
import { SimpleToolRegistry } from 'agentforge';

const registry = new SimpleToolRegistry();

// 注册工具
registry.register(searchTool);
registry.registerAll([readTool, writeTool]);

// 查询
registry.list();            // ['search', 'read', 'write']
registry.has('search');     // true
registry.get('search');     // ToolDefinition

// 获取 FunctionDefinition
registry.getFunctionDef('search');
registry.getFunctionDefs(); // 用于传给 LLM

// 执行工具
const result = await registry.execute('search', { query: 'test' });
```

## Zod Schema 转换

AgentForge 自动将 Zod Schema 转换为 JSON Schema：

```typescript
import { zodToJsonSchema } from 'agentforge';

const schema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().int().min(1).max(100).optional(),
});

const jsonSchema = zodToJsonSchema(schema);
// {
//   type: 'object',
//   properties: {
//     query: { type: 'string', description: 'Search query' },
//     limit: { type: 'integer', minimum: 1, maximum: 100 }
//   },
//   required: ['query']
// }
```

## 工具事件

工具执行产生以下事件：

| 事件类型 | 说明 |
|---------|------|
| `tool.call` | 工具调用发起 |
| `tool.execute` | 工具执行开始 |
| `tool.result` | 工具执行结果 |
| `tool.error` | 工具执行错误 |
| `tool.result.delta` | 流式结果片段 |
| `tool.batch` | 批量工具调用 |
| `tool.batch.start` | 批量开始 |
| `tool.batch.complete` | 批量完成 |

## 相关 API

- [LLMAdapter](/api/llm-adapter) - LLM 适配器
- [事件系统](/api/events) - 工具事件类型
- [工具系统指南](/guide/tools) - 工具使用说明