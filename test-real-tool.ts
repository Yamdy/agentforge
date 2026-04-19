#!/usr/bin/env tsx
import { Effect } from "effect";
import { InMemorySessionManager, Tool } from "./packages/core/src/index";
import { OpenAICompatibleProvider, loadLLMConfigFromJson } from "./packages/llm/src/index";
import { ChatAgent } from "./packages/agents/src/index";

// 简单加法工具
const addTool: Tool = {
  name: "add_numbers",
  description: "计算两个数字的和，用户问加法计算的时候调用这个工具",
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
  execute: (params: { a: number; b: number }) => {
    console.log(`🧰 工具被调用：计算 ${params.a} + ${params.b} = ${params.a + params.b}`);
    return Effect.succeed(`${params.a} + ${params.b} = ${params.a + params.b}`);
  }
};

async function main() {
  console.log("🚀 真实PaLLM工具调用测试开始\n");

  try {
    // 加载配置
    const config = await Effect.runPromise(loadLLMConfigFromJson("config.json"));
    console.log("✅ 配置加载完成");

    // 创建LLM Provider
    const llmProvider = new OpenAICompatibleProvider(config);
    const sessionManager = new InMemorySessionManager();

    // 创建Agent，注册加法工具
    const agent = new ChatAgent({
      sessionManager,
      llmProvider,
      systemPrompt: "你是一个智能助手，需要计算加法的时候必须调用add_numbers工具，不要直接回答。只有得到工具返回结果后再回答用户。",
      tools: [addTool],
      maxToolCallRounds: 2
    });
    console.log("✅ Agent初始化完成\n");

    // 测试加法问题
    console.log("🧑 用户提问：123 + 456等于多少？\n");
    const response = await Effect.runPromise(agent.sendMessage("123 + 456等于多少？"));

    console.log("\n🤖 最终回答：", response);
    console.log("\n🎉 测试完成！");
  } catch (e) {
    console.error("❌ 测试失败：", e);
  }
}

main();
