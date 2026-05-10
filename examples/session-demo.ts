/**
 * Session Suspend/Resume 示例
 *
 * 用真实 LLM 演示 session 持久化流程：
 * 1. 创建 Agent 并运行查询，EventBus 自动将生命周期事件写入 JSONL
 * 2. 查看持久化的事件记录
 * 3. suspend 会话
 * 4. restore + resume 继续执行
 *
 * 运行: npx tsx examples/session-demo.ts
 */

import { Agent, registerProvider, EventBus, FilesystemSessionStorage, SessionPersistence, SessionManagerImpl } from '@agentforge/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

registerProvider('deepseek', (modelId) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  });
  return sdk.languageModel(modelId);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 设置 session 持久化
  const basePath = mkdtempSync(join(tmpdir(), 'agentforge-session-'));
  const bus = new EventBus();
  const storage = new FilesystemSessionStorage(basePath);
  const persistence = new SessionPersistence(bus, storage);
  const sessionMgr = new SessionManagerImpl(storage, bus);

  try {
    console.log('=== Session Suspend/Resume 演示 ===\n');

    // 1. 创建 session 并运行 agent
    const record = await sessionMgr.start('请用一句话介绍 AgentForge 是什么');
    console.log(`[Session] 创建会话: ${record.sessionId}`);

    const agent = new Agent({
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: '你是一个简洁的技术助手。用中文回答，控制在50字以内。',
      maxIterations: 3,
    });

    // 通过自定义 processor 发射生命周期事件
    agent.use({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        bus.emit('stage.complete', { sessionId: record.sessionId, stage: 'invokeLLM' });
        return ctx;
      },
    });

    agent.use({
      stage: 'evaluateIteration',
      execute: async (ctx) => {
        const response = ctx.pipeline.response as string | undefined;
        bus.emit('iteration.end', {
          sessionId: record.sessionId,
          step: ctx.iteration.step,
          response: response?.slice(0, 200),
        });
        return ctx;
      },
    });

    console.log('\n[Agent] 第一轮查询:');
    const answer = await agent.run('请用一句话介绍 AgentForge 是什么');
    console.log(`  回答: ${answer}\n`);

    // 2. 等待持久化完成，查看 JSONL
    await persistence.stop();
    const jsonlPath = join(basePath, record.sessionId, 'events.jsonl');
    const content = readFileSync(jsonlPath, 'utf-8');
    const eventCount = content.split('\n').filter(l => l.trim()).length;
    console.log(`[JSONL] 持久化 ${eventCount} 条事件到 ${jsonlPath}`);

    // 重新启动 persistence（模拟恢复后继续）
    const persistence2 = new SessionPersistence(bus, storage);

    // 3. Suspend
    await sessionMgr.suspend(record.sessionId, '用户主动暂停，等待确认');
    console.log(`\n[Suspend] 会话已挂起`);

    await persistence2.stop();

    // 4. Restore
    const restored = await sessionMgr.restore(record.sessionId);
    console.log(`[Restore] 恢复上下文: input="${restored.request.input}", step=${restored.iteration.step}`);
    const history = (restored.session as Record<string, unknown>).messageHistory as Array<Record<string, unknown>>;
    console.log(`[Restore] 消息历史 ${history.length} 条`);

    // 5. Resume — 创建子会话继续
    const newSessionId = await sessionMgr.resume(record.sessionId, '确认继续，请详细解释一下');
    console.log(`\n[Resume] 新会话: ${newSessionId}, 父会话: ${record.sessionId}`);

    // 6. 列出所有会话
    const all = await sessionMgr.list();
    console.log(`\n[会话列表] 共 ${all.length} 个:`);
    for (const s of all) {
      console.log(`  ${s.sessionId.slice(0, 8)}... status=${s.status}${s.parentSessionId ? ` parent=${s.parentSessionId.slice(0, 8)}...` : ''}`);
    }

    console.log('\n=== 演示完成 ===');
  } finally {
    rmSync(basePath, { recursive: true, force: true });
  }
}

main().catch(console.error);
