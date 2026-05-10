/**
 * Sub-Agent 同步子代理示例
 *
 * 展示 @agentforge/core 的子代理能力：
 * - createSubAgentTool 工厂函数
 * - 三种上下文策略: isolated / inherit / summary-only
 * - EventBus 事件追踪
 * - 子代理错误处理
 *
 * 运行: npx tsx examples/sub-agent-demo.ts
 */

import { Agent, registerProvider, EventBus, createSubAgentTool } from '@agentforge/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
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
// 1. 定义子代理工具 — 翻译专家
// ---------------------------------------------------------------------------

const eventBus = new EventBus();
eventBus.subscribe('task:start', (data: any) => {
  console.log(`  [Event] task:start → ${data.name}`);
});
eventBus.subscribe('task:end', (data: any) => {
  if (data.error) {
    console.log(`  [Event] task:end → ${data.name} (error: ${data.error})`);
  } else {
    console.log(`  [Event] task:end → ${data.name} (response: ${data.result.response.slice(0, 50)}...)`);
  }
});

const translatorTool = createSubAgentTool(
  {
    name: 'translator',
    description: '将用户给出的文本翻译成英文。调用时传入 task 字段，内容为需要翻译的中文文本。',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你是一个专业翻译。用户给你中文文本，你只需返回英文翻译，不要解释。',
    contextPolicy: 'isolated',
    maxIterations: 1,
    inputSchema: z.object({ task: z.string() }),
  },
  {
    model: 'deepseek/deepseek-v4-flash',
    tools: [],
    eventBus,
  },
);

// ---------------------------------------------------------------------------
// 2. 定义子代理工具 — 代码审查员 (summary-only)
// ---------------------------------------------------------------------------

const codeReviewerTool = createSubAgentTool(
  {
    name: 'codeReviewer',
    description: '审查用户给出的代码片段，指出潜在问题。调用时传入 task 字段，内容为代码片段。',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你是一个代码审查专家。简要指出代码中的问题，不超过3条。',
    contextPolicy: 'summary-only',
    maxIterations: 1,
    inputSchema: z.object({ task: z.string() }),
  },
  {
    model: 'deepseek/deepseek-v4-flash',
    tools: [],
    eventBus,
    getSessionState: () => ({
      messageHistory: [
        { role: 'user', content: '我们在做一个 TypeScript Agent 框架' },
        { role: 'assistant', content: '了解，你们在构建 AgentForge' },
      ],
    }),
  },
);

// ---------------------------------------------------------------------------
// 3. 运行主 Agent
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Sub-Agent 同步子代理示例 ===\n');

  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: [
      '你是一个助手，可以调用子代理完成任务。',
      '当用户要求翻译时，调用 translator 子代理。',
      '当用户要求审查代码时，调用 codeReviewer 子代理。',
      '将子代理返回的结果直接展示给用户。',
    ].join('\n'),
    tools: [translatorTool, codeReviewerTool],
    maxIterations: 3,
  });

  // 测试 1: 翻译任务
  const query1 = '请把这句话翻译成英文：今天天气真好，适合出去散步。';
  console.log(`用户: ${query1}\n`);

  let full = '';
  for await (const chunk of agent.stream(query1)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log('\n');
  console.log(`--- 回复 ${full.length} 字符 ---\n`);

  // 测试 2: 代码审查
  console.log('--- 测试代码审查子代理 ---\n');
  const query2 = '请审查这段代码: function add(a: any, b: any) { return a + b; }';
  console.log(`用户: ${query2}\n`);

  full = '';
  for await (const chunk of agent.stream(query2)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log('\n');
  console.log(`--- 回复 ${full.length} 字符 ---`);
}

main().catch(console.error);
