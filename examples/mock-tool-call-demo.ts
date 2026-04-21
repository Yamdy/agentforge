#!/usr/bin/env tsx
/**
 * 工具调用功能演示（使用Mock LLM，不需要真实API）
 * 演示工具调用的完整流程
 */

import { Effect, pipe } from "effect";
import { InMemorySessionManager, type Tool, type LLMProvider, type LLMGenerateParams, type LLMGenerateResult } from "../packages/core/src/index";
import { LLMError } from "../packages/llm/src/index";
import { ChatAgent } from "../packages/agents/src/index";

// 模拟LLM Provider，不需要真实API
class MockLLMProvider implements LLMProvider {
  generate(params: LLMGenerateParams): Effect.Effect<LLMGenerateResult, LLMError> {
    const lastMessage = params.messages[params.messages.length - 1];
    console.log(`\n🤖 Mock LLM 收到请求：${lastMessage.content.slice(0, 100)}`);

    // 如果是工具返回的结果，直接生成回答
    if (lastMessage.role === "tool") {
      console.log("🧠 Mock LLM 收到工具结果，生成最终回答");
      return Effect.succeed({
        text: `根据查询结果，${lastMessage.content}`,
      });
    }

    // 模拟工具调用判断
    if (lastMessage.content.includes("天气")) {
      console.log("🧠 Mock LLM 决定调用 get_weather 工具");
      return Effect.succeed({
        text: "",
        toolCalls: [{
          id: "call_123",
          name: "get_weather",
          parameters: { city: "北京", date: "2024-04-20" },
        }],
      });
    }

    if (lastMessage.content.includes("计算") || lastMessage.content.includes("乘以")) {
      console.log("🧠 Mock LLM 决定调用 calculator 工具");
      return Effect.succeed({
        text: "",
        toolCalls: [{
          id: "call_456",
          name: "calculator",
          parameters: { expression: "12345*9876" },
        }],
      });
    }

    // 没有工具调用，返回普通回答
    console.log("🧠 Mock LLM 不需要调用工具，直接回答");
    return Effect.succeed({
      text: `你好！我是AgentForge助手，我可以帮你查询天气和进行数学计算。有什么可以帮你的？`,
    });
  }
}

// 模拟天气查询工具
const weatherTool: Tool<{ city: string; date?: string }> = {
  name: "get_weather",
  description: "查询指定城市的天气情况，支持查询未来几天的天气预报",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "要查询天气的城市名称，比如北京、上海、深圳",
      },
      date: {
        type: "string",
        description: "要查询的日期，格式为YYYY-MM-DD，默认是今天，如果是未来日期返回天气预报",
      },
    },
    required: ["city"],
  },
  execute: (params) => {
    console.log(`⚙️ 执行工具 get_weather，参数：`, params);
    return Effect.succeed(
      `${params.city}${params.date ? ` ${params.date}` : ""}的天气是：晴天，气温22-28℃，空气质量优。`
    );
  },
};

// 计算器工具
const calculatorTool: Tool<{ expression: string }> = {
  name: "calculator",
  description: "进行数学计算，支持加减乘除和复杂的表达式计算",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "要计算的数学表达式，比如\"1+2*3\"、\"(10+5)/3\"",
      },
    },
    required: ["expression"],
  },
  execute: (params) => {
    console.log(`⚙️ 执行工具 calculator，参数：`, params);
    try {
      // eslint-disable-next-line no-eval
      const result = eval(params.expression.replace("乘以", "*"));
      return Effect.succeed(`计算结果：${result}`);
    } catch (e) {
      return Effect.succeed(`计算失败：表达式无效`);
    }
  },
};

async function main() {
  console.log("🚀 AgentForge 工具调用演示（Mock版本，不需要API）");
  console.log("=".repeat(60));

  // 1. 初始化依赖
  const llmProvider = new MockLLMProvider();
  const sessionManager = new InMemorySessionManager();

  // 2. 创建ChatAgent，注册工具
  const agent = ChatAgent.createSync({
    sessionManager,
    llmProvider,
    systemPrompt: "你是一个乐于助人的助手，需要调用工具来回答用户的问题。如果问题需要计算或者查询天气，请调用对应的工具，不要直接回答。",
    tools: [weatherTool, calculatorTool],
    maxToolCallRounds: 2,
  });

  console.log("✅ Agent初始化完成，支持的工具：");
  console.log("  - get_weather: 查询天气");
  console.log("  - calculator: 数学计算");
  console.log("\n");

  // ------------------------------
  // 示例1：天气查询
  // ------------------------------
  console.log("📌 示例1：查询天气");
  console.log("用户提问：北京今天的天气怎么样？");
  console.log("------------------------------");

  const response1 = await Effect.runPromise(
    agent.sendMessage("北京今天的天气怎么样？")
  );

  console.log("\n🤖 最终回答：", response1);
  console.log("\n");

  // ------------------------------
  // 示例2：数学计算
  // ------------------------------
  console.log("📌 示例2：数学计算");
  console.log("用户提问：12345乘以9876等于多少？");
  console.log("------------------------------");

  const response2 = await Effect.runPromise(
    agent.sendMessage("12345乘以9876等于多少？")
  );

  console.log("\n🤖 最终回答：", response2);
  console.log("\n");

  // ------------------------------
  // 示例3：普通对话（不需要工具）
  // ------------------------------
  console.log("📌 示例3：普通对话（不需要工具）");
  console.log("用户提问：你好，请问你是谁？");
  console.log("------------------------------");

  const response3 = await Effect.runPromise(
    agent.sendMessage("你好，请问你是谁？")
  );

  console.log("\n🤖 最终回答：", response3);
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

  console.log("\n🎉 所有功能演示完成！工具调用流程完全正常！");
}

main().catch((e) => {
  console.error("❌ 演示运行失败：", e);
  process.exit(1);
});
