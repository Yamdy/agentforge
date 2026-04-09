# Agent Framework Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个通用Agent开发框架，支持工具调用和多轮对话

**Architecture:** 框架提供核心抽象（Tool、LLMAdapter、HistoryManager），用户组合这些组件构建自己的Agent。CLI作为使用示例。

**Tech Stack:** TypeScript/Node.js

---

## File Structure

```
src/
  ├── types.ts           # 接口定义
  ├── history.ts         # HistoryManager 实现
  ├── registry.ts        # ToolRegistry 实现
  ├── agent.ts           # Agent 默认实现
  ├── adapters/
  │   └── openai.ts      # OpenAI 适配器
  └── cli.ts             # CLI 入口
tests/
  ├── history.test.ts
  ├── registry.test.ts
  └── agent.test.ts
```

---

## Chunk 1: 项目初始化

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "primo-agent",
  "version": "0.1.0",
  "main": "dist/cli.js",
  "bin": {
    "primo-agent": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/cli.js",
    "dev": "ts-node src/cli.ts",
    "test": "jest"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "inquirer": "^9.2.0"
  },
  "devDependencies": {
    "@types/inquirer": "^9.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 创建 jest.config.js**

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
};
```

- [ ] **Step 4: 安装依赖**

Run: `pnpm install`

---

## Chunk 2: 类型定义

**Files:**

- Create: `src/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls?: ToolCall[];
}

export interface LLMAdapter {
  chat(messages: Message[]): Promise<LLMResponse>;
}

export interface HistoryManager {
  add(role: 'user' | 'assistant', content: string): void;
  getMessages(): Message[];
  clear(): void;
}
```

- [ ] **Step 2: 提交**

```bash
git init && git add . && git commit -m "chore: initial project setup and types"
```

---

## Chunk 3: HistoryManager

**Files:**

- Create: `src/history.ts`
- Create: `tests/history.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { InMemoryHistory } from '../src/history';

describe('InMemoryHistory', () => {
  let history: InMemoryHistory;

  beforeEach(() => {
    history = new InMemoryHistory();
  });

  test('should add messages and retrieve them', () => {
    history.add('user', 'Hello');
    history.add('assistant', 'Hi there');

    const messages = history.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  test('should clear history', () => {
    history.add('user', 'Hello');
    history.clear();

    expect(history.getMessages()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL - InMemoryHistory not found

- [ ] **Step 3: 实现 HistoryManager**

```typescript
import { Message, HistoryManager } from './types';

export class InMemoryHistory implements HistoryManager {
  private messages: Message[] = [];

  add(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add . && git commit -m "feat: add InMemoryHistory implementation"
```

---

## Chunk 4: ToolRegistry

**Files:**

- Create: `src/registry.ts`
- Create: `tests/registry.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { ToolRegistry } from '../src/registry';
import { Tool } from '../src/types';

const mockTool: Tool = {
  name: 'calculator',
  description: 'Calculate math expression',
  execute: async (args) => String(eval(args.expr as string)),
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  test('should register and retrieve tools', () => {
    registry.register(mockTool);

    const tool = registry.get('calculator');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('calculator');
  });

  test('should return undefined for non-existent tool', () => {
    const tool = registry.get('unknown');
    expect(tool).toBeUndefined();
  });

  test('should list all tools', () => {
    registry.register(mockTool);

    const tools = registry.list();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('calculator');
  });

  test('should execute tool', async () => {
    registry.register(mockTool);

    const result = await registry.execute('calculator', { expr: '2+2' });
    expect(result).toBe('4');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: 实现 ToolRegistry**

```typescript
import { Tool, ToolCall } from './types';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(args);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add . && git commit -m "feat: add ToolRegistry implementation"
```

---

## Chunk 5: Agent

**Files:**

- Create: `src/agent.ts`
- Create: `tests/agent.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { Agent } from '../src/agent';
import { Tool, LLMAdapter, LLMResponse, InMemoryHistory, ToolRegistry } from '../src/types';

const mockTool: Tool = {
  name: 'calculator',
  description: 'Calculate math expression',
  execute: async (args) => String(eval(args.expr as string)),
};

const createMockAdapter = (responses: LLMResponse[]) => {
  let callCount = 0;
  const adapter: LLMAdapter = {
    chat: async () => responses[callCount++] || { content: 'done' },
  };
  return adapter;
};

describe('Agent', () => {
  test('should return text response when no tool calls', async () => {
    const adapter = createMockAdapter([{ content: 'Hello!' }]);
    const history = new InMemoryHistory();
    const registry = new ToolRegistry();

    const agent = new Agent({ adapter, history, registry });
    const response = await agent.run('Hi');

    expect(response).toBe('Hello!');
  });

  test('should execute tool and continue', async () => {
    const adapter = createMockAdapter([
      {
        content: null,
        toolCalls: [{ name: 'calculator', arguments: { expr: '2+2' } }],
      },
      { content: 'The result is 4' },
    ]);
    const history = new InMemoryHistory();
    const registry = new ToolRegistry();
    registry.register(mockTool);

    const agent = new Agent({ adapter, history, registry });
    const response = await agent.run('Calculate 2+2');

    expect(response).toBe('The result is 4');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: 实现 Agent**

```typescript
import { LLMAdapter, HistoryManager, ToolRegistry, Message, ToolCall } from './types';

interface AgentConfig {
  adapter: LLMAdapter;
  history: HistoryManager;
  registry: ToolRegistry;
}

export class Agent {
  private adapter: LLMAdapter;
  private history: HistoryManager;
  private registry: ToolRegistry;

  constructor(config: AgentConfig) {
    this.adapter = config.adapter;
    this.history = config.history;
    this.registry = config.registry;
  }

  async run(userInput: string): Promise<string> {
    this.history.add('user', userInput);

    while (true) {
      const messages = this.history.getMessages();
      const response = await this.adapter.chat(messages);

      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          const result = await this.registry.execute(toolCall.name, toolCall.arguments);
          this.history.add('assistant', `tool:${toolCall.name} -> ${result}`);
        }
      } else if (response.content) {
        this.history.add('assistant', response.content);
        return response.content;
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add . && git commit -m "feat: add Agent implementation"
```

---

## Chunk 6: OpenAI Adapter

**Files:**

- Create: `src/adapters/openai.ts`

- [ ] **Step 1: 实现 OpenAI Adapter**

```typescript
import { LLMAdapter, Message, LLMResponse, Tool } from '../types';

interface OpenAIConfig {
  apiKey: string;
  model?: string;
}

export class OpenAIAdapter implements LLMAdapter {
  private apiKey: string;
  private model: string;
  private tools: Tool[] = [];

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4';
  }

  setTools(tools: Tool[]): void {
    this.tools = tools;
  }

  async chat(messages: Message[]): Promise<LLMResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools:
          this.tools.length > 0
            ? this.tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                  },
                },
              }))
            : undefined,
      }),
    });

    const data = await response.json();
    const message = data.choices[0]?.message;

    if (message?.tool_calls) {
      return {
        content: null,
        toolCalls: message.tool_calls.map((tc: any) => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
      };
    }

    return { content: message?.content || '' };
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add . && git commit -m "feat: add OpenAI adapter"
```

---

## Chunk 7: CLI

**Files:**

- Create: `src/cli.ts`
- Create: `.env.example`

- [ ] **Step 1: 创建 CLI**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import { Agent } from './agent';
import { InMemoryHistory } from './history';
import { ToolRegistry } from './registry';
import { OpenAIAdapter } from './adapters/openai';

const program = new Command();

program.name('primo-agent').description('Generic Agent Development Framework').version('0.1.0');

program
  .command('run')
  .option('-p, --prompt <text>', 'Single prompt mode')
  .action(async (options) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Error: OPENAI_API_KEY not set');
      process.exit(1);
    }

    const adapter = new OpenAIAdapter({ apiKey });
    const history = new InMemoryHistory();
    const registry = new ToolRegistry();
    const agent = new Agent({ adapter, history, registry });

    if (options.prompt) {
      const response = await agent.run(options.prompt);
      console.log(response);
    } else {
      console.log('Interactive mode (Ctrl+C to exit)');
      while (true) {
        const { input } = await inquirer.prompt([{ type: 'input', name: 'input', message: '>' }]);
        const response = await agent.run(input);
        console.log(response);
        console.log();
      }
    }
  });

program.parse();
```

- [ ] **Step 2: 创建 .env.example**

```
OPENAI_API_KEY=your-api-key-here
```

- [ ] **Step 3: 构建并测试**

Run: `pnpm build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add . && git commit -m "feat: add CLI interface"
```

---

## Summary

| Chunk | 内容           | 测试     |
| ----- | -------------- | -------- |
| 1     | 项目初始化     | 无       |
| 2     | 类型定义       | 无       |
| 3     | HistoryManager | ✅       |
| 4     | ToolRegistry   | ✅       |
| 5     | Agent          | ✅       |
| 6     | OpenAI Adapter | 无       |
| 7     | CLI            | 手动测试 |

**运行测试:** `pnpm test`
**启动CLI:** `pnpm dev`
