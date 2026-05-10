/**
 * Plugin System 示例（接入真实 LLM）
 *
 * 展示 @agentforge/core 的完整插件系统：
 * - PluginManager + EventBus + Hook + Resource 生命周期
 * - 插件注册 Processor + Tool + Hook + Resource + Subscribe
 * - Agent 接入 DeepSeek 真实 LLM，流式输出
 * - 插件在 pipeline 中拦截、增强、监控 LLM 调用
 *
 * 运行: npx tsx examples/plugin-demo.ts
 */

import { Agent, PluginManager, registerProvider } from '@agentforge/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { HarnessAPI, PluginRegistration, Processor, Tool, Hook, ResourceDeclaration } from '@agentforge/sdk';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 0. 注册 DeepSeek provider
// ---------------------------------------------------------------------------

registerProvider('deepseek', (modelId) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  });
  return sdk.languageModel(modelId);
});

// ---------------------------------------------------------------------------
// 1. 定义插件 — 监控 + 工具 + 资源
// ---------------------------------------------------------------------------

function monitoringPlugin(api: HarnessAPI): PluginRegistration {
  // Processor: buildContext 阶段注入时间戳
  api.registerProcessor('buildContext', {
    stage: 'buildContext',
    execute: async (ctx) => {
      console.log('[Plugin] buildContext — 注入 startTime');
      return { ...ctx, pipeline: { ...ctx.pipeline, startTime: Date.now() } };
    },
  });

  // Processor: processOutput 阶段计算耗时
  api.registerProcessor('processOutput', {
    stage: 'processOutput',
    execute: async (ctx) => {
      const elapsed = Date.now() - ((ctx.pipeline.startTime as number) ?? 0);
      console.log(`[Plugin] processOutput — 总耗时 ${elapsed}ms`);
      return ctx;
    },
  });

  // Hook: llm.before 打印 prompt 长度
  api.registerHook({
    point: 'llm.before',
    handler: (data) => {
      console.log(`[Hook:llm.before] 即将调用 LLM，prompt 信息:`, data);
    },
  });

  // 订阅 EventBus 事件
  api.subscribe('agent:start', (data) => {
    console.log(`[Event:agent:start] 会话启动:`, data);
  });

  // 声明 Resource：模拟监控服务
  api.registerResource({
    id: 'monitor',
    type: 'service',
    config: {},
    start: async () => {
      console.log('[Resource:monitor] 监控服务启动');
      return { status: 'running' };
    },
    stop: async () => {
      console.log('[Resource:monitor] 监控服务关闭');
    },
  });

  return {};
}

// 插件 2: 注册一个本地工具
function calculatorPlugin(api: HarnessAPI): PluginRegistration {
  const calcTool: Tool<{ expression: string }, string> = {
    name: 'calculator',
    description: '计算简单的数学表达式，返回结果。输入为表达式字符串，如 "2+3" 或 "10*5"',
    inputSchema: z.object({ expression: z.string().describe('数学表达式') }),
    execute: async ({ expression }) => {
      // 仅支持基本运算
      const safe = /^[\d+\-*/().\s]+$/.test(expression);
      if (!safe) return '不支持的表达式';
      try {
        const result = Function(`"use strict"; return (${expression})`)();
        return `${expression} = ${result}`;
      } catch {
        return `计算错误: ${expression}`;
      }
    },
  };
  api.registerTool(calcTool as Tool);

  api.subscribe('agent:start', () => {
    console.log('[Plugin:calculator] 已就绪，calculator 工具已注册');
  });

  return { tools: [calcTool as Tool] };
}

// ---------------------------------------------------------------------------
// 2. 主流程
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== AgentForge Plugin Demo (真实 LLM) ===\n');

  // 创建 Agent（接入 DeepSeek）
  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: [
      '你是一个智能助手，可以用中文回答问题。',
      '如果用户让你计算，使用 calculator 工具。',
      '回答要简洁有趣。',
    ].join('\n'),
    maxIterations: 5,
  });

  // 创建 PluginManager，绑定到 Agent 的 runner 和 registry
  const manager = new PluginManager(agent.pipelineRunner, agent.toolRegistry);

  // 加载插件
  manager.initializePlugin(monitoringPlugin);
  manager.initializePlugin(calculatorPlugin);
  console.log('[Main] 插件已加载\n');

  // 启动所有资源
  await manager.initializeAll();
  console.log('[Main] 资源已启动\n');

  // 触发 agent:start 事件
  manager.emitEvent('agent:start', { sessionId: 'plugin-demo-001' });
  console.log();

  // ---- 第一次对话：普通问答 ----
  const query1 = '你好！请用一句话介绍你自己。';
  console.log(`用户: ${query1}`);
  console.log('助手: ');

  let full = '';
  for await (const chunk of agent.stream(query1)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log(`\n--- 回复 ${full.length} 字符 ---\n`);

  // ---- 第二次对话：使用工具 ----
  const query2 = '帮我算一下 123 * 456 + 789 等于多少？';
  console.log(`用户: ${query2}`);
  console.log('助手: ');

  full = '';
  for await (const chunk of agent.stream(query2)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log(`\n--- 回复 ${full.length} 字符 ---\n`);

  // Shutdown
  console.log('--- 关闭 ---');
  await manager.shutdown();
  console.log('[Main] 所有资源已关闭，订阅已清理');
  console.log(`[Main] 错误数: ${manager.getErrors().length}`);

  console.log('\n=== Demo 完成 ===');
}

main().catch(console.error);
