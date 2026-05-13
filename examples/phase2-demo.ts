/**
 * AgentForge Phase 2 — 真实场景演示
 *
 * 用真实 DeepSeek LLM 演示 Phase 2 的 6 个能力，每个都有实际动机：
 *   1. 依赖注入 — 测试时注入 mock，生产时注入真实组件
 *   2. gateLLM — 调用前检查配额/限流
 *   3. gateTool — 执行工具前要求人工审批
 *   4. AbortSignal — 用户取消长时间运行的任务
 *   5. replace — 替换 LLM 为本地 mock 进行快速测试
 *   6. teardown — Agent 用完后清理资源
 *
 * 运行: npx tsx --env-file=examples/.env examples/phase2-demo.ts
 */

import {
  Agent,
  PipelineRunner,
  ToolRegistry,
  EventBus,
  registerProvider,
} from '@agentforge/core';
import type { PipelineContext } from '@agentforge/sdk';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

// ─── Setup ──────────────────────────────────────────────────────────────────

registerProvider('deepseek', (modelId: string) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未设置');
  const sdk = createOpenAICompatible({ baseURL: 'https://api.deepseek.com', apiKey } as any);
  return sdk.languageModel(modelId);
});

const log = (...args: unknown[]) => console.log('  ', ...args);
const hr = (title: string) => console.log(`\n── ${title} ${'─'.repeat(56 - title.length)}`);

// 一个简单的工具，用于 gateTool 演示
const dangerousTool = {
  name: 'deleteRecords',
  description: '删除数据库中的记录（危险操作）',
  inputSchema: z.object({ table: z.string(), where: z.string() }),
  execute: async ({ table, where }: { table: string; where: string }) =>
    `已删除 ${table} 中满足 ${where} 的记录`,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 依赖注入 — 注入自定义组件
// ═══════════════════════════════════════════════════════════════════════════════

async function demo_dependency_injection() {
  hr('1. 依赖注入');

  const runner = new PipelineRunner();
  const registry = new ToolRegistry();

  const agent = new Agent(
    { model: 'deepseek/deepseek-v4-flash', systemPrompt: '用中文简短回答。' },
    { runner, registry },
  );

  log('注入了自定义 PipelineRunner 和 ToolRegistry');
  log('pipelineRunner === 注入的 runner?', agent.pipelineRunner === runner);
  log('toolRegistry === 注入的 registry?', agent.toolRegistry === registry);

  const reply = await agent.run('一句话解释依赖注入');
  log('LLM:', reply.response.slice(0, 100));

  await agent.teardown();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. gateLLM — LLM 调用前的配额检查
// ═══════════════════════════════════════════════════════════════════════════════

async function demo_gate_llm() {
  hr('2. gateLLM — 配额检查');

  // 场景 A: 配额充足，放行
  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '用中文回答，不超过15个字。',
  });

  agent.pipelineRunner.register({
    stage: 'gateLLM',
    execute: async (ctx: PipelineContext) => {
      log('[gateLLM] 检查配额... 剩余 100 次，放行');
      return ctx;
    },
  });

  const reply = await agent.run('1+1=?');
  log('LLM 回复:', reply.response.slice(0, 60));

  // 场景 B: 配额耗尽，阻止
  const agent2 = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你好',
  });

  agent2.pipelineRunner.register({
    stage: 'gateLLM',
    execute: async () => {
      log('[gateLLM] 检查配额... 已耗尽，拒绝');
      return { type: 'abort' as const, reason: 'API 配额已用完' };
    },
  });

  try {
    await agent2.run('你好');
  } catch (e: any) {
    log('被 gateLLM 阻止:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. gateTool — 危险工具执行前的人工审批
// ═══════════════════════════════════════════════════════════════════════════════

async function demo_gate_tool() {
  hr('3. gateTool — 危险操作审批');

  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你是数据库管理员。用户要求操作时，使用 deleteRecords 工具。',
    tools: [dangerousTool],
    maxIterations: 3,
  });

  // 注册 gateTool: 所有危险工具需要人工审批
  agent.pipelineRunner.register({
    stage: 'gateTool',
    execute: async (ctx: PipelineContext) => {
      const toolCalls = ctx.iteration.pendingToolCalls;
      if (toolCalls?.some(tc => tc.name === 'deleteRecords')) {
        log('[gateTool] 检测到 deleteRecords 调用，暂停等待人工审批');
        return {
          type: 'suspend' as const,
          suspensionId: `approval-${Date.now()}`,
          reason: 'deleteRecords 需要人工审批',
          checkpoint: {
            context: ctx,
            nextStages: ['executeTools', 'evaluateIteration'],
            iteration: ctx.iteration.step,
          },
        };
      }
      return ctx;
    },
  });

  try {
    await agent.run('删除 users 表中 status=inactive 的记录');
  } catch (e: any) {
    log('管线暂停:', e.message);
    log('→ 调用方可以拿到 suspensionId，等待人工确认后 resume');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. AbortSignal — 用户取消正在进行的请求
// ═══════════════════════════════════════════════════════════════════════════════

async function demo_abort_signal() {
  hr('4. AbortSignal — 取消请求');

  // 场景 A: 预取消（用户点了取消后才开始处理）
  const controller = new AbortController();
  controller.abort();
  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你好',
  });

  try {
    await agent.run('你好', controller.signal);
  } catch (e: any) {
    log('预取消:', e.message);
  }

  // 场景 B: streaming 中取消
  const agent2 = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '写一首关于编程的短诗。',
  });

  log('开始 streaming...');
  let chars = 0;
  const streamController = new AbortController();

  // 500ms 后取消
  setTimeout(() => {
    streamController.abort();
    log('用户在 500ms 后取消了请求');
  }, 500);

  try {
    for await (const chunk of agent2.stream('写诗', streamController.signal)) {
      process.stdout.write(chunk);
      chars += chunk.length;
    }
  } catch (e: any) {
    log(`\nstreaming 被取消，已收到 ${chars} 字符`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. replace — 替换 LLM 为 mock，跳过真实 API 调用
// ═══════════════════════════════════════════════════════════════════════════════

async function demo_replace() {
  hr('5. replace — mock LLM');

  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你好',
  });

  // 不调用真实 LLM，直接返回固定响应
  agent.pipelineRunner.replace('invokeLLM', {
    stage: 'invokeLLM',
    execute: async (ctx: PipelineContext) => ({
      ...ctx,
      iteration: {
        ...ctx.iteration,
        response: '这是一条 mock 回复，没有调用任何 LLM。',
        loopDirective: { action: 'stop' as const },
      },
    }),
  });

  const reply = await agent.run('随便什么');
  log('回复:', reply.response);
  log('→ 不消耗 API token，适合本地开发和测试');

  // 恢复真实 LLM：先 unregister mock，再注册真实 processor
  agent.pipelineRunner.unregister('invokeLLM');
  // 内置 processor 已经注册过，但 unregister 只移除了 mock
  // 实际使用中可以通过 replace 换回来
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. teardown — 用完后清理资源
// ═══════════════════════════════════════════════════════════════════════════════

async function demo_teardown() {
  hr('6. teardown — 清理资源');

  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '用中文简短回答。',
  });

  const reply = await agent.run('说"你好"');
  log('LLM:', reply.response.slice(0, 60));

  // 用完后清理：停止插件资源、取消事件订阅
  await agent.teardown();
  log('teardown 完成');

  // teardown 是幂等的，多次调用不会报错
  await agent.teardown();
  log('第二次 teardown 也成功（幂等）');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n  AgentForge Phase 2 — 真实场景演示\n');

  await demo_dependency_injection();
  await demo_gate_llm();
  await demo_gate_tool();
  await demo_abort_signal();
  await demo_replace();
  await demo_teardown();

  console.log('\n  全部演示完成。\n');
}

main().catch((e) => {
  console.error('错误:', e);
  process.exit(1);
});
