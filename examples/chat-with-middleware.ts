#!/usr/bin/env tsx
/**
 * 完整功能示例：包含基础聊天、流式聊天、自定义中间件
 * 支持的功能：
 * 1. 基础对话
 * 2. 流式对话
 * 3. 日志中间件
 * 4. 计时中间件
 * 5. 自定义带状态的中间件
 * 6. 请求拦截和响应修改
 */

import { Effect, pipe } from "effect";
import { InMemorySessionManager, type SessionManager } from "@agentforge/core";
import {
  OpenAICompatibleProvider, loadLLMConfigFromJson } from "@agentforge/llm";
import {
  createLoggingMiddleware,
  createTimingMiddleware,
  AgentMiddleware,
  createMiddlewarePipeline,
  ModelRequest,
  ModelResponse,
} from "@agentforge/middleware";
import { ChatAgent } from "@agentforge/agents";

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
    console.log(`[计数器] 这是第 ${this.state.count} 次调用 LLM`);

    // 注入系统提示词
    const messages = [
      { role: "system", content: "你是一个幽默的聊天助手，每句话结尾都要加个表情符号 🦆" },
      ...request.messages,
    ];

    return pipe(
      next({ ...request, messages }),
      Effect.map((response) => {
        // 修改响应：在结尾追加计数器信息
        return {
          ...response,
          response: `${response.response}\n\n（本次调用是第 ${this.state.count} 次对话）`,
        };
      })
    );
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
    systemPrompt: "你是一个友好的聊天助手。",
    middleware: pipeline, // 或者直接传数组：[counterMiddleware, createLoggingMiddleware()]
  });

  console.log("\n✅ 初始化完成，开始对话...");
  console.log("\n--- 第1轮对话 (非流式) ---");

  // 4. 普通对话
  const response1 = await Effect.runPromise(agent.sendMessage("你好，给我讲个冷笑话"));
  console.log("😀 助手：", response1);

  console.log("\n--- 第2轮对话 (流式) ---");
  console.log("💬 助手回答：");
  let fullResponse = "";

  const response2 = await Effect.runPromise(
    agent.sendMessageStream("再给我讲一个关于程序员的笑话", (chunk) => {
      process.stdout.write(chunk);
      fullResponse += chunk;
    })
  );

  console.log("\n✅ 流式响应完成，完整响应：", fullResponse);
  console.log("\n--- 第3轮对话，验证状态保留 ---");

  const response3 = await Effect.runPromise(agent.sendMessage("之前给我讲的笑话都很好笑，再讲一个"));
  console.log("😀 助手：", response3);

  // 5. 查看会话历史
  const session = await Effect.runPromise(agent.getSession());
  console.log("\n📚 会话历史：");
  session.messages.forEach((msg, idx) => {
    console.log(`${idx+1}. [${msg.role}]: ${msg.content.slice(0, 50)}...`);
  });

  console.log("\n🎉 所有功能验证完成！");
}

main().catch((e) => {
  console.error("❌ 错误：", e);
  process.exit(1);
});
