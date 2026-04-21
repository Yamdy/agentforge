#!/usr/bin/env tsx
import { z } from "zod";
import { Effect, pipe } from "effect";
import { InMemorySessionManager, type Tool } from "@agentforge/core";
import { OpenAICompatibleProvider, loadLLMConfigFromJson } from "@agentforge/llm";
import { ChatAgent } from "@agentforge/agents";
import { MiddlewareEvents, createLoggingMiddleware, createMiddlewarePipeline } from "@agentforge/middleware";

const weatherTool: Tool<{ city: string; date?: string }> = {
  name: "get_weather",
  description: "查询指定城市的天气情况，支持查询未来几天的天气预报",
  parameters: z.object({
    city: z.string().describe("要查询天气的城市名称，比如北京、上海、深圳"),
    date: z.string().optional().describe("要查询的日期，格式为YYYY-MM-DD，默认是今天"),
  }),
  execute: (params) => {
    return Effect.succeed(
      `${params.city}${params.date ? ` ${params.date}` : ""}的天气是：晴天，气温22-28℃，空气质量优。`
    );
  },
};

const calculatorTool: Tool<{ expression: string }> = {
  name: "calculator",
  description: "进行数学计算，支持加减乘除和复杂的表达式计算",
  parameters: z.object({
    expression: z.string().describe("要计算的数学表达式，比如\"1+2*3\"、\"(10+5)/3\""),
  }),
  execute: (params) => {
    try {
      const result = eval(params.expression);
      return Effect.succeed(`计算结果：${result}`);
    } catch (e) {
      return Effect.succeed(`计算失败：表达式无效`);
    }
  },
};

async function main() {
  console.log("🚀 AgentForge 工具调用示例");
  console.log("=".repeat(50));

  // 1. 加载LLM配置
  const config = await Effect.runPromise(loadLLMConfigFromJson("config.json"));
  const llmProvider = new OpenAICompatibleProvider(config);
  const sessionManager = new InMemorySessionManager();

  // 2. 创建中间件
  const loggingMiddleware = createLoggingMiddleware();

// 3. 创建ChatAgent，注册工具
  const agent = await ChatAgent.create({
    sessionManager,
    llmProvider,
    systemPrompt: "你是一只唐老鸭，每句话结尾会带上'嘎嘎'",
    tools: [weatherTool, calculatorTool],
    maxToolCallRounds: 3, // 最多3轮工具调用
  });

  console.log("✅ Agent初始化完成，支持的工具：");
  console.log("  - get_weather: 查询天气");
  console.log("  - calculator: 数学计算");
  console.log("\n");

  // ------------------------------
  // 示例0：不调用工具的简单问题
  // ------------------------------
  console.log("📌 示例0：不调用工具的简单问题");
  console.log("用户提问：你是谁？");
  console.log("------------------------------");

  const response0 = await Effect.runPromise(
    agent.sendMessage("你是谁？")
  );

  console.log("\n🤖 助手回答：", response0);
  console.log("\n");

  // ------------------------------
  // 示例1：非流式工具调用
  // ------------------------------
  console.log("📌 示例1：非流式工具调用（查询天气）");
  console.log("用户提问：北京今天的天气怎么样？");
  console.log("------------------------------");

  const response1 = await Effect.runPromise(
    agent.sendMessage("北京今天的天气怎么样？")
  );

  console.log("\n🤖 助手回答：", response1);
  console.log("\n");

  // ------------------------------
  // 示例2：多轮工具调用（计算）
  // ------------------------------
  console.log("📌 示例2：非流式工具调用（数学计算）");
  console.log("用户提问：12345乘以9876等于多少？");
  console.log("------------------------------");

  const response2 = await Effect.runPromise(
    agent.sendMessage("12345乘以9876等于多少？")
  );

  console.log("\n🤖 助手回答：", response2);
  console.log("\n");

  // ------------------------------
  // 示例3：流式工具调用
  // ------------------------------
  console.log("📌 示例3：流式工具调用（查询深圳明天的天气）");
  console.log("用户提问：深圳明天的天气怎么样？");
  console.log("------------------------------");

  console.log("🤖 助手回答（流式输出）：");
  const response3 = await Effect.runPromise(
    agent.sendMessageStream("深圳明天的天气怎么样？", (chunk) => {
      process.stdout.write(chunk);
    })
  );

  console.log("\n✅ 流式回答完整内容：", response3);
  console.log("\n");

  // ------------------------------
  // 示例4：查看会话历史
  // ------------------------------
  console.log("📌 示例4：查看会话历史");
  console.log("------------------------------");
  const session = await Effect.runPromise(agent.getSession());
  console.log(`会话ID：${session.id}`);
  console.log(`消息数量：${session.messages.length}`);
  session.messages.forEach((msg, idx) => {
    console.log(`${idx + 1}. [${msg.role}] ${msg.content.slice(0, 100)}${msg.content.length > 100 ? "..." : ""}`);
  });

  console.log("\n🎉 所有示例演示完成！");
}

main().catch((e) => {
  console.error("❌ 示例运行失败：", e);
  process.exit(1);
});