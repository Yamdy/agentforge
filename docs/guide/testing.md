# 测试

学习如何为 AgentForge 应用编写测试。

## 测试工具

AgentForge 推荐使用 Vitest 进行测试：

```bash
pnpm add -D vitest @vitest/coverage-v8
```

## 测试配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

## 测试 Agent

### 基本 Agent 测试

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createAgent } from 'agentforge';

describe('Agent', () => {
  let agent;

  beforeEach(() => {
    agent = createAgent({
      agent: {
        name: 'Test Agent',
        model: 'gpt-4o',
      },
    });
  });

  it('should create agent', () => {
    expect(agent).toBeDefined();
    expect(agent.name).toBe('Test Agent');
  });

  it('should respond to messages', async () => {
    const result = await agent.run('Hello');
    expect(result).toBeTruthy();
  });
});
```

### Mock LLM 适配器

```typescript
import { vi } from 'vitest';

describe('Agent with mocked adapter', () => {
  it('should use mocked response', async () => {
    const mockAdapter = {
      name: 'mock',
      chat: vi.fn().mockResolvedValue({
        content: 'Mock response',
        usage: { totalTokens: 10 },
      }),
    };

    const agent = new Agent(mockAdapter, history, registry, {
      name: 'Test Agent',
    });

    const result = await agent.run('Hello');
    expect(result).toBe('Mock response');
    expect(mockAdapter.chat).toHaveBeenCalled();
  });
});
```

## 测试工具

### 工具测试

```typescript
import { describe, it, expect } from 'vitest';
import { myTool } from './tools/my-tool';

describe('myTool', () => {
  it('should execute with valid args', async () => {
    const result = await myTool.execute({ param1: 'test' });
    expect(result).toContain('test');
  });

  it('should handle missing required args', async () => {
    await expect(myTool.execute({})).rejects.toThrow();
  });

  it('should validate parameter types', async () => {
    await expect(myTool.execute({ param1: 123 })).rejects.toThrow();
  });
});
```

### 工具注册测试

```typescript
describe('Tool Registry', () => {
  it('should register tool', () => {
    const registry = new ToolRegistry();
    registry.register(myTool);

    expect(registry.has('my-tool')).toBe(true);
    expect(registry.get('my-tool')).toBe(myTool);
  });

  it('should unregister tool', () => {
    const registry = new ToolRegistry();
    registry.register(myTool);

    registry.unregister('my-tool');

    expect(registry.has('my-tool')).toBe(false);
  });
});
```

## 测试中间件

```typescript
describe('Middleware', () => {
  it('should call beforeToolCall', async () => {
    const middleware = {
      name: 'test',
      beforeToolCall: vi.fn(),
    };

    const agent = createAgent(config);
    agent.use(middleware);

    await agent.run('Use a tool');

    expect(middleware.beforeToolCall).toHaveBeenCalled();
  });

  it('should call afterToolCall', async () => {
    const middleware = {
      name: 'test',
      afterToolCall: vi.fn(),
    };

    const agent = createAgent(config);
    agent.use(middleware);

    await agent.run('Use a tool');

    expect(middleware.afterToolCall).toHaveBeenCalled();
  });
});
```

## 测试配置

```typescript
import { loadConfig } from 'agentforge/config';
import * as fs from 'fs/promises';

describe('Config', () => {
  it('should load valid config', async () => {
    const config = await loadConfig('./test/fixtures/valid.config.md');

    expect(config.agent).toBeDefined();
    expect(config.agent.name).toBe('Test Agent');
  });

  it('should validate config', async () => {
    await expect(loadConfig('./test/fixtures/invalid.config.md')).rejects.toThrow();
  });
});
```

## 集成测试

```typescript
describe('Integration Tests', () => {
  it('should complete full workflow', async () => {
    const agent = createAgent({
      agent: {
        name: 'Integration Test Agent',
        model: 'gpt-4o',
        tools: ['read', 'write'],
      },
    });

    // 创建测试文件
    await fs.writeFile('test.txt', 'Hello, World!');

    // 使用 Agent 读取文件
    const result = await agent.run('Read test.txt');

    expect(result).toContain('Hello, World!');

    // 清理
    await fs.unlink('test.txt');
  });
});
```

## E2E 测试

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';

describe('E2E Tests', () => {
  let server;

  beforeAll(() => {
    // 启动测试服务器
    server = createServer((req, res) => {
      res.end('OK');
    }).listen(3000);
  });

  afterAll(() => {
    server.close();
  });

  it('should handle HTTP requests', async () => {
    const response = await fetch('http://localhost:3000');
    const text = await response.text();

    expect(text).toBe('OK');
  });
});
```

## 测试覆盖率

```bash
# 运行测试并生成覆盖率报告
pnpm test:coverage
```

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
  },
});
```

## 测试最佳实践

### 1. 隔离测试

```typescript
// 每个测试独立运行
describe('Isolated Tests', () => {
  let agent;

  beforeEach(() => {
    agent = createAgent(config);
  });

  afterEach(() => {
    agent = null;
  });

  it('test 1', async () => {
    // 测试逻辑
  });

  it('test 2', async () => {
    // 测试逻辑
  });
});
```

### 2. 使用 Mock

```typescript
import { vi } from 'vitest';

const mockTool = {
  name: 'mock-tool',
  execute: vi.fn().mockResolvedValue('mock result'),
};
```

### 3. 测试异步代码

```typescript
it('should handle async operations', async () => {
  const result = await asyncOperation();
  expect(result).toBeDefined();
});
```

### 4. 测试错误处理

```typescript
it('should handle errors', async () => {
  await expect(agent.run('Invalid input')).rejects.toThrow();
});
```

## 性能测试

```typescript
import { bench } from 'vitest';

bench(
  'Agent execution',
  async () => {
    const agent = createAgent(config);
    await agent.run('Hello');
  },
  { iterations: 100 }
);
```

## 快照测试

```typescript
import { expect } from 'vitest';

it('should match snapshot', async () => {
  const result = await agent.run('Hello');
  expect(result).toMatchSnapshot();
});
```

## 完整测试示例

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAgent, Agent } from 'agentforge';
import { ToolRegistry, InMemoryHistory } from 'agentforge';

describe('Agent Comprehensive Tests', () => {
  let agent;
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = {
      name: 'mock',
      chat: vi.fn().mockResolvedValue({
        content: 'Test response',
        usage: { totalTokens: 10 },
      }),
    };

    const history = new InMemoryHistory();
    const registry = new ToolRegistry();

    agent = new Agent(mockAdapter, history, registry, {
      name: 'Test Agent',
      maxSteps: 5,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should respond to messages', async () => {
    const result = await agent.run('Hello');
    expect(result).toBe('Test response');
    expect(mockAdapter.chat).toHaveBeenCalledTimes(1);
  });

  it('should use tools', async () => {
    registry.register({
      name: 'test-tool',
      description: 'Test tool',
      async execute() {
        return 'Tool result';
      },
    });

    const result = await agent.run('Use test-tool');
    expect(result).toContain('Tool result');
  });

  it('should handle errors', async () => {
    mockAdapter.chat.mockRejectedValue(new Error('API Error'));

    await expect(agent.run('Hello')).rejects.toThrow('API Error');
  });

  it('should respect maxSteps', async () => {
    let callCount = 0;
    mockAdapter.chat.mockImplementation(async () => {
      callCount++;
      if (callCount > 5) {
        throw new Error('Too many calls');
      }
      return { content: 'Response', usage: { totalTokens: 10 } };
    });

    const result = await agent.run('Complex task');
    expect(callCount).toBeLessThanOrEqual(5);
  });
});
```

## 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试文件
pnpm test agent.test.ts

# 监听模式
pnpm test:watch

# 覆盖率报告
pnpm test:coverage

# UI 模式
pnpm test:ui
```

## 下一步

- [部署](./deployment.md) - 了解部署方案
- [最佳实践](./best-practices.md) - 查看最佳实践
