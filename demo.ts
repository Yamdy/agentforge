#!/usr/bin/env tsx
/**
 * 完整功能示例：包含基础聊天、流式聊天、自定义中间件
 * 从根目录直接运行：pnpm tsx demo.ts
 */

import { Effect, pipe } from "effect";
import { InMemorySessionManager } from "./packages/core/src/index.js";
import {
  OpenAICompatibleProvider, loadLLMConfigFromJson } from "./packages/llm/src/index.js";
import {
  createLoggingMiddleware,
  createTimingMiddleware,
  AgentMiddleware,
  createMiddlewarePipeline,
  ModelRequest,
  ModelResponse,
} from "./packages/middleware/src/index.js";
import { ChatAgent } from "./packages/agents/src/index.js";

/**
 * 自定义中间件：统计用户消息计数器
 */
class MessageCounterMiddleware extends AgentMiddleware<{ count: number }> {
  constructor() {
    super({ count: 0 });
  }

  wrapModelCall(
    request: ModelRequest,
    next: (request: ModelRequest) => Effect.Effect<ModelResponse, unknown, never>
  ): Effect.Effect<ModelResponse, unknown, never> {
    // 修改请求：统计调用次数
    this.setState({ count: this.state.count + 1 });
    console.log(`\n[计数器] 这是第 ${this.state.count} 次调用 LLM`);

    return next(request);
  }
}

async function main() {
  console.log("=== AgentForge 完整功能示例 🚀");
  console.log("=".repeat(50));

  // 1. 初始化依赖
  const config = await Effect.runPromise(loadLLMConfigFromJson("config.json"));
  const llmProvider = new OpenAICompatibleProvider(config);
  const sessionManager = new InMemorySessionManager();

  // 2. 配置中间件
  const counterMiddleware = new MessageCounterMiddleware();
  const pipeline = createMiddlewarePipeline(
    createLoggingMiddleware(),
    createTimingMiddleware(),
    counterMiddleware
  );

  // 3. 创建 ChatAgent
  const agent = new ChatAgent({
    sessionManager,
    llmProvider,
    systemPrompt: "你是一个友好的聊天助手，回答要简洁。",
    middleware: pipeline,
  });

  console.log("\n✅ 初始化完成，开始对话...");
  console.log("\n--- 第1轮对话 (非流式) ---");

  // 4. 普通对话
  const response1 = await Effect.runPromise(agent.sendMessage("你好，给我讲个冷笑话"));
  console.log("\n😀 助手：", response1);

  console.log("\n--- 第2轮对话 (流式) ---");
  console.log("💬 助手回答：");

  const response2 = await Effect.runPromise(
    agent.sendMessageStream("再给我讲一个关于程序员的笑话", (chunk) => {
      process.stdout.write(chunk);
    })
  );

  console.log("\n\n✅ 流式响应完成");
  console.log("\n--- 第3轮对话 ---");

  const response3 = await Effect.runPromise(agent.sendMessage("你一共回答了我几个问题？"));
  console.log("\n😀 助手：", response3);

  // 5. 查看会话历史
  const session = await Effect.runPromise(agent.getSession());
  console.log("\n📚 会话历史：");
  session.messages.forEach((msg, idx) => {
    console.log(`${idx+1}. [${msg.role}]: ${msg.content.slice(0, 50)}...`);
  });

  console.log("\n🎉 所有功能验证完成！");
}

main().catch((e) => {
  console.error("\n❌ 错误：", e);
  process.exit(1);
});
