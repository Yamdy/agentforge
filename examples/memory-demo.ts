#!/usr/bin/env node
/**
 * 📋 Example: Memory features demonstration
 * - Checkpointer + Time Travel (undo/restore)
 * - Token trimming/compression
 * - GPTTokenizer vs SimpleEstimateTokenizer
 * 
 * Press Ctrl+C to exit
 */

import { z } from "zod";
import { Effect } from "effect";
import { InMemorySessionManager, InMemoryCheckpointer, GPTTokenizer, SimpleEstimateTokenizer } from "@agentforge/memory";
import { OpenAICompatibleProvider, loadLLMConfigFromJson, LLMError } from "@agentforge/llm";
import { ChatAgent } from "@agentforge/agents";

// 天气查询工具
const weatherTool = {
  name: "get_weather",
  description: "查询指定城市的天气情况",
  parameters: z.object({
    city: z.string().describe("城市名称"),
    date: z.string().optional().describe("日期，可选"),
  }),
  execute: (params: { city: string; date?: string }) => Effect.succeed(
    `${params.city}${params.date ? ` ${params.date}` : ""}的天气是：晴天，气温22-28℃，空气质量优。`
  ),
};

// 计算器工具
const calculatorTool = {
  name: "calculator",
  description: "进行数学计算",
  parameters: z.object({
    expression: z.string().describe("数学表达式"),
  }),
  execute: (params: { expression: string }) => {
    try {
      // eslint-disable-next-line no-eval
      const result = eval(params.expression);
      return Effect.succeed(`计算结果：${result}`);
    } catch (e) {
      return Effect.succeed(`计算失败：${e}`);
    }
  },
};

const program = Effect.gen(function* () {
  console.log("🚀 AgentForge Memory Features Demo");
  console.log("======================================");

  // 1. 初始化内存管理器
  const sessionManager = new InMemorySessionManager();
  const checkpointer = new InMemoryCheckpointer();

  console.log("✅ 内存管理器 + 检查点初始化完成");
  console.log();

  // 2. 加载 LLM 配置
  const llmConfig = yield loadLLMConfigFromJson("./config.json");
  const llmProvider = new OpenAICompatibleProvider(llmConfig);

  // 3. 创建 Agent
  const agent = ChatAgent.createSync({
    sessionManager,
    llmProvider,
    systemPrompt: "你是一只唐老鸭，每句话结尾会带上‘嘎嘎’。当用户问题不需要调用工具时直接回答，不需要反复调用工具。",
    tools: [weatherTool, calculatorTool],
    maxToolCallRounds: 2,
  });

  console.log("✅ Agent 创建完成");
  console.log("🔧 支持工具:", [weatherTool.name, calculatorTool.name].join(", "));
  console.log();

  // 4. 演示: Token 计数
  console.log("📌 演示 1: Token 计数");
  console.log("   - GPTTokenizer: 使用 gpt-3-encoder 精确计数");
  console.log("   - SimpleEstimateTokenizer: 4字符 ≈ 1token 快速估算");
  console.log();

  const gptTokenizer = new GPTTokenizer();
  const simpleTokenizer = new SimpleEstimateTokenizer();

  const testText = "你好，这是一段测试文本，用来测试分词器。";
  console.log(`Test text: "${testText}"`);
  console.log(`GPTTokenizer  计数: ${gptTokenizer.count(testText)} tokens`);
  console.log(`SimpleEstimateTokenizer 估算: ${simpleTokenizer.count(testText)} tokens`);
  console.log();

  // 5. 获取 Agent 内部会话 + 保存检查点
  console.log("📌 演示 2: Checkpointer + 时间旅行 + LLM 对话");
  console.log("   - 创建会话 (Agent 自动创建)");
  console.log("   - 保存初始检查点");
  console.log("   - LLM 对话 + 工具调用");
  console.log("   - Token 裁剪演示");
  console.log("   - 恢复到初始检查点");
  console.log();

  // 获取 Agent 内部会话
  const agentSession = yield agent.getSession();
  const sessionId = agentSession.id;
  
  // 添加 metadata
  agentSession.metadata = {
    title: "Memory Demo Session",
    createdAt: new Date().toISOString(),
  };

  console.log(`👉 会话创建: id=${sessionId}`);
  console.log(`   metadata:`, agentSession.metadata);
  console.log();

  // 保存第一个检查点 (初始状态)
  yield checkpointer.save(`${sessionId}/step-0`, agentSession);
  console.log(`💾 检查点 saved: ${sessionId}/step-0 (初始状态)`);
  console.log();

  // 执行第一个提问 (不需要工具调用，直接回答)
  const response1 = yield agent.sendMessage("你是谁？简单介绍一下你自己");
  console.log(`🤖 回答: ${response1}`);
  console.log();

  // 获取当前会话
  const currentSession = yield sessionManager.get(sessionId);
  console.log(`📊 当前消息数: ${currentSession?.messages.length ?? 0}`);
  console.log();

  // 演示 Token 裁剪 + 可选 LLM 压缩
  console.log(`✂️ 演示 Token 裁剪 + 压缩 (maxTokens=200, thresholdTokens=150)`);
  let originalTotalTokens = 0;
  if (currentSession) {
    originalTotalTokens = gptTokenizer.count(
      currentSession.messages.map(m => m.content).join(' ')
    );
  }

  // 这里展示如何使用 LLM 压缩
  // 你需要提供一个压缩函数，当 token 超过 thresholdTokens 时会自动调用压缩
  // 在实际使用中，你可以调用 LLM 来总结历史对话得到压缩结果
  // 这里我们展示接口，实际压缩逻辑由你自定义
  const trimmed = yield sessionManager.trim(sessionId, {
    maxTokens: 200,
    maxMessages: 10,
    tokenizer: (text) => gptTokenizer.count(text),
    compression: {
      thresholdTokens: 150,
      compress: (messages) => {
        // Example compression: your LLM summarization goes here
        // const summary = yield* llm.generate([
        //   { role: "system", content: "Please summarize the following conversation..." },
        //   { role: "user", content: JSON.stringify(messages) }
        // ]);
        // return Effect.succeed([{ role: "assistant", content: summary.text }]);
        console.log("🧩 Compression would be triggered here (custom compression callback)");
        // For demo, we just return original messages unchanged
        return Effect.succeed(messages);
      }
    }
  });
  let trimmedTotalTokens = 0;
  if (trimmed.messages.length > 0) {
    trimmedTotalTokens = gptTokenizer.count(trimmed.messages.map(m => m.content).join(' '));
  }
  console.log(`   原始总 tokens: ${originalTotalTokens}, 裁剪后总 tokens: ${trimmedTotalTokens}`);
  console.log(`   裁剪后消息数: ${trimmed.messages.length}`);
  console.log();

  // 保存第二个检查点 (对话后)
  const currentSessionAfterStep1 = yield sessionManager.get(sessionId);
  yield checkpointer.save(`${sessionId}/step-1`, currentSessionAfterStep1!);
  console.log(`💾 检查点 saved: ${sessionId}/step-1 (第一次对话后)`);

  // 列出所有检查点
  const checkpoints = yield checkpointer.list(sessionId);
  console.log(`📋 所有检查点: [${checkpoints.join(", ")}]`);
  console.log();

  // 演示时间旅行：恢复到第一个检查点
  console.log("⏮️ 时间旅行：恢复到 step-0 (初始状态)");
  const restored = yield checkpointer.get(`${sessionId}/step-0`);
  if (restored) {
    // 恢复会话到内存管理器 - InMemorySessionManager 直接 set
    (sessionManager as any).sessions.set(sessionId, restored);
    const restoredSession = yield sessionManager.get(sessionId);
    console.log(`✅ 恢复成功！恢复后消息数: ${restoredSession?.messages.length ?? 0}`);
    console.log();
    console.log("🎉 时间旅行演示完成！agent 已经回到第一个问题之前的初始状态。");
  }

  console.log();
  console.log("🎉 所有演示完成！");
  console.log();
  console.log("✨ 特性总结:");
  console.log("   • ✓ 滑动窗口裁剪 + Token 裁剪 双重裁剪");
  console.log("   • ✓ Checkpointer 支持时间旅行 / 恢复任意历史快照");
  console.log("   • ✓ GPTTokenizer 精确计数 + SimpleEstimateTokenizer 快速估算，都开箱即用");
  console.log("   • ✓ metadata + createdAt/updatedAt 时间戳支持");

  return Effect.succeed(undefined);
});

// 运行
Effect.runPromise(program).catch(error => {
  console.error("\n❌ 程序出错:");
  console.error(error instanceof LLMError ? `LLM 错误: ${error.message}` : String(error));
  console.error(error);
  process.exit(1);
});
