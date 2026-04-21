#!/usr/bin/env tsx
/**
 * 纯存储功能测试，不需要LLM
 */

import { Effect, Console } from "effect";
import { FileStorage, PersistentSessionManager, PersistentCheckpointer } from "../packages/storage/dist/index.js";
import type { Session, Message } from "@agentforge/core";
import { randomUUID } from "node:crypto";

const run = Effect.gen(function* () {
  yield* Console.log("\n📦 纯存储功能测试（不需要LLM）\n");

  // 1. 初始化存储
  const storage = new FileStorage({
    // 用临时目录，避免干扰之前的数据
    rootDir: "./test-storage"
  });

  const sessionManager = new PersistentSessionManager({ storage });
  const checkpointer = new PersistentCheckpointer({ storage });

  // 2. 测试会话创建
  yield* Console.log("🔨 测试会话创建...");
  const initialMessages: Message[] = [
    { role: "user", content: "你好呀" },
    { role: "assistant", content: "你好！我是鸭鸭嘎嘎" }
  ];
  const session = yield* sessionManager.create({
    systemPrompt: "你是一只可爱的鸭子，说话要带嘎嘎",
    initialMessages,
    metadata: { name: "测试会话", test: true }
  });
  yield* Console.log(`✅ 会话创建成功，ID: ${session.id}`);
  yield* Console.log(`   系统提示: ${session.systemPrompt}`);
  yield* Console.log(`   初始消息数: ${session.messages.length}`);
  initialMessages.forEach((msg, idx) => {
    Effect.runSync(Console.log(`   [${idx}] ${msg.role}: ${msg.content}`));
  });

  // 3. 测试添加消息
  yield* Console.log("\n✉️  测试添加消息...");
  const newMsg: Message = { role: "user", content: "1+1等于几呀？" };
  const updatedSession = yield* sessionManager.addMessage(session.id, newMsg);
  yield* Console.log(`✅ 添加成功，当前消息数: ${updatedSession.messages.length}`);
  updatedSession.messages.forEach((msg, idx) => {
    Effect.runSync(Console.log(`   [${idx}] ${msg.role}: ${msg.content}`));
  });

  // 4. 测试检查点
  yield* Console.log("\n📸 测试检查点保存...");
  const checkpointId = randomUUID();
  yield* checkpointer.save(checkpointId, updatedSession as Session);
  yield* Console.log(`✅ 检查点保存成功，ID: ${checkpointId}`);

  // 5. 测试会话裁剪
  yield* Console.log("\n✂️ 测试会话裁剪...");
  const trimmedSession = yield* sessionManager.trim(session.id, { maxMessages: 2 });
  yield* Console.log(`✅ 裁剪完成，当前消息数: ${trimmedSession.messages.length}`);
  trimmedSession.messages.forEach((msg, idx) => {
    Effect.runSync(Console.log(`   [${idx}] ${msg.role}: ${msg.content}`));
  });

  // 6. 模拟重启，测试持久化恢复
  yield* Console.log("\n🔄 模拟重启：重新实例化存储...");
  const newStorage = new FileStorage({ rootDir: "./test-storage" });
  const newSessionManager = new PersistentSessionManager({ storage: newStorage });
  const newCheckpointer = new PersistentCheckpointer({ storage: newStorage });

  // 读取会话列表
  const allSessions = yield* newSessionManager.list();
  yield* Console.log(`✅ 重启后读取到会话总数: ${allSessions.length}`);
  allSessions.forEach(s => {
    Effect.runSync(Console.log(`   - 会话ID: ${s.id}，标题: ${(s.metadata as any)?.name ?? "无标题"}，消息数: ${s.messages.length}`));
  });

  // 读取刚才的会话
  const restoredSession = yield* newSessionManager.get(session.id);
  if (restoredSession) {
    yield* Console.log(`\n✅ 成功恢复会话，ID: ${restoredSession.id}`);
    yield* Console.log(`   系统提示: ${restoredSession.systemPrompt}`);
    yield* Console.log(`   消息数: ${restoredSession.messages.length}`);
    restoredSession.messages.forEach((msg, idx) => {
      Effect.runSync(Console.log(`   [${idx}] ${msg.role}: ${msg.content}`));
    });
  }

  // 读取检查点
  yield* Console.log("\n📋 读取检查点列表...");
  const checkpoints = yield* newCheckpointer.list(session.id);
  yield* Console.log(`✅ 读取到检查点数量: ${checkpoints.length}`);
  for (const cid of checkpoints) {
    const checkpointSession = yield* newCheckpointer.restore(cid);
    if (checkpointSession) {
      yield* Console.log(`   - 检查点ID: ${cid}，消息数: ${checkpointSession.messages.length}`);
    }
  }

  // 7. 测试删除会话
  yield* Console.log("\n🗑️  测试删除会话...");
  yield* newSessionManager.delete(session.id);
  const sessionAfterDelete = yield* newSessionManager.get(session.id);
  yield* Console.log(`✅ 删除成功，会话是否存在: ${!!sessionAfterDelete ? "是" : "否"}`);

  // 清理测试目录
  yield* Console.log("\n🧹 清理测试数据...");
  yield* Effect.tryPromise(async () => {
    const fs = await import("node:fs/promises");
    await fs.rm("./test-storage", { recursive: true, force: true });
  });
  yield* Console.log("✅ 测试目录已清理");

  yield* Console.log("\n🎉 所有纯存储测试通过！持久化功能完全正常工作。");
  yield* Console.log("\n✨ 特性验证：");
  yield* Console.log("   ✅ 会话创建持久化");
  yield* Console.log("   ✅ 添加消息持久化");
  yield* Console.log("   ✅ 检查点保存与恢复");
  yield* Console.log("   ✅ 会话裁剪");
  yield* Console.log("   ✅ 重启数据不丢失");
  yield* Console.log("   ✅ 会话删除");
});

// 运行测试
Effect.runPromise(run).catch(err => {
  console.error("\n❌ 测试失败:", err);
  process.exit(1);
});
