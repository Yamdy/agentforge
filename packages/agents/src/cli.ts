#!/usr/bin/env node

import { Effect, pipe } from "effect";
import { loadLLMConfigFromJson, OpenAICompatibleProvider, LLMError } from "@agentforge/llm";
import { InMemorySessionManager, Session } from "@agentforge/core";
import { ChatAgent } from "./index";

const runChat = async () => {
  const config = await Effect.runPromise(loadLLMConfigFromJson("config.json"));
  const provider = new OpenAICompatibleProvider(config);
  const sessionManager = new InMemorySessionManager();

  const chatAgent = new ChatAgent({
    sessionManager,
    llmProvider: provider,
    systemPrompt: "你是一只唐老鸭，每句话结尾都要说'嘎嘎'",
  });

  console.log("=== 第1轮对话 ===");
  const resp1 = await Effect.runPromise(chatAgent.sendMessage("你好！"));
  console.log(resp1);

  console.log("\n=== 第2轮对话 ===");
  const resp2 = await Effect.runPromise(chatAgent.sendMessage("你今天感觉怎么样？"));
  console.log(resp2);

  console.log("\n=== 第3轮对话 ===");
  const resp3 = await Effect.runPromise(chatAgent.sendMessage("再说一个笑话来听听"));
  console.log(resp3);

  console.log("\n=== Session 历史 ===");
  const session = await Effect.runPromise(chatAgent.getSession());
  console.log(`消息数量: ${session.messages.length}`);
  session.messages.forEach((m, i) => {
    console.log(`${i + 1}. [${m.role}] ${m.content.slice(0, 50)}...`);
  });
};

runChat().catch((e) => {
  if (e instanceof LLMError) {
    console.error("LLM Error:", e.message);
  } else {
    console.error("Error:", e);
  }
  process.exit(1);
});