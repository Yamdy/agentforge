#!/usr/bin/env tsx
/**
 * 持久化功能完整测试示例
 * 运行前请复制 config.json.example 为 config.json，填写你的LLM配置
 */

import { Effect, Console } from "effect";
import { FileStorage, PersistentSessionManager, PersistentCheckpointer } from "../packages/storage/dist/index.js";
import { ChatAgent } from "../packages/agents/dist/index.js";
import { OpenAICompatibleProvider, loadLLMConfigFromJson } from "../packages/llm/dist/index.js";
import type { Session } from "@agentforge/core";

const run = Effect.gen(function* () {
  yield* Console.log("\n🚀 AgentForge 持久化功能测试\n");

  // ---------------------------
  // 1. 初始化持久化组件
  // ---------------------------
  yield* Console.log("📦 初始化存储组件...");
  const storage = new FileStorage({
    // 可选：自定义存储路径，默认存在 ~/.agentforge/storage
    // rootDir: "./my-storage"
  });

  // 持久化会话管理器：会话消息会自动持久化
  const sessionManager = new PersistentSessionManager({ storage });

  // 持久化检查点：快照自动持久化，支持时间旅行
  const checkpointer = new PersistentCheckpointer({ storage });

  yield* Console.log("✅ 持久化组件初始化完成\n");

  // ---------------------------
  // 2. 初始化LLM和Agent
  // ---------------------------
  yield* Console.log("🤖 初始化LLM和Agent...");
  const llmConfig = yield* loadLLMConfigFromJson("./config.json");
  const llmProvider = new OpenAICompatibleProvider(llmConfig);

  const agent = yield* Effect.tryPromise(() => ChatAgent.create({
    sessionManager,
    llmProvider,
    systemPrompt: "你是一个友好的智能助手，每次回答都会带上自己的名字'鸭鸭'。",
  }));

  yield* Console.log("✅ Agent初始化完成\n");

  // ---------------------------
  // 3. 测试会话持久化
  // ---------------------------
  yield* Console.log("💬 测试会话持久化...");
  const session = yield* agent.sessionManager.create({
    systemPrompt: "你是一个喜欢说嘎嘎的助手。",
    metadata: { name: "测试会话", createdBy: "demo" }
  });
  yield* Console.log(`✅ 会话创建成功，ID: ${session.id}`);
  yield* Console.log(`   会话元数据: ${JSON.stringify(session.metadata)}`);
  yield* Console.log(`   初始消息数: ${session.messages.length}\n`);

  // 发送消息，消息会自动持久化
  yield* Console.log("✉️  发送第一条消息: 你好鸭");
  const response1 = yield* agent.sendMessage("你好鸭", session.id);
  yield* Console.log(`🤖 AI回复: ${response1}`);

  // 读取最新会话消息，验证持久化生效
  const savedSession = yield* agent.sessionManager.get(session.id);
  yield* Console.log(`\n✅ 从持久化存储读取会话，当前消息数: ${savedSession?.messages.length}`);
  if (savedSession) {
    for (let idx = 0; idx < savedSession.messages.length; idx++) {
      const msg = savedSession.messages[idx];
      yield* Console.log(`   [${idx}] ${msg.role}: ${msg.content.slice(0, 50)}${msg.content.length > 50 ? "..." : ""}`);
    }
  }

  // ---------------------------
  // 4. 测试检查点持久化
  // ---------------------------
  yield* Console.log("\n📸 测试检查点持久化...");
  const checkpointId = checkpointer.generateId(session.id);
  yield* checkpointer.save(checkpointId, savedSession as Session);
  yield* Console.log(`✅ 检查点保存成功，ID: ${checkpointId}\n`);

  // 发送第二条消息，增加新的历史
  yield* Console.log("✉️  发送第二条消息: 1+1等于几");
  const response2 = yield* agent.sendMessage("1+1等于几", session.id);
  yield* Console.log(`🤖 AI回复: ${response2}`);

  // 读取最新会话，现在有4条消息了
  const sessionAfterSecondMsg = yield* agent.sessionManager.get(session.id);
  yield* Console.log(`\n✅ 发送第二条消息后，消息数: ${sessionAfterSecondMsg?.messages.length}`);

  // 恢复到刚才的检查点，验证能回退到第一条消息后的状态
  yield* Console.log("\n⏮️  恢复到检查点：回退到发送第二条消息前的状态");
  const restoredSession = yield* checkpointer.restore(checkpointId);
  if (restoredSession) {
    // 把恢复的会话覆盖到当前会话
    yield* sessionManager.update(session.id, (draft: any) => {
      draft.messages = restoredSession.messages;
    });
    const currentSessionAfterRestore = yield* agent.sessionManager.get(session.id);
    yield* Console.log(`✅ 恢复成功，当前消息数: ${currentSessionAfterRestore?.messages.length}`);
    if (currentSessionAfterRestore) {
      for (let idx = 0; idx < currentSessionAfterRestore.messages.length; idx++) {
        const msg = currentSessionAfterRestore.messages[idx];
        yield* Console.log(`   [${idx}] ${msg.role}: ${msg.content.slice(0, 50)}${msg.content.length > 50 ? "..." : ""}`);
      }
    }
  }

  // ---------------------------
  // 5. 测试重启恢复（模拟重启应用场景）
  // ---------------------------
  yield* Console.log("\n🔄 模拟应用重启：重新实例化所有组件，读取持久化的数据...");
  // 完全重新实例化，模拟重启
  const newStorage = new FileStorage();
  const newSessionManager = new PersistentSessionManager({ storage: newStorage });
  const newCheckpointer = new PersistentCheckpointer({ storage: newStorage });

  // 读取会话列表，验证重启后数据还在
  const allSessions = yield* newSessionManager.list();
  yield* Console.log(`✅ 重启后读取到会话总数: ${allSessions.length}`);
  for (const s of allSessions) {
    yield* Console.log(`   - 会话ID: ${s.id}，标题: ${(s.metadata as any)?.name ?? "无标题"}，消息数: ${s.messages.length}`);
  }

  // 读取刚才的会话
  const sessionAfterRestart = yield* newSessionManager.get(session.id);
  if (sessionAfterRestart) {
    yield* Console.log(`\n✅ 重启后读取到刚才的会话，消息数: ${sessionAfterRestart.messages.length}`);
    for (let idx = 0; idx < sessionAfterRestart.messages.length; idx++) {
      const msg = sessionAfterRestart.messages[idx];
      yield* Console.log(`   [${idx}] ${msg.role}: ${msg.content.slice(0, 50)}${msg.content.length > 50 ? "..." : ""}`);
    }
  }

  // 读取检查点列表
  const allCheckpoints = yield* newCheckpointer.list(session.id);
  yield* Console.log(`\n✅ 重启后读取到检查点总数: ${allCheckpoints.length}`);
  for (const cid of allCheckpoints) {
    yield* Console.log(`   - 检查点ID: ${cid}`);
  }

  yield* Console.log("\n🎉 所有持久化功能测试完成！数据已经成功持久化到磁盘，重启不会丢失。");
  yield* Console.log("\n📂 持久化数据存储位置: ~/.agentforge/storage");
});

// 运行测试
Effect.runPromise(run).catch(err => {
  console.error("\n❌ 测试失败:", err);
  process.exit(1);
});
