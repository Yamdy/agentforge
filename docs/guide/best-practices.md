# 最佳实践

遵循这些最佳实践来构建高质量的 AgentForge 应用。

## 代码质量

### 1. 使用 TypeScript

```typescript
// ✅ 好的做法
interface ToolConfig {
  name: string;
  parameters: Record<string, unknown>;
}

const config: ToolConfig = {
  name: 'my-tool',
  parameters: {},
};

// ❌ 避免
const config: any = {
  name: 'my-tool',
  parameters: {},
};
```

### 2. 避免使用 any

```typescript
// ✅ 好的做法
function processData(data: unknown): string {
  if (typeof data === 'string') {
    return data.toUpperCase();
  }
  throw new Error('Invalid data type');
}

// ❌ 避免
function processData(data: any): string {
  return data.toUpperCase();
}
```

### 3. 类型定义

```typescript
// 定义清晰的类型
interface AgentResponse {
  content: string;
  metadata?: {
    tokens: number;
    model: string;
  };
}

async function runAgent(): Promise<AgentResponse> {
  // 实现
}
```

## 错误处理

### 1. 优雅的错误处理

```typescript
// ✅ 好的做法
async function executeTool(tool: Tool, args: unknown) {
  try {
    const result = await tool.execute(args);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { success: false, error: 'Validation failed' };
    }
    logger.error('Tool execution failed', { error });
    return { success: false, error: 'Execution failed' };
  }
}

// ❌ 避免
async function executeTool(tool: Tool, args: unknown) {
  return tool.execute(args);
}
```

### 2. 自定义错误类型

```typescript
class ToolExecutionError extends Error {
  constructor(
    public toolName: string,
    message: string
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

throw new ToolExecutionError('my-tool', 'Execution failed');
```

## 配置管理

### 1. 环境变量

```typescript
// ✅ 好的做法
const config = {
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.API_BASE_URL || 'https://api.openai.com/v1',
  timeout: parseInt(process.env.TIMEOUT || '30000'),
};

// ❌ 避免
const config = {
  apiKey: 'sk-xxx', // 不要硬编码敏感信息
};
```

### 2. 配置验证

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().default('gpt-4o'),
  maxSteps: z.number().min(1).max(100).default(15),
});

const config = ConfigSchema.parse(rawConfig);
```

## 性能优化

### 1. 缓存

```typescript
const cache = new Map();

async function getCachedData(key: string) {
  if (cache.has(key)) {
    return cache.get(key);
  }

  const data = await fetchData(key);
  cache.set(key, data);
  return data;
}
```

### 2. 并发处理

```typescript
// ✅ 好的做法 - 并发执行
const results = await Promise.all([
  tool1.execute(args1),
  tool2.execute(args2),
  tool3.execute(args3),
]);

// ❌ 避免 - 顺序执行
const result1 = await tool1.execute(args1);
const result2 = await tool2.execute(args2);
const result3 = await tool3.execute(args3);
```

### 3. 流式处理

```typescript
// 使用流式处理大数据
agent
  .runStream('Process large data')
  .pipe(
    bufferTime(1000),
    filter((event) => event.type === 'text')
  )
  .subscribe((events) => {
    // 批量处理
  });
```

## 安全

### 1. 输入验证

```typescript
function validateInput(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }

  if (input.length > 10000) {
    throw new Error('Input too long');
  }

  return input;
}
```

### 2. 权限检查

```typescript
async function checkPermission(userId: string, resource: string) {
  const hasPermission = await permissionSystem.checkPermission(userId, {
    type: 'read',
    resource,
    allowed: true,
  });

  if (!hasPermission) {
    throw new Error('Permission denied');
  }
}
```

### 3. 敏感信息保护

```typescript
// ✅ 好的做法
logger.info('API call', { endpoint: '/api/data' });

// ❌ 避免
logger.info('API call', {
  endpoint: '/api/data',
  apiKey: process.env.API_KEY, // 不要记录敏感信息
});
```

## 测试

### 1. 单元测试

```typescript
describe('Tool', () => {
  it('should execute correctly', async () => {
    const result = await tool.execute({ param: 'test' });
    expect(result).toBeDefined();
  });
});
```

### 2. 集成测试

```typescript
describe('Agent Integration', () => {
  it('should complete workflow', async () => {
    const agent = createAgent(config);
    const result = await agent.run('Complete task');
    expect(result).toContain('success');
  });
});
```

### 3. Mock 外部依赖

```typescript
import { vi } from 'vitest';

const mockAdapter = {
  chat: vi.fn().mockResolvedValue({ content: 'Mock' }),
};
```

## 文档

### 1. 代码注释

```typescript
/**
 * 执行工具调用
 * @param tool - 要执行的工具
 * @param args - 工具参数
 * @returns 工具执行结果
 * @throws {ToolExecutionError} 当工具执行失败时抛出
 */
async function executeTool(tool: Tool, args: unknown) {
  // 实现
}
```

### 2. README

```markdown
# Project Name

## 安装

\`\`\`bash
pnpm install
\`\`\`

## 使用

\`\`\`typescript
import { createAgent } from 'agentforge';

const agent = createAgent(config);
\`\`\`
```

### 3. API 文档

```typescript
/**
 * Agent 配置选项
 */
interface AgentOptions {
  /** Agent 名称 */
  name: string;

  /** 最大执行步数，默认 15 */
  maxSteps?: number;

  /** 温度参数，范围 0-2，默认 0.7 */
  temperature?: number;
}
```

## 监控和日志

### 1. 结构化日志

```typescript
logger.info('Agent started', {
  agentId: agent.id,
  config: { name: agent.name, model: agent.model },
});
```

### 2. 错误追踪

```typescript
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', {
    error: error.message,
    stack: error.stack,
    context: { userId, operationId },
  });
}
```

### 3. 性能监控

```typescript
const start = Date.now();
await operation();
const duration = Date.now() - start;
logger.info('Operation completed', { duration });
```

## 代码组织

### 1. 模块化

```typescript
// tools/index.ts
export * from './read';
export * from './write';
export * from './bash';

// tools/read.ts
export const readTool: Tool = {
  /* ... */
};
```

### 2. 依赖注入

```typescript
class AgentService {
  constructor(
    private adapter: LLMAdapter,
    private storage: Storage,
    private logger: Logger
  ) {}
}
```

### 3. 单一职责

```typescript
// ✅ 好的做法 - 每个函数做一件事
function validateInput(input: unknown): string {
  // 只验证输入
}

function processData(input: string): string {
  // 只处理数据
}

function saveData(data: string): void {
  // 只保存数据
}

// ❌ 避免 - 一个函数做多件事
function processAndSave(input: unknown): void {
  const validated = validateInput(input);
  const processed = processData(validated);
  saveData(processed);
}
```

## 版本控制

### 1. Git 提交信息

```bash
# ✅ 好的做法
git commit -m "feat: add new tool for file processing"
git commit -m "fix: resolve memory leak in agent"
git commit -m "docs: update API documentation"

# ❌ 避免
git commit -m "update code"
git commit -m "fix bugs"
```

### 2. 分支策略

```bash
# 功能分支
git checkout -b feature/new-tool

# 修复分支
git checkout -b fix/memory-leak

# 发布分支
git checkout -b release/v1.0.0
```

## 部署

### 1. 环境分离

```env
# .env.development
NODE_ENV=development
LOG_LEVEL=debug

# .env.production
NODE_ENV=production
LOG_LEVEL=info
```

### 2. 健康检查

```typescript
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});
```

### 3. 优雅关闭

```typescript
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');

  await cleanup();
  await closeConnections();

  process.exit(0);
});
```

## 完整示例

```typescript
/**
 * Agent 服务
 * 提供 Agent 创建和管理功能
 */
export class AgentService {
  private readonly logger: Logger;
  private readonly cache: Map<string, unknown>;

  constructor(
    private config: AgentConfig,
    private adapter: LLMAdapter,
    private storage: Storage
  ) {
    this.logger = new Logger({ name: 'AgentService' });
    this.cache = new Map();
  }

  /**
   * 创建 Agent
   */
  async createAgent(options: AgentOptions): Promise<Agent> {
    try {
      this.logger.info('Creating agent', { options });

      const agent = new Agent(this.adapter, this.storage, options);

      this.logger.info('Agent created successfully', {
        agentId: agent.id,
      });

      return agent;
    } catch (error) {
      this.logger.error('Failed to create agent', { error });
      throw new AgentCreationError('Failed to create agent');
    }
  }

  /**
   * 执行 Agent
   */
  async executeAgent(agent: Agent, message: string): Promise<AgentResponse> {
    try {
      this.logger.info('Executing agent', {
        agentId: agent.id,
        message,
      });

      const cacheKey = `${agent.id}:${message}`;

      // 检查缓存
      if (this.cache.has(cacheKey)) {
        this.logger.info('Cache hit', { cacheKey });
        return this.cache.get(cacheKey) as AgentResponse;
      }

      // 执行 Agent
      const result = await agent.run(message);

      // 缓存结果
      this.cache.set(cacheKey, result);

      this.logger.info('Agent executed successfully', {
        agentId: agent.id,
      });

      return result;
    } catch (error) {
      this.logger.error('Agent execution failed', {
        agentId: agent.id,
        error,
      });
      throw new AgentExecutionError('Agent execution failed');
    }
  }
}
```

## 下一步

- [API 文档](../api/core.md) - 查看 API 文档
- [示例](../examples/basic.md) - 查看完整示例
