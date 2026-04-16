# 工具 API

工具系统 API 参考。

## Tool 接口

```typescript
interface Tool {
  name: string;              // 工具名称
  description: string;       // 工具描述
  parameters?: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
  permissions?: string[];    // 需要的权限
  async execute(args: Record<string, unknown>): Promise<unknown>;
}
```

## ParameterSchema

```typescript
interface ParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  format?: string;
}
```

## ToolRegistry

工具注册中心类。

### 构造函数

```typescript
new ToolRegistry();
```

### 方法

#### register

```typescript
register(tools: Tool | Tool[]): void
```

注册一个或多个工具。

**示例：**

```typescript
const registry = new ToolRegistry();

// 注册单个工具
registry.register(myTool);

// 批量注册
registry.register([tool1, tool2, tool3]);
```

#### unregister

```typescript
unregister(name: string): void
```

注销工具。

**示例：**

```typescript
registry.unregister('my-tool');
```

#### get

```typescript
get(name: string): Tool | undefined
```

获取指定名称的工具。

**示例：**

```typescript
const tool = registry.get('my-tool');
if (tool) {
  console.log('Tool found:', tool.name);
}
```

#### has

```typescript
has(name: string): boolean
```

检查工具是否存在。

**示例：**

```typescript
if (registry.has('my-tool')) {
  console.log('Tool exists');
}
```

#### getAll

```typescript
getAll(): Tool[]
```

获取所有已注册的工具。

**示例：**

```typescript
const tools = registry.getAll();
console.log('Total tools:', tools.length);
```

#### getToolNames

```typescript
getToolNames(): string[]
```

获取所有工具名称。

**示例：**

```typescript
const names = registry.getToolNames();
console.log('Tool names:', names);
```

## 内置工具

### read

```typescript
{
  name: 'read';
  description: '读取文件内容';
  parameters: {
    type: 'object';
    properties: {
      filePath: { type: 'string', description: '文件路径' };
    };
    required: ['filePath'];
  };
}
```

### write

```typescript
{
  name: 'write';
  description: '写入文件内容';
  parameters: {
    type: 'object';
    properties: {
      filePath: { type: 'string', description: '文件路径' };
      content: { type: 'string', description: '文件内容' };
    };
    required: ['filePath', 'content'];
  };
}
```

### ls

```typescript
{
  name: 'ls';
  description: '列出目录内容';
  parameters: {
    type: 'object';
    properties: {
      path: { type: 'string', description: '目录路径' };
    };
    required: ['path'];
  };
}
```

### bash

```typescript
{
  name: 'bash';
  description: '执行 shell 命令';
  parameters: {
    type: 'object';
    properties: {
      command: { type: 'string', description: '要执行的命令' };
    };
    required: ['command'];
  };
}
```

## allBuiltinTools

```typescript
import { allBuiltinTools } from 'agentforge/tools';

const tools = allBuiltinTools;
// 返回所有内置工具的数组
```

## 创建自定义工具

### 基本示例

```typescript
import { Tool } from 'agentforge/types';

export const myTool: Tool = {
  name: 'my-tool',
  description: '我的自定义工具',
  parameters: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: '参数1',
      },
    },
    required: ['param1'],
  },
  async execute(args) {
    return `执行结果: ${args.param1}`;
  },
};
```

### HTTP 请求工具

```typescript
export const httpTool: Tool = {
  name: 'http_request',
  description: '发送 HTTP 请求',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE'],
        default: 'GET',
      },
    },
    required: ['url'],
  },
  async execute(args) {
    const response = await fetch(args.url, {
      method: args.method,
    });
    return await response.text();
  },
};
```

### 带权限的工具

```typescript
export const adminTool: Tool = {
  name: 'admin_operation',
  description: '管理员工具',
  permissions: ['admin'],
  async execute(args) {
    // 执行管理员操作
    return { result: 'success' };
  },
};
```

## 工具执行

### 直接执行

```typescript
const result = await tool.execute({ param1: 'value' });
console.log(result);
```

### 通过 Agent 执行

```typescript
const agent = createAgent(config);
agent.registry.register([myTool]);

const result = await agent.run('使用 my-tool 工具');
```

## 工具验证

参数会自动验证：

```typescript
export const validatedTool: Tool = {
  name: 'validated_tool',
  parameters: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        format: 'email',
      },
      age: {
        type: 'number',
        minimum: 0,
        maximum: 150,
      },
    },
    required: ['email', 'age'],
  },
  async execute(args) {
    // 参数已验证
    return { email: args.email, age: args.age };
  },
};
```

## 错误处理

```typescript
export const errorHandlingTool: Tool = {
  name: 'error_handling',
  async execute(args) {
    try {
      const result = await someOperation(args);
      return { success: true, data: result };
    } catch (error) {
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
import { Tool, ToolRegistry } from 'agentforge';

// 创建工具
export const calculator: Tool = {
  name: 'calculator',
  description: '执行数学计算',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式',
      },
    },
    required: ['expression'],
  },
  async execute(args) {
    try {
      const result = eval(args.expression);
      return { result, success: true };
    } catch (error) {
      return {
        result: null,
        success: false,
        error: error.message,
      };
    }
  },
};

// 注册工具
const registry = new ToolRegistry();
registry.register([calculator]);

// 使用工具
const tool = registry.get('calculator');
const result = await tool.execute({ expression: '2 + 2' });
console.log(result); // { result: 4, success: true }

// 在 Agent 中使用
const agent = createAgent(config);
agent.registry.register([calculator]);

const agentResult = await agent.run('计算 10 * 20');
console.log(agentResult);
```

## 相关文档

- [核心 API](./core.md) - 核心 API
- [配置 API](./config.md) - 配置系统 API
- [存储 API](./storage.md) - 存储系统 API
