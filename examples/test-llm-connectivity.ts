#!/usr/bin/env tsx
/**
 * 🔍 Simple LLM Connectivity Test
 * Tests if your LLM endpoint is accessible
 */

import { Effect } from "effect";
import { OpenAICompatibleProvider, loadLLMConfigFromJson } from "@agentforge/llm";

const program = Effect.gen(function* () {
  console.log("🔍 LLM Connectivity Test");
  console.log("=======================");
  console.log();

  // 1. 加载配置
  console.log("📝 Loading configuration from config.json...");
  const config = yield* loadLLMConfigFromJson("./config.json");
  console.log(`✅ Configuration loaded:`);
  console.log(`   - baseURL: ${config.baseURL}`);
  console.log(`   - model: ${config.model}`);
  console.log(`   - apiKey: ${config.apiKey ? `[${config.apiKey.length} chars]` : "NOT FOUND"}`);
  console.log();

  // 2. 初始化 provider
  console.log("🚀 Initializing LLM provider...");
  const provider = new OpenAICompatibleProvider(config);
  console.log("✅ Provider initialized");
  console.log();

  // 3. 简单请求测试
  console.log("📤 Sending test request (simple 'Hello' response)...");
  const result = yield* provider.generate({
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Say hello world in one sentence." },
    ],
  });

  console.log();
  console.log("✅ Request SUCCESSFUL!");
  console.log("====================");
  console.log(`📄 Response: ${result.text}`);
  console.log();
  if (result.toolCalls && result.toolCalls.length > 0) {
    console.log(`🔧 Tool calls received: ${result.toolCalls.length}`);
  }

  console.log();
  console.log("🎉 LLM service is working correctly!");

  return Effect.succeed(undefined);
});

Effect.runPromise(program).catch(error => {
  console.error("\n❌ Request FAILED:");
  console.error("================");
  console.error(error);
  process.exit(1);
});
