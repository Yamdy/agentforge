#!/usr/bin/env node
/**
 * 📋 Example: Memory features demonstration (no LLM required)
 * - Checkpointer + Time Travel (undo/restore)
 * - Token trimming/compression
 * - GPTTokenizer vs SimpleEstimateTokenizer
 */

import { Effect } from "effect";
import {
  InMemorySessionManager,
  InMemoryCheckpointer,
  GPTTokenizer,
  SimpleEstimateTokenizer,
} from "@agentforge/memory";

const run = Effect.sync(() => {
  console.log("🚀 AgentForge Memory Features Demo (No LLM Required)");
  console.log("======================================");
  console.log();

  // 1. 初始化内存管理器
  const sessionManager = new InMemorySessionManager();
  const checkpointer = new InMemoryCheckpointer();

  console.log("✅ 内存管理器 + 检查点初始化完成");
  console.log();

  // 2. 演示: Token 计数对比
  console.log("📌 演示 1: Token 计数");
  console.log("   - GPTTokenizer: 使用 gpt-3-encoder 精确计数");
  console.log("   - SimpleEstimateTokenizer: 4字符 ≈ 1token 快速估算");
  console.log();

  const gptTokenizer = new GPTTokenizer();
  const simpleTokenizer = new SimpleEstimateTokenizer();

  const testCases = [
    "你好，这是一段测试文本，用来测试分词器。",
    "Hello, this is a test for token counting.",
    "这是一段更长的中文文本，用来测试 GPT 分词器和估算分词器之间的区别。中文每个字通常占用更多token，所以估算方法会偏低。"
  ];

  testCases.forEach((testText, i) => {
    console.log(`Test ${i+1}: "${testText}"`);
    console.log(`  GPTTokenizer  精确计数: ${gptTokenizer.count(testText)} tokens`);
    console.log(`  SimpleEstimateTokenizer 估算: ${simpleTokenizer.count(testText)} tokens`);
    console.log();
  });

  // 3. 创建会话 + 演示裁剪 + Checkpointer
  console.log("📌 演示 2: Checkpointer + 时间旅行 + Token 裁剪");
  console.log("   - 创建会话");
  console.log("   - 添加多轮对话");
  console.log("   - 保存多个检查点");
  console.log("   - Token 裁剪");
  console.log("   - 恢复到任意历史检查点");
  console.log();

  // 创建会话
  const session = Effect.runSync(
    sessionManager.create({
      systemPrompt: "你是一只唐老鸭，每句话结尾会带上‘嘎嘎’",
      metadata: {
        title: "Memory Demo Session",
        createdAt: new Date().toISOString(),
      },
    })
  );

  console.log(`👉 会话创建: id=${session.id}`);
  console.log(`   metadata:`, session.metadata);
  console.log();

  // 保存第一个检查点 (初始状态)
  Effect.runSync(checkpointer.save(`${session.id}/step-0`, session));
  console.log(`💾 检查点已保存: ${session.id}/step-0 (初始状态)`);
  console.log();

  // 获取当前会话并添加消息
  let currentSession = Effect.runSync(sessionManager.get(session.id))!;
  
  // 添加多轮对话
  currentSession = Effect.runSync(
    sessionManager.addMessage(session.id, {
      role: "user",
      content: "北京今天天气怎么样？",
    })
  );
  currentSession = Effect.runSync(
    sessionManager.addMessage(session.id, {
      role: "assistant",
      content: "北京今天天气是晴天，气温22-28℃，空气质量优。嘎嘎",
    })
  );
  console.log(`💬 添加第一轮对话完成，当前消息数: ${currentSession.messages.length}`);

  // 保存第二个检查点
  Effect.runSync(checkpointer.save(`${session.id}/step-1`, currentSession));
  console.log(`💾 检查点已保存: ${session.id}/step-1 (第一轮对话后)`);
  console.log();

  // 添加第二轮对话
  currentSession = Effect.runSync(
    sessionManager.addMessage(session.id, {
      role: "user",
      content: "12345 * 9876 等于多少？",
    })
  );
  currentSession = Effect.runSync(
    sessionManager.addMessage(session.id, {
      role: "assistant",
      content: "12345 * 9876 = 121905420。嘎嘎",
    })
  );
  console.log(`💬 添加第二轮对话完成，当前消息数: ${currentSession.messages.length}`);

  // 保存第三个检查点
  Effect.runSync(checkpointer.save(`${session.id}/step-2`, currentSession));
  console.log(`💾 检查点已保存: ${session.id}/step-2 (第二轮对话后)`);

  // 列出所有检查点
  const checkpoints = Effect.runSync(checkpointer.list(session.id));
  console.log(`📋 所有检查点: [${checkpoints.join(", ")}]`);
  console.log();

  // 演示 Token 裁剪
  console.log(`✂️ 演示 3: Token 裁剪 (maxTokens=100, 保留最新消息)`);
  console.log(`   当前总 tokens: ${gptTokenizer.count(
    currentSession.messages.map(m => m.content).join(' ')
  )}`);
  const trimmed = Effect.runSync(
    sessionManager.trim(session.id, {
      maxTokens: 100,
      maxMessages: 4,
      tokenizer: (text) => gptTokenizer.count(text),
    })
  );
  console.log(`   裁剪后消息数: ${trimmed.messages.length}`);
  console.log(`   裁剪后总 tokens: ${gptTokenizer.count(
    trimmed.messages.map(m => m.content).join(' ')
  )}`);
  console.log();

  // 演示时间旅行：恢复到第一个检查点 step-0
  console.log("⏮️ 演示 4: 时间旅行 - 恢复到 step-0 (初始状态)");
  const restored = Effect.runSync(checkpointer.get(`${session.id}/step-0`));
  if (restored) {
    console.log(`✅ 恢复成功！`);
    console.log(`   恢复后消息数: ${restored.messages.length}`);
    console.log(`   当前系统提示: "${restored.systemPrompt}"`);
    console.log();
    console.log("🎉 时间旅行成功！现在 agent 已经回到第一轮对话之前的状态。");
  }

  console.log();
  console.log("🎉 所有记忆功能演示完成！");
  console.log();
  console.log("✨ 特性总结:");
  console.log("   • ✓ 滑动窗口裁剪 + Token 裁剪 双重裁剪策略");
  console.log("   • ✓ Checkpointer 支持时间旅行，可以恢复任意历史快照");
  console.log("   • ✓ GPTTokenizer 精确计数 + SimpleEstimateTokenizer 快速估算，都开箱即用");
  console.log("   • ✓ metadata 支持，每个会话有 createdAt / updatedAt 自动时间戳");
  console.log("   • ✓ 基于 Effect-TS 4.0，纯函数式，错误处理安全");
});

// 运行
Effect.runFork(run);
