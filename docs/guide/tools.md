# 工具系统

AgentForge 的工具系统允许 Agent 与外部系统交互。工具使用 Zod Schema 定义参数，自动生成 Function Definition。

## 工具定义

```typescript
import { z } from 'zod';
import type { ToolDefinition } from 'agentforge';

// 定义工具参数 Schema
const SearchParamsSchema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().optional().default(10).describe('Max results'),
});

// 定义工具
const searchTool: ToolDefinition<typeof SearchParamsSchema> = {
  name: 'search',
  description: 'Search for information on the web',
  parameters: SearchParamsSchema,
  
  // 执行函数
  execute: async (args) => {
    const { query, limit = 10 } = args as z.infer<typeof SearchParamsSchema>;
    // 执行搜索逻辑
    return `Found ${limit} results for "${query}"`;
  },
  
  // 安全审批字段（可选）
  requiresApproval: false,
  riskLevel: 'low',
};
```

## 工具注册

### 通过 AgentConfig 注册

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  tools: [searchTool], // 直接传入工具定义
});
```

### 通过 ToolRegistry 注册

```typescript
import { SimpleToolRegistry } from 'agentforge';

const registry = new SimpleToolRegistry();

// 注册单个工具
registry.register(searchTool);

// 批量注册
registry.registerAll([searchTool, readTool, writeTool]);

// 检查工具是否存在
registry.has('search'); // true

// 获取工具定义
const tool = registry.get('search');

// 获取 LLM Function Definition
const funcDef = registry.getFunctionDef('search');

// 获取所有 Function Definitions（传给 LLM）
const allDefs = registry.getFunctionDefs();
```

## 安全审批

对于危险操作，可以启用人工审批：

```typescript
const deleteFileTool: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file from the filesystem',
  parameters: z.object({
    path: z.string().describe('File path to delete'),
  }),
  
  execute: async (args) => {
    // 删除文件逻辑
    return `File deleted: ${args.path}`;
  },
  
  // 启用审批
  requiresApproval: true,
  approvalMessage: 'Are you sure you want to delete this file?',
  
  // 风险等级
  riskLevel: 'high',
  
  // 沙箱要求
  sandboxRequired: true,
};
```

### 风险等级

| 等级 | 说明 | 示例 |
|------|------|------|
| `low` | 只读操作，无副作用 | `read_file`, `search` |
| `medium` | 有限副作用，可逆 | `write_file`, `send_email` |
| `high` | 显著副作用，可能改变状态 | `delete_file`, `modify_config` |
| `critical` | 不可逆操作，破坏性动作 | `format_disk`, `drop_database` |

## 工具执行上下文

工具执行时接收上下文参数：

```typescript
import type { ToolContext } from 'agentforge';

const tool: ToolDefinition = {
  name: 'example',
  description: 'Example tool',
  parameters: z.object({}),
  
  execute: async (args, ctx?: ToolContext) => {
    if (ctx) {
      console.log('Tool Call ID:', ctx.toolCallId);
      console.log('Session ID:', ctx.parentSessionId);
      console.log('Timeout:', ctx.timeout);
      
      // 使用 AbortSignal 处理取消
      if (ctx.signal?.aborted) {
        throw new Error('Tool execution cancelled');
      }
    }
    
    return 'Done';
  },
};
```

## 工具事件流

工具执行产生一系列事件：

```
tool.call → tool.execute → tool.result
                      ↓
                  tool.error (如果失败)
```

监听工具事件：

```typescript
agent.run$('Search for AI news').pipe(
  filter(e => e.type.startsWith('tool.'))
).subscribe(event => {
  switch (event.type) {
    case 'tool.call':
      console.log(`Calling: ${event.toolName}`, event.args);
      break;
    case 'tool.result':
      console.log(`Result: ${event.result}`, event.isError ? '❌' : '✅');
      break;
    case 'tool.error':
      console.error(`Error: ${event.error.message}`);
      break;
  }
});
```

## 批量工具调用

AgentForge 支持并行工具执行：

```typescript
agent.run$('Multi-task').pipe(
  filter(e => e.type === 'tool.batch.start')
).subscribe(event => {
  console.log(`Batch started: ${event.totalCalls} calls`);
});

agent.run$('Multi-task').pipe(
  filter(e => e.type === 'tool.batch.complete')
).subscribe(event => {
  console.log(`Batch done: ${event.successCount} success, ${event.errorCount} failed`);
});
```

## 内置工具示例

```typescript
// 文件读取工具
const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read contents of a file',
  parameters: z.object({
    path: z.string().describe('File path to read'),
  }),
  execute: async (args) => {
    const { readFileSync } = await import('fs');
    return readFileSync(args.path, 'utf-8');
  },
  riskLevel: 'low',
};

// Shell 执行工具
const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Execute shell commands',
  parameters: z.object({
    command: z.string().describe('Command to execute'),
  }),
  execute: async (args) => {
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
      exec(args.command, (error, stdout, stderr) => {
        if (error) resolve(`Error: ${error.message}`);
        else resolve(stdout || stderr);
      });
    });
  },
  requiresApproval: true,
  riskLevel: 'high',
  sandboxRequired: true,
};
```

## 相关 API

- [ToolDefinition API](/api/tool-definition) - 工具定义完整参考
- [LLMAdapter API](/api/llm-adapter) - LLM 适配器
- [事件系统](/guide/events) - 工具事件类型