# 自定义工具

学习如何创建和注册自定义工具来扩展 Agent 的功能。

## 工具接口

```typescript
interface Tool {
  name: string;              // 工具名称
  description: string;       // 工具描述
  parameters?: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: any;
      minimum?: number;
      maximum?: number;
    }>;
    required?: string[];
  };
  permissions?: string[];    // 需要的权限
  async execute(args: any): Promise<any>;
}
```

## 创建工具

### 基本工具

```typescript
import { Tool } from 'agentforge/types';

export const echoTool: Tool = {
  name: 'echo',
  description: '回显输入的文本',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '要回显的文本',
      },
    },
    required: ['text'],
  },
  async execute(args) {
    return `Echo: ${args.text}`;
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
      headers: {
        type: 'object',
        description: '请求头',
      },
      body: {
        type: 'string',
        description: '请求体',
      },
    },
    required: ['url'],
  },
  async execute(args) {
    const response = await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
    });
    return {
      status: response.status,
      statusText: response.statusText,
      data: await response.text(),
    };
  },
};
```

### 文件处理工具

```typescript
import * as fs from 'fs/promises';

export const fileStatsTool: Tool = {
  name: 'file_stats',
  description: '获取文件统计信息',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '文件路径',
      },
    },
    required: ['filePath'],
  },
  async execute(args) {
    const stats = await fs.stat(args.filePath);
    const content = await fs.readFile(args.filePath, 'utf-8');

    return {
      size: stats.size,
      lines: content.split('\n').length,
      words: content.split(/\s+/).length,
      characters: content.length,
    };
  },
};
```

### 数据库工具

```typescript
export const queryDatabaseTool: Tool = {
  name: 'query_database',
  description: '查询数据库',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'SQL 查询语句',
      },
      params: {
        type: 'array',
        description: '查询参数',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const result = await db.execute(args.query, args.params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  },
};
```

### API 调用工具

```typescript
export const weatherTool: Tool = {
  name: 'get_weather',
  description: '获取天气信息',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称',
      },
    },
    required: ['city'],
  },
  async execute(args) {
    const response = await fetch(
      `https://api.weather.com/v1/current?city=${encodeURIComponent(args.city)}`
    );
    const data = await response.json();

    return {
      city: data.city,
      temperature: data.temp,
      condition: data.condition,
      humidity: data.humidity,
    };
  },
};
```

## 注册工具

### 单个注册

```typescript
import { echoTool } from './tools/echo';

const agent = createAgent(config);
agent.registry.register(echoTool);
```

### 批量注册

```typescript
import { echoTool, httpTool, weatherTool } from './tools';

const agent = createAgent(config);
agent.registry.register([echoTool, httpTool, weatherTool]);
```

### 从目录注册

```typescript
import * as fs from 'fs';
import * as path from 'path';

const toolsDir = path.join(__dirname, 'tools');
const toolFiles = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.ts'));

const tools = [];
for (const file of toolFiles) {
  const module = await import(path.join(toolsDir, file));
  const toolName = Object.keys(module)[0];
  tools.push(module[toolName]);
}

agent.registry.register(tools);
```

## 工具验证

### 参数验证

```typescript
export const validatedTool: Tool = {
  name: 'validated_tool',
  parameters: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: '邮箱地址',
      },
      age: {
        type: 'number',
        minimum: 0,
        maximum: 150,
        description: '年龄',
      },
    },
    required: ['email', 'age'],
  },
  async execute(args) {
    // 参数已自动验证
    return { email: args.email, age: args.age };
  },
};
```

### 自定义验证

```typescript
export const customValidationTool: Tool = {
  name: 'custom_validation',
  async execute(args) {
    if (!args.url || !args.url.startsWith('https://')) {
      throw new Error('URL 必须以 https:// 开头');
    }

    if (args.timeout && args.timeout < 1000) {
      throw new Error('超时时间不能小于 1000ms');
    }

    // 执行逻辑
    return result;
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
        timestamp: new Date().toISOString(),
      };
    }
  },
};
```

## 异步工具

```typescript
export const asyncTool: Tool = {
  name: 'async_operation',
  async execute(args) {
    // 模拟异步操作
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
  },
};
```

## 工具权限

```typescript
export const adminOnlyTool: Tool = {
  name: 'admin_operation',
  description: '仅管理员可用的工具',
  permissions: ['admin'],
  async execute(args) {
    // 执行管理员操作
    return { result: 'admin operation completed' };
  },
};
```

## 工具组合

```typescript
export const compositeTool: Tool = {
  name: 'composite_tool',
  description: '组合多个操作的工具',
  async execute(args) {
    // 步骤1: 读取文件
    const content = await fs.readFile(args.filePath, 'utf-8');

    // 步骤2: 处理内容
    const processed = content.toUpperCase();

    // 步骤3: 写入新文件
    await fs.writeFile(args.outputPath, processed);

    return {
      success: true,
      input: args.filePath,
      output: args.outputPath,
    };
  },
};
```

## 工具测试

```typescript
import { describe, it, expect } from 'vitest';
import { echoTool } from './echo';

describe('echoTool', () => {
  it('should echo text', async () => {
    const result = await echoTool.execute({ text: 'Hello' });
    expect(result).toBe('Echo: Hello');
  });

  it('should handle empty text', async () => {
    const result = await echoTool.execute({ text: '' });
    expect(result).toBe('Echo: ');
  });
});
```

## 完整示例

```typescript
import { Tool } from 'agentforge/types';
import * as fs from 'fs/promises';

// 创建文件分析工具
export const analyzeFileTool: Tool = {
  name: 'analyze_file',
  description: '分析文件内容并生成报告',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要分析的文件路径',
      },
      options: {
        type: 'object',
        properties: {
          includeLines: { type: 'boolean', default: true },
          includeWords: { type: 'boolean', default: true },
          includeChars: { type: 'boolean', default: true },
        },
      },
    },
    required: ['filePath'],
  },
  async execute(args) {
    const content = await fs.readFile(args.filePath, 'utf-8');
    const lines = content.split('\n');
    const words = content.split(/\s+/).filter((w) => w.length > 0);

    const report = {
      filePath: args.filePath,
      timestamp: new Date().toISOString(),
    };

    if (args.options?.includeLines) {
      report.lines = lines.length;
    }

    if (args.options?.includeWords) {
      report.words = words.length;
    }

    if (args.options?.includeChars) {
      report.characters = content.length;
    }

    return report;
  },
};

// 注册工具
const agent = createAgent(config);
agent.registry.register([analyzeFileTool]);
```

## 最佳实践

1. **清晰的描述**：为工具提供清晰、详细的描述
2. **参数验证**：使用参数验证确保输入正确
3. **错误处理**：妥善处理错误并返回有用的信息
4. **权限控制**：为敏感操作设置权限要求
5. **文档完善**：为工具编写完整的文档和示例
6. **测试覆盖**：编写测试确保工具正常工作

## 下一步

- [自定义适配器](./custom-adapters.md) - 创建自定义适配器
- [插件系统](./plugins.md) - 了解插件系统
