/**
 * AgentForge Phase 2 真实 LLM 验证
 *
 * 覆盖 Phase 2 新增的 6 个能力：
 *   P1  ProcessorResult 三态 (PipelineContext | AbortSignal | SuspensionSignal)
 *   P2  依赖注入 (AgentDependencies)
 *   P3  PipelineRunner unregister/replace
 *   P4  gateLLM / gateTool 门控 stage
 *   P5  全局 AbortSignal 透传
 *   P6  Agent teardown 生命周期
 *
 * 运行: npx tsx --env-file=examples/.env examples/phase2-demo.ts
 */

import {
  Agent,
  PipelineRunner,
  ToolRegistry,
  PluginManager,
  EventBus,
  HookManager,
  registerProvider,
} from '@agentforge/core';
import { OTelBridge } from '@agentforge/observability';
import type { SuspensionSignal, PipelineContext, Tracer } from '@agentforge/sdk';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

// ─── helpers ────────────────────────────────────────────────────────────────

const passed: string[] = [];
const failed: string[] = [];

function ok(tag: string, msg: string) {
  passed.push(tag);
  console.log(`  ✅ [${tag}] ${msg}`);
}

function fail(tag: string, msg: string, err?: unknown) {
  failed.push(tag);
  console.error(`  ❌ [${tag}] ${msg}`, err ?? '');
}

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Provider ───────────────────────────────────────────────────────────────

registerProvider('deepseek', (modelId: string) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未设置');
  const sdk = createOpenAICompatible({ baseURL: 'https://api.deepseek.com', apiKey } as any);
  return sdk.languageModel(modelId);
});

// ─── P2: 依赖注入 — 注入自定义 PipelineRunner + ToolRegistry ───────────────

section('P2  依赖注入');

let injectedRunnerUsed = false;
const customRunner = new PipelineRunner();
const customRegistry = new ToolRegistry();

const agentWithDeps = new Agent(
  { model: 'deepseek/deepseek-v4-flash', systemPrompt: '用中文简短回答。' },
  { runner: customRunner, registry: customRegistry },
);

if (agentWithDeps.pipelineRunner === customRunner) {
  ok('P2a', '注入的 PipelineRunner 被使用');
} else {
  fail('P2a', 'PipelineRunner 未被注入');
}

if (agentWithDeps.toolRegistry === customRegistry) {
  ok('P2b', '注入的 ToolRegistry 被使用');
} else {
  fail('P2b', 'ToolRegistry 未被注入');
}

// 验证注入的 runner 也能正常工作（hookManager 已被接线）
const depEventBus = agentWithDeps.pluginManager.eventBus;
if (depEventBus) {
  ok('P2c', '注入 runner 后 eventBus 仍可用');
} else {
  fail('P2c', 'eventBus 不可用');
}

// 用注入了 deps 的 agent 调用真实 LLM
async function testDI() {
  try {
    const response = await agentWithDeps.run('用一句话说：什么是依赖注入？');
    if (response.length > 0) {
      ok('P2d', `DI Agent 真实 LLM 回复: ${response.slice(0, 80)}...`);
    } else {
      fail('P2d', 'DI Agent 空回复');
    }
  } catch (e) {
    fail('P2d', 'DI Agent 运行失败', e);
  }
}

// ─── P3: unregister/replace — 替换 invokeLLM 为 mock ───────────────────────

section('P3  unregister/replace');

async function testReplace() {
  const agent = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '你好' });

  // 替换 invokeLLM 为返回固定响应的 processor
  agent.pipelineRunner.replace('invokeLLM', {
    stage: 'invokeLLM',
    execute: async (ctx) => ({
      ...ctx,
      iteration: {
        ...ctx.iteration,
        response: '[MOCK] 这是替换后的 LLM 响应',
        loopDirective: { action: 'stop' as const },
      },
    }),
  });

  const response = await agent.run('测试');
  if (response === '[MOCK] 这是替换后的 LLM 响应') {
    ok('P3a', 'replace 成功: invokeLLM 被 mock 替代');
  } else {
    fail('P3a', `replace 失败: 实际="${response.slice(0, 60)}"`);
  }

  // 测试 unregister
  const agent2 = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '你好' });
  agent2.pipelineRunner.unregister('processInput');
  // processInput 被移除后应该不影响运行（只是不做预处理）
  try {
    const r2 = await agent2.run('你好');
    if (r2.length > 0) {
      ok('P3b', `unregister 后 Agent 正常运行: ${r2.slice(0, 60)}...`);
    } else {
      fail('P3b', 'unregister 后空回复');
    }
  } catch (e) {
    fail('P3b', 'unregister 后运行失败', e);
  }
}

// ─── P4: gateLLM / gateTool 门控 stage ──────────────────────────────────────

section('P4  gateLLM / gateTool 门控 stage');

async function testGateStages() {
  // 4a: gateLLM 阻止 LLM 调用
  const blockedAgent = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '你好' });
  let gateChecked = false;

  blockedAgent.pipelineRunner.register({
    stage: 'gateLLM',
    execute: async (ctx) => {
      gateChecked = true;
      return { type: 'abort' as const, reason: 'gateLLM: 额度不足' };
    },
  });

  try {
    await blockedAgent.run('这应该被阻止');
    fail('P4a', 'gateLLM 应该阻止运行');
  } catch (e: any) {
    if (gateChecked && e.message.includes('gateLLM')) {
      ok('P4a', `gateLLM 成功阻止: ${e.message}`);
    } else {
      fail('P4a', `gateLLM 异常: ${e.message}`);
    }
  }

  // 4b: gateLLM 放行后正常调用 LLM
  const passAgent = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '用中文简短回答。' });
  let gatePassed = false;

  passAgent.pipelineRunner.register({
    stage: 'gateLLM',
    execute: async (ctx) => {
      gatePassed = true;
      return ctx; // 放行
    },
  });

  try {
    const response = await passAgent.run('1+1等于几？');
    if (gatePassed && response.length > 0) {
      ok('P4b', `gateLLM 放行后正常回复: ${response.slice(0, 60)}...`);
    } else {
      fail('P4b', 'gateLLM 放行后失败');
    }
  } catch (e) {
    fail('P4b', 'gateLLM 放行后运行失败', e);
  }

  // 4c: gateTool 触发 SuspensionSignal
  const suspendAgent = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '用中文回答。' });
  suspendAgent.pipelineRunner.register({
    stage: 'gateTool',
    execute: async (ctx) => ({
      type: 'suspend' as const,
      suspensionId: 'test-suspend-001',
      reason: '需要人工审批工具调用',
      checkpoint: { context: ctx, nextStages: ['executeTools'], iteration: ctx.iteration.step },
    }),
  });

  try {
    await suspendAgent.run('帮我算 1+1');
    fail('P4c', 'gateTool 应该 suspend');
  } catch (e: any) {
    if (e.message.includes('suspended')) {
      ok('P4c', `gateTool 成功 suspend: ${e.message}`);
    } else {
      fail('P4c', `gateTool 异常: ${e.message}`);
    }
  }
}

// ─── P5: AbortSignal 透传 ──────────────────────────────────────────────────

section('P5  AbortSignal 透传');

async function testAbortSignal() {
  // 5a: 预取消 — 在调用前就已经 abort
  const agent = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '你好' });
  const controller = new AbortController();
  controller.abort();

  try {
    await agent.run('这应该被取消', controller.signal);
    fail('P5a', '应该抛出 AbortError');
  } catch (e: any) {
    if (e.name === 'AbortError' || e.message.includes('abort')) {
      ok('P5a', `预取消成功: ${e.message}`);
    } else {
      fail('P5a', `取消异常: ${e.message}`);
    }
  }

  // 5b: 正常完成后取消 — 验证不干扰正常流程
  const agent2 = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '用中文简短回答。' });
  try {
    const response = await agent2.run('说"你好"', undefined);
    if (response.length > 0) {
      ok('P5b', `无 signal 时正常回复: ${response.slice(0, 60)}...`);
    }
  } catch (e) {
    fail('P5b', '无 signal 运行失败', e);
  }
}

// ─── P6: teardown 生命周期 ──────────────────────────────────────────────────

section('P6  teardown 生命周期');

async function testTeardown() {
  const bus = new EventBus();
  const otelExporter = new InMemorySpanExporter();
  const otelProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(otelExporter)],
  });
  const tracer = new OTelBridge({ tracerProvider: otelProvider, eventBus: bus });

  const agent = new Agent(
    { model: 'deepseek/deepseek-v4-flash', systemPrompt: '用中文简短回答。' },
    { tracer },
  );

  // 运行一次真实 LLM
  try {
    const response = await agent.run('说"测试成功"');
    if (response.length > 0) {
      ok('P6a', `teardown 前 LLM 正常: ${response.slice(0, 60)}...`);
    }
  } catch (e) {
    fail('P6a', 'teardown 前 LLM 失败', e);
  }

  // 调用 teardown
  try {
    await agent.teardown();
    ok('P6b', 'teardown() 成功调用');
  } catch (e) {
    fail('P6b', 'teardown 失败', e);
  }

  // 幂等性 — 第二次 teardown 不报错
  try {
    await agent.teardown();
    ok('P6c', 'teardown() 幂等 — 第二次调用不报错');
  } catch (e) {
    fail('P6c', 'teardown 非幂等', e);
  }
}

// ─── P1: ProcessorResult 三态 — 在真实 LLM 流程中触发 abort ───────────────

section('P1  ProcessorResult 三态 (真实 LLM)');

async function testThreeState() {
  // 通过自定义 Processor 在 buildContext stage 返回 SuspensionSignal
  const agent = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '你好' });
  agent.pipelineRunner.register({
    stage: 'buildContext',
    execute: async (ctx) => ({
      type: 'suspend' as const,
      suspensionId: 'real-llm-suspend',
      reason: '演示三态: 暂停在 buildContext',
      checkpoint: {
        context: ctx,
        nextStages: ['prepareStep', 'gateLLM', 'invokeLLM', 'processStepOutput', 'gateTool', 'executeTools', 'evaluateIteration'],
        iteration: 0,
      },
    }),
  });

  try {
    await agent.run('这应该在 buildContext 暂停');
    fail('P1', '应该被 suspend');
  } catch (e: any) {
    if (e.message.includes('suspended') && e.message.includes('演示三态')) {
      ok('P1', `SuspensionSignal 在真实管线中触发: ${e.message}`);
    } else {
      fail('P1', `suspend 异常: ${e.message}`);
    }
  }

  // 正常 AbortSignal
  const agent2 = new Agent({ model: 'deepseek/deepseek-v4-flash', systemPrompt: '你好' });
  agent2.pipelineRunner.register({
    stage: 'processInput',
    execute: async () => ({ type: 'abort' as const, reason: '演示三态: abort' }),
  });

  try {
    await agent2.run('这应该被 abort');
    fail('P1b', '应该被 abort');
  } catch (e: any) {
    if (e.message.includes('abort') && e.message.includes('演示三态')) {
      ok('P1b', `AbortSignal 在真实管线中触发: ${e.message}`);
    } else {
      fail('P1b', `abort 异常: ${e.message}`);
    }
  }
}

// ─── 综合测试: 所有 Phase 2 特性协同工作 ────────────────────────────────────

section('综合  DI + gate + teardown');

async function testIntegration() {
  const bus = new EventBus();
  let gateCallCount = 0;

  const runner = new PipelineRunner();
  const registry = new ToolRegistry();

  const agent = new Agent(
    {
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: '用中文简短回答，不超过20个字。',
      maxIterations: 1,
    },
    { runner, registry },
  );

  // 注册 gateLLM — 记录调用次数并放行
  runner.register({
    stage: 'gateLLM',
    execute: async (ctx) => {
      gateCallCount++;
      return ctx;
    },
  });

  try {
    const response = await agent.run('说"Phase 2 集成测试成功"');
    if (gateCallCount >= 1 && response.length > 0) {
      ok('INTa', `集成测试通过 — gateLLM 调用 ${gateCallCount} 次, 回复: ${response.slice(0, 80)}`);
    } else {
      fail('INTa', `gateCallCount=${gateCallCount}, response="${response}"`);
    }
  } catch (e) {
    fail('INTa', '集成测试失败', e);
  }

  await agent.teardown();
  ok('INTb', '集成测试 teardown 成功');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AgentForge Phase 2 — 真实 LLM 验证                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  try {
    // P2 DI + 真实 LLM
    await testDI();

    // P3 replace/unregister
    await testReplace();

    // P4 gateLLM/gateTool
    await testGateStages();

    // P5 AbortSignal
    await testAbortSignal();

    // P6 teardown
    await testTeardown();

    // P1 三态
    await testThreeState();

    // 综合
    await testIntegration();
  } catch (e) {
    console.error('致命错误:', e);
    process.exit(1);
  }

  // Summary
  section('验证结果');
  console.log(`\n  通过: ${passed.length}  失败: ${failed.length}`);
  if (failed.length > 0) {
    console.log(`  失败项: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('\n  Phase 2 所有验证通过!\n');
}

main();
