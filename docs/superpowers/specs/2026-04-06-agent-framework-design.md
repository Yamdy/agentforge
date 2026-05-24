# Agent Framework Design

## Overview

通用推理Agent开发框架，让用户通过组合工具和适配器来构建自己的agent。

## Tech Stack

- **Language:** TypeScript (ESM)
- **Runtime:** Node.js
- **Package Manager:** pnpm
- **Testing:** Vitest
- **Validation:** Zod (runtime type checking)
- **LLM SDK:** @ai-sdk (统一的多模型适配)
- **Build:** tsc

## Core Abstractions

### 1. Tool Interface

```typescript
export const ToolSchema = z.object({
  name: z.string().min(1, 'Tool name is required'),
  description: z.string(),
  parameters: ToolParametersSchema.optional(),
  execute: z.custom<(args: Record<string, unknown>) => Promise<string>>(
    (fn) => typeof fn === 'function',
    { message: 'Tool must have an execute function' }
  ),
});
export type Tool = z.infer<typeof ToolSchema>;
```

### 2. LLM Adapter Interface

```typescript
export type LLMAdapter = {
  chat(messages: Message[]): Promise<LLMResponse>;
  chatStream(messages: Message[]): AsyncGenerator<StreamEvent, void, unknown>;
};
```

### 3. Stream Event Types

```typescript
export type StreamEvent = 
  | { type: 'text'; content: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; arguments: string }
  | { type: 'tool_call_end'; id: string; result?: string }
  | { type: 'done'; response: LLMResponse };
```

### 4. History Manager Interface

```typescript
export type HistoryManager = {
  add(role: 'user' | 'assistant', content: string): void;
  addToolResult(toolCallId: string, toolName: string, result: string): void;
  getMessages(): Message[];
  clear(): void;
};
```

## Agent Execution Loop

Agent 支持自动工具执行循环，参考 opencode 实现：

```typescript
const agent = new Agent(adapter, history, registry);

for await (const event of agent.runStream(input, {
  onStep: (step) => console.log(`Step ${step}`),
  onText: (text) => process.stdout.write(text),
  onToolCallStart: (id, name) => console.log(`[Calling ${name}...]`),
  onToolCallEnd: (id, result) => console.log(` => ${result}`),
})) {
  // Stream events
}
```

关键特性：
- **maxSteps**: 最大迭代次数，默认为 `Infinity`（无限制）
- **自动工具执行**: 通过 @ai-sdk 的 execute 函数自动执行
- **工具结果反馈**: 执行结果自动添加到消息历史

## Validation

使用 Zod 实现运行时类型验证：

```typescript
export function validateTool(tool: unknown): Tool {
  return ToolSchema.parse(tool);
}

export function validateMessage(message: unknown): Message {
  return MessageSchema.parse(message);
}

export function validateLLMResponse(response: unknown): LLMResponse {
  return LLMResponseSchema.parse(response);
}
```

## Core Components

| Component | File | Description |
|-----------|------|-------------|
| `ToolRegistry` | `src/registry.ts` | 工具注册与管理，带Zod验证 |
| `InMemoryHistory` | `src/history.ts` | 内存消息历史管理，支持工具结果 |
| `Agent` | `src/agent.ts` | Agent实现，支持流式输出和自动工具执行循环 |
| `AIAdapter` | `src/adapters/ai.ts` | @ai-sdk 统一适配器，支持所有OpenAI兼容API |

## LLM Providers

通过 @ai-sdk 支持多模型提供商：

```bash
pnpm add @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google-generative-ai
```

配置环境变量：
```bash
export OPENAI_API_KEY=sk-xxx
export ANTHROPIC_API_KEY=sk-ant-xxx
```

## Data Flow

### Agent Execution Loop

```
User Input → Agent.run()
                 ↓
         [History + Registry] → LLM Adapter.chatStream()
                                      ↓
                         Loop until finishReason='stop' or 'length':
                         ├── text → add to history
                         ├── tool_call → execute via adapter
                         ├── tool_call_end → add result to history
                         └── done (finishReason !== 'tool-calls') → Return
```

### Streaming (Agent.runStream)

```
User Input → Agent.runStream(handler?)
                  ↓
         [History + Registry] → LLM Adapter.chatStream()
                                      ↓
                            Yield Stream Events:
                            ├── text → handler.onText()
                            ├── tool_call_start → handler.onToolCallStart()
                            ├── tool_call_delta → handler.onToolCallDelta()
                            ├── tool_call_end → handler.onToolCallEnd(result?)
                            ├── step → handler.onStep(step)
                            └── done → Return
```

## File Structure

```
primo-agent/
├── src/
│   ├── types.ts           # Zod schemas + 类型定义 + 验证函数
│   ├── agent.ts           # Agent 核心实现（支持流式 + 自动工具执行）
│   ├── history.ts         # InMemoryHistory 实现（支持工具结果）
│   ├── registry.ts        # ToolRegistry 实现
│   ├── adapters/
│   │   └── ai.ts          # @ai-sdk 统一适配器
│   ├── tools/
│   │   └── index.ts       # 内置工具 (calculator, web_search)
│   ├── examples/
│   │   └── demo.ts        # Agent 示例（流式输出）
│   └── cli.ts             # CLI 入口
├── tests/
│   ├── history.test.ts
│   ├── registry.test.ts
│   └── agent.test.ts
├── docs/superpowers/
│   ├── specs/             # 设计文档
│   └── plans/             # 实现计划
├── package.json           # ESM, pnpm, @ai-sdk
├── tsconfig.json          # ESNext, bundler
└── vitest.config.mts
```

## Usage

### Development

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 运行测试
pnpm test

# 构建
pnpm build
```

### Demo

```bash
pnpm demo
```

### Programmatic

```typescript
import { Agent } from 'primo-agent';
import { InMemoryHistory } from 'primo-agent/history';
import { ToolRegistry } from 'primo-agent/registry';
import { AIAdapter } from 'primo-agent/adapters/ai';
import { calculatorTool } from 'primo-agent/tools';

const adapter = new AIAdapter({
  model: 'gpt-4-turbo',
  apiKey: process.env.OPENAI_API_KEY,
  useTools: true,
});

const registry = new ToolRegistry();
registry.register(calculatorTool);
adapter.setTools(registry.list());

const history = new InMemoryHistory();
const agent = new Agent(adapter, history, registry);

const response = await agent.run('Calculate 123 * 456');
console.log(response);
```

### Streaming with Handlers

```typescript
for await (const event of agent.runStream(input, {
  onStep: (step) => console.log(`[Step ${step}]`),
  onText: (text) => process.stdout.write(text),
  onToolCallStart: (id, name) => console.log(`\n[Calling ${name}...]`),
  onToolCallDelta: (id, args) => process.stdout.write(args),
  onToolCallEnd: (id, result) => console.log(` => ${result}`),
})) {
  // Stream complete
}
```

### CLI

```bash
# 单次 prompt
primo-agent run -p "Calculate 123 * 456"

# 交互模式
primo-agent run

# 指定 maxSteps
primo-agent run -s 5
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API密钥 | - |
| `OPENAI_BASE_URL` | OpenAI API地址 | - |
| `MODEL` | 模型名称 | `gpt-4-turbo` |
| `DOUBAO_API_KEY` | 豆包API密钥 | - |
| `DOUBAO_BASE_URL` | 豆包API地址 | - |