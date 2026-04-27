/**
 * AgentForge 多轮对话示例
 *
 * 本示例展示如何使用 history 字段实现多轮对话上下文。
 *
 * 运行方式: npx tsx examples/12-multi-turn.ts
 */

import { createAgent } from '../src/api/create-agent.js';
import type { LLMAdapter, LLMResponse, Message } from '../src/core/interfaces.js';

// ============================================================
// Mock LLM Adapter
// ============================================================

class MockLLMAdapter implements LLMAdapter {
  readonly name = 'mock-llm';
  readonly provider = 'mock';

  async chat(messages: Message[]): Promise<LLMResponse> {
    const lastMessage = messages[messages.length - 1];
    const historyLength = messages.filter(m => m.role !== 'system').length;

    // 简单的回显逻辑，展示 LLM 能看到历史
    let response: string;

    if (
      lastMessage?.content.toLowerCase().includes('summarize') ||
      lastMessage?.content.toLowerCase().includes('discussed')
    ) {
      // 从历史中提取之前的消息
      const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
      response = `Based on our conversation, you asked about: ${userMessages.join(', ')}. We discussed these topics in ${historyLength} messages.`;
    } else if (lastMessage?.content.toLowerCase().includes('first')) {
      const firstUserMessage = messages.find(m => m.role === 'user');
      response = `Your first message was: "${firstUserMessage?.content || 'unknown'}"`;
    } else {
      response = `I received your message: "${lastMessage?.content}". This is message #${historyLength} in our conversation.`;
    }

    return {
      content: response,
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    };
  }

  stream() {
    return new (require('rxjs').Observable)();
  }
}

// ============================================================
// 示例 1: 基础多轮对话
// ============================================================

async function example_basic_multi_turn(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 1: 基础多轮对话');
  console.log('========================================\n');

  const agent = createAgent({
    name: 'multi-turn-agent',
    model: { provider: 'mock', model: 'mock' },
    llmAdapter: new MockLLMAdapter(),
    history: [
      { role: 'user', content: 'What is TypeScript?' },
      { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
      { role: 'user', content: 'What are its benefits?' },
      {
        role: 'assistant',
        content: 'Key benefits: type safety, better IDE support, easier refactoring.',
      },
    ],
    tools: [],
    maxSteps: 5,
  });

  // LLM 会看到完整的历史上下文
  const result = await agent.run('Can you summarize what we discussed?');
  console.log('Agent response:', result);
}

// ============================================================
// 示例 2: 动态构建历史
// ============================================================

async function example_dynamic_history(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 2: 动态构建历史');
  console.log('========================================\n');

  // 模拟从数据库加载历史
  const conversationHistory: Message[] = [
    { role: 'user', content: 'Hello, I need help with my project.' },
    {
      role: 'assistant',
      content: "I'd be happy to help! What kind of project are you working on?",
    },
    { role: 'user', content: "It's a web application using React and TypeScript." },
    {
      role: 'assistant',
      content: 'Great choice! React with TypeScript provides excellent developer experience.',
    },
  ];

  const agent = createAgent({
    name: 'dynamic-agent',
    model: { provider: 'mock', model: 'mock' },
    llmAdapter: new MockLLMAdapter(),
    history: conversationHistory,
    tools: [],
    maxSteps: 5,
  });

  // 新消息会自动添加到历史之后
  const result = await agent.run('What was my first message?');
  console.log('Agent response:', result);

  // 模拟保存新的对话消息
  const newHistory = [
    ...conversationHistory,
    { role: 'user' as const, content: 'What was my first message?' },
    { role: 'assistant' as const, content: result },
  ];
  console.log('\nUpdated history length:', newHistory.length);
}

// ============================================================
// 示例 3: 无历史（对比）
// ============================================================

async function example_no_history(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 3: 无历史（对比）');
  console.log('========================================\n');

  const agent = createAgent({
    name: 'no-history-agent',
    model: { provider: 'mock', model: 'mock' },
    llmAdapter: new MockLLMAdapter(),
    // 没有 history 字段
    tools: [],
    maxSteps: 5,
  });

  const result = await agent.run('What was my first message?');
  console.log('Agent response:', result);
  console.log('(Note: Agent has no history, so it cannot know the first message)');
}

// ============================================================
// 主入口
// ============================================================

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     AgentForge 多轮对话示例                              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  try {
    await example_basic_multi_turn();
    await example_dynamic_history();
    await example_no_history();

    console.log('\n========================================');
    console.log('所有示例运行完成！');
    console.log('========================================\n');
  } catch (error) {
    console.error('示例执行出错:', error);
    process.exit(1);
  }
}

// 运行主函数
main();
