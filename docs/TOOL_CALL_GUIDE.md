# 工具调用功能使用指南

## 概述

AgentForge 支持开箱即用的工具调用功能，允许 LLM 在回答用户问题的过程中自动调用你注册的工具，获取信息后再生成最终回答。工具调用完全支持流式和非流式两种模式，并且全链路可观测。

## 快速开始

### 1. 定义工具

首先需要定义你的工具，工具需要实现 `Tool` 接口：

```typescript
import type { Tool } from "@agentforge/core";
import { Effect } from "effect";

// 天气查询工具示例
const weatherTool: Tool<{ city: string; date?: string }> = {
  // 工具名称，唯一标识
  name: "get_weather",
  // 工具描述，告诉 LLM 这个工具的作用
  description: "查询指定城市的天气情况，支持查询未来几天的天气预报",
  // 工具参数的 JSON Schema 定义，LLM 会根据这个 Schema 生成参数
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "要查询天气的城市名称，比如北京、上海、深圳",
      },
      date: {
        type: "string",
        description: "要查询的日期，格式为YYYY-MM-DD，默认是今天",
      },
    },
    required: ["city"],
  },
  // 工具执行函数，返回 Effect
  execute: (params) => Effect.succeed(
    `${params.city}${params.date ? ` ${params.date}` : ""}的天气是：晴天，气温22-28℃。`
  ),
};
```

### 2. 注册工具到 Agent

创建 ChatAgent 的时候将工具列表传入配置：

```typescript
import { ChatAgent } from "@agentforge/agents";

const agent = new ChatAgent({
  sessionManager: new InMemorySessionManager(),
  llmProvider: new OpenAICompatibleProvider(config),
  // 注册你的工具列表
  tools: [weatherTool, calculatorTool],
  // 最大工具调用轮次，防止无限循环，默认5次
  maxToolCallRounds: 3,
});
```

### 3. 使用工具调用（非流式）

直接调用 `sendMessage` 方法，Agent 会自动处理工具调用：

```typescript
const response = await Effect.runPromise(
  agent.sendMessage("北京今天的天气怎么样？")
);
console.log(response);
// 输出：北京今天的天气是：晴天，气温22-28℃。
```

### 4. 使用工具调用（流式）

调用 `sendMessageStream` 方法，支持流式输出中间过程：

```typescript
const response = await Effect.runPromise(
  agent.sendMessageStream(
    "北京今天的天气怎么样？",
    // 流式回调，接收文本块
    (chunk) => process.stdout.write(chunk)
  )
);
```

## 可观测事件

工具调用过程中会触发以下中间件事件，你可以通过中间件监听这些事件：

| 事件名 | 触发时机 | 事件数据 |
|--------|----------|----------|
| `tool-call-start` | 工具开始执行时 | `{ toolCallId: string, toolName: string, parameters: object }` |
| `tool-call-end` | 工具执行成功时 | `{ toolCallId: string, toolName: string, result: string }` |
| `tool-call-error` | 工具执行失败时 | `{ toolCallId: string, toolName: string, error: string }` |
| `tool-all-complete` | 本轮所有工具都执行完成时 | `{ toolCount: number }` |

### 示例：监听工具调用事件

```typescript
import { AgentMiddleware, MiddlewareEvents } from "@agentforge/middleware";

class ToolObserverMiddleware extends AgentMiddleware {
  wrapModelCall(request, next) {
    this.on(MiddlewareEvents.TOOL_CALL_START, (data) => {
      console.log(`开始调用工具：${data.toolName}，参数：`, data.parameters);
    });

    this.on(MiddlewareEvents.TOOL_CALL_END, (data) => {
      console.log(`工具调用完成：${data.toolName}，结果：${data.result}`);
    });

    return next(request);
  }
}
```

## 工具调用工作流程

1. 用户提问，Agent 首先判断是否需要调用工具
2. 如果需要调用工具，LLM 生成工具调用参数
3. Agent 执行工具，获取工具返回结果
4. 将工具结果作为上下文再次调用 LLM
5. LLM 根据工具结果生成最终回答
6. 如果还需要调用其他工具，重复步骤2-5，直到不需要调用工具或者超过最大轮次

## 工具编写最佳实践

1. **描述清晰**：工具的 `description` 和参数的 `description` 要尽量清晰准确，这会直接影响 LLM 是否正确调用工具
2. **参数规范**：使用 JSON Schema 严格定义参数，必填参数要在 `required` 字段中声明
3. **错误处理**：工具执行可能失败，要处理好错误情况，返回给 LLM 的错误信息要友好，方便 LLM 重新调用
4. **纯函数优先**：工具尽量是纯函数，不要有副作用，方便测试和调试
5. **幂等性**：工具最好是幂等的，多次调用不会产生不同的结果

## 常见问题

### Q: 工具调用总是失败怎么办？
A: 检查以下几点：
- 工具的描述是否清晰，LLM 是否理解工具的作用
- 参数的 JSON Schema 是否正确，必填参数是否声明
- LLM 生成的参数是否符合 Schema 要求
- 工具执行函数是否有未捕获的错误

### Q: 工具会被无限调用怎么办？
A: 可以通过 `maxToolCallRounds` 配置最大调用轮次，默认是5次，超过后会返回错误。

### Q: 可以动态添加/删除工具吗？
A: 目前版本需要在创建 Agent 时传入所有工具，后续版本会支持动态修改工具列表。

### Q: 工具调用支持并行吗？
A: 目前版本支持并行调用多个工具，如果 LLM 同时返回多个工具调用，会并行执行所有工具。
