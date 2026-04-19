#!/usr/bin/env tsx
/**
 * 测试火山引擎PaLLM的工具调用功能
 */

import { Effect } from "effect";
import { InMemorySessionManager, type Tool } from "./packages/core/src/index";
import { OpenAICompatibleProvider } from "./packages/llm/src/index";
import { ChatAgent } from "./packages/agents/src/index";

// 简单的加法工具
const addTool: Tool<{ a: number; b: number }> = {
  name: "add_numbers",
  description: "计算两个数字的和，当用户需要计算加法的时候调用这个工具",
  parameters: {
    type: "object",
    properties: {
      a: {
        type: "number",
        description: "第一个数字"
      },
      b: {
        type: "number",
        description: "第二个数字"
      }
    },
    required: ["a", "b"]
  },
  execute: (params) => {
    console.log(`🧰 执行加法工具：${params.a} + ${params.b} = ${params.a + params.b}`);
    return Effect.succeed(`${params.a} + ${params.b} = ${params.a + params.b}`);
  }
};

async function test() {
  console.log("🚀 开始测试火山引擎PaLLM工具调用功能\n");

  // 配置PaLLM
  const provider = new OpenAICompatibleProvider({
    baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
    apiKey: "28baa4bf-59c6-4583-aecd-cbae71bde493",
    model: "ark-code-latest",
    temperature: 0.01
  });

  const sessionManager = new InMemorySessionManager();

  // 创建Agent
  const agent = new ChatAgent({
    sessionManager,
    llmProvider: provider,
    systemPrompt: "你是一个智能助手，当用户需要计算加法的时候请调用add_numbers工具，不要直接回答。只有当不需要工具返回结果的时候再回答用户的问题。",
    tools: [addTool],
    maxToolCallRounds: 2
  });

  console.log("✅ Agent初始化完成，现在测试加法计算：\n");

  try {
    const response = await Effect.runPromise(agent.sendMessage("123加456等于多少？"));
    console.log("\n🤖 最终回答：", response);
    console.log("\n✅ 测试完成！");
  } catch (e) {
    console.error("\n❌ 测试失败：", e);
  }
}

test();
