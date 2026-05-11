/**
 * Async Sub-Agents 演示 (Issue 17)
 *
 * 演示异步子代理能力：
 *  - TaskManagerImpl — 异步任务管理器
 *  - ConcurrencyController — 并发槽位控制
 *  - EventBus — 任务生命周期事件
 *  - 取消任务
 *  - on_complete 回调收集结果
 *
 * 场景：并行翻译同一段文本到三种语言，取消其中一个，收集其余结果。
 *
 * 运行: npx tsx examples/async-demo.ts
 */

import {
  Agent,
  registerProvider,
  EventBus,
  ConcurrencyController,
  TaskManagerImpl,
} from '@agentforge/core';
import type { AsyncTaskConfig } from '@agentforge/sdk';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// ===========================================================================
// 0. Model Resolution — 注册 DeepSeek provider                    [Issue 03]
// ===========================================================================

registerProvider('deepseek', (modelId: string) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  } as any);
  return sdk.languageModel(modelId);
});

// ===========================================================================
// 1. 基础设施 — EventBus + ConcurrencyController                [Issue 17]
// ===========================================================================

const bus = new EventBus();

bus.subscribe('task:start', (data: any) =>
  console.log(`  [Event] task:start → ${data.taskId?.slice(0, 8)} config=${data.config?.name}`),
);
bus.subscribe('task:end', (data: any) =>
  console.log(`  [Event] task:end → ${data.taskId?.slice(0, 8)} ${data.error ? 'error' : 'ok'}`),
);
bus.subscribe('task:error', (data: any) =>
  console.log(`  [Event] task:error → ${data.taskId?.slice(0, 8)} ${data.error?.message}`),
);

const cc = new ConcurrencyController([{ key: 'translate', maxConcurrent: 2 }]);

// ===========================================================================
// 2. TaskManagerImpl — 自定义 runAgentFn                       [Issue 17]
// ===========================================================================

const tm = new TaskManagerImpl({
  eventBus: bus,
  concurrencyController: cc,
  runAgentFn: async (agentConfig, input, _signal) => {
    const taskAgent = new Agent(agentConfig, { eventBus: bus });
    const response = await taskAgent.run(input);
    return { response, tokenUsage: { input: 0, output: 0 }, sessionId: crypto.randomUUID() };
  },
});

// ===========================================================================
// 3. 启动 3 个并行翻译任务                                      [Issue 17]
// ===========================================================================

async function main() {
  console.log('=== AgentForge Async Sub-Agents 演示 (Issue 17) ===\n');

  const languages = ['英语', '日语', '法语'] as const;
  const sourceText = 'AgentForge 是一个功能强大的 AI Agent 框架';

  console.log(`[Async] 源文本: ${sourceText}`);
  console.log(`[Async] 目标语言: ${languages.join(', ')}\n`);

  // 启动 3 个并行翻译任务
  const handles = await Promise.all(
    languages.map((lang) =>
      tm.launch(
        {
          name: `translate-to-${lang}`,
          description: `翻译成${lang}`,
          model: 'deepseek/deepseek-v4-flash',
          systemPrompt: `你是翻译专家。将用户给你的文本翻译成${lang}。只输出翻译结果。`,
          contextPolicy: 'isolated',
          maxIterations: 1,
          concurrencySlot: { key: 'translate', maxConcurrent: 2 },
        } as any as AsyncTaskConfig,
        sourceText,
      ),
    ),
  );

  console.log(`[Async] 已启动 ${handles.length} 个翻译任务`);
  for (let i = 0; i < handles.length; i++) {
    console.log(`  ${languages[i]}: taskId=${handles[i].taskId.slice(0, 8)} status=${handles[i].status}`);
  }

  // ===========================================================================
  // 4. 取消法语翻译任务                                          [Issue 17]
  // ===========================================================================

  console.log('');
  handles[2].cancel(); // 取消法语翻译
  console.log(`[Async] 已取消: ${languages[2]} 翻译任务 (${handles[2].status})`);

  // ===========================================================================
  // 5. 收集结果 via on_complete                                [Issue 17]
  // ===========================================================================

  console.log('\n[Async] 等待翻译结果...');
  const results = new Map<string, string>();
  await new Promise<void>((resolveAll) => {
    let pending = 2;
    for (let i = 0; i < 2; i++) {
      handles[i].on_complete((result) => {
        results.set(languages[i], result.response);
        pending--;
        if (pending === 0) resolveAll();
      });
    }
    setTimeout(resolveAll, 60_000); // 安全超时
  });

  // ===========================================================================
  // 6. 打印结果和任务状态                                       [Issue 17]
  // ===========================================================================

  console.log('\n[Async] 翻译结果:');
  for (const [lang, text] of results) {
    console.log(`  ${lang}: ${text}`);
  }

  console.log('\n[Async] 任务状态:');
  const allTasks = tm.list();
  for (const t of allTasks) {
    console.log(`  ${t.taskId.slice(0, 8)} status=${t.status}`);
  }
  console.log(`[Async] 并发槽位: translate=${cc.getActiveCount('translate')}/2`);

  console.log('\n=== 演示完成 ===');
}

main().catch(console.error);
