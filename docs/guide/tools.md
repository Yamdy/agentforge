# 工具系统

AgentForge 提供了强大的工具系统，让 Agent 能够执行各种操作。

## 内置工具

AgentForge 内置了以下常用工具：

### read - 读取文件

```typescript
{
  name: 'read',
  description: '读取文件内容',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '文件路径' },
    },
    required: ['filePath'],
  },
}
```

### write - 写入文件

```typescript
{
  name: 'write',
  description: '写入文件内容',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['filePath', 'content'],
  },
}
```

### ls - 列出目录

```typescript
{
  name: 'ls',
  description: '列出目录内容',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径' },
    },
    required: ['path'],
  },
}
```

### bash - 执行命令

```typescript
{
  name: 'bash',
  description: '执行 shell 命令',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
    },
    required: ['command'],
  },
}
```

## 使用内置工具

内置工具会自动注册到 Agent 中：

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  agent: {
    name: 'My Agent',
    model: 'gpt-4o',
    tools: ['read', 'write', 'ls', 'bash'], // 启用的工具
  },
});

// Agent 可以自动使用这些工具
const result = await agent.run('读取 package.json 文件');
```

## 创建自定义工具

### 基本结构

```typescript
import { Tool } from 'agentforge/types';

export const MyTool: Tool = {
  name: 'my-tool',
  description: '工具的描述',
  parameters: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: '参数1的描述',
      },
      param2: {
        type: 'number',
        description: '参数2的描述',
      },
    },
    required: ['param1'],
  },
  async execute(args) {
    // 执行工具逻辑
    return `执行结果: ${args.param1} - ${args.param2}`;
  },
};
```

### 注册自定义工具

```typescript
import { MyTool } from './tools/my-tool';

const agent = createAgent(config);
agent.registry.register([MyTool]);
```

### 工具示例

#### HTTP 请求工具

```typescript
export const httpGet: Tool = {
  name: 'http_get',
  description: '发送 HTTP GET 请求',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求的 URL' },
      headers: {
        type: 'object',
        description: '请求头',
      },
    },
    required: ['url'],
  },
  async execute(args) {
    const response = await fetch(args.url, {
      method: 'GET',
      headers: args.headers,
    });
    return await response.text();
  },
};
```

#### 数据库查询工具

```typescript
export const dbQuery: Tool = {
  name: 'db_query',
  description: '执行数据库查询',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'SQL 查询语句' },
      params: {
        type: 'array',
        description: '查询参数',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    // 执行数据库查询
    const result = await db.execute(args.query, args.params);
    return JSON.stringify(result);
  },
};
```

#### 文件处理工具

```typescript
export const processFile: Tool = {
  name: 'process_file',
  description: '处理文件内容',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '文件路径' },
      operation: {
        type: 'string',
        enum: ['count', 'analyze', 'transform'],
        description: '操作类型',
      },
    },
    required: ['filePath', 'operation'],
  },
  async execute(args) {
    const content = await fs.readFile(args.filePath, 'utf-8');

    switch (args.operation) {
      case 'count':
        return { lines: content.split('\n').length };
      case 'analyze':
        return { length: content.length };
      case 'transform':
        return content.toUpperCase();
    }
  },
};
```

## 工具注册中心

### 注册工具

```typescript
import { ToolRegistry } from 'agentforge/registry';

const registry = new ToolRegistry();

// 注册单个工具
registry.register(MyTool);

// 批量注册
registry.register([Tool1, Tool2, Tool3]);
```

### 查询工具

```typescript
// 获取所有工具
const allTools = registry.getAll();

// 获取特定工具
const tool = registry.get('my-tool');

// 检查工具是否存在
const exists = registry.has('my-tool');
```

### 注销工具

```typescript
registry.unregister('my-tool');
```

### 工具列表

```typescript
const toolNames = registry.getToolNames();
console.log(toolNames); // ['read', 'write', 'ls', 'bash', 'my-tool']
```

## 工具权限

可以为工具设置权限要求：

```typescript
export const sensitiveTool: Tool = {
  name: 'sensitive_tool',
  description: '敏感操作工具',
  permissions: ['admin'], // 需要管理员权限
  async execute(args) {
    // 执行敏感操作
  },
};
```

## 工具验证

工具参数会自动验证：

```typescript
export const validatedTool: Tool = {
  name: 'validated_tool',
  parameters: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        format: 'email', // 邮箱格式验证
      },
      age: {
        type: 'number',
        minimum: 0, // 最小值
        maximum: 150, // 最大值
      },
    },
    required: ['email', 'age'],
  },
  async execute(args) {
    // 参数已验证
    return `Email: ${args.email}, Age: ${args.age}`;
  },
};
```

## 工具错误处理

```typescript
export const errorHandlingTool: Tool = {
  name: 'error_handling_tool',
  async execute(args) {
    try {
      // 执行操作
      return result;
    } catch (error) {
      // 返回错误信息
      return {
        success: false,
        error: error.message,
      };
    }
  },
};
```

## 完整示例

```typescript
import { Tool } from 'agentforge/types';
import { createAgent } from 'agentforge';

// 创建自定义工具
export const calculator: Tool = {
  name: 'calculator',
  description: '执行数学计算',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，如 "2 + 2"',
      },
    },
    required: ['expression'],
  },
  async execute(args) {
    try {
      const result = eval(args.expression);
      return { result, success: true };
    } catch (error) {
      return { result: null, success: false, error: error.message };
    }
  },
};

// 创建 Agent 并注册工具
const agent = createAgent({
  agent: {
    name: 'Math Assistant',
    model: 'gpt-4o',
  },
});

agent.registry.register([calculator]);

// 使用工具
const result = await agent.run('计算 15 * 23');
```

## 下一步

- [中间件](./middleware.md) - 使用中间件处理工具调用
- [权限管理](./permissions.md) - 控制工具访问权限
