/**
 * AgentForge Memory Management and Compaction Example
 *
 * 本示例展示：
 * 1. CompactionManager 创建与配置
 * 2. trim/recall/shouldCompact 使用方法
 * 3. 不同压缩策略（truncate-oldest, summarize, importance-weighted）
 * 4. Token 计数与阈值触发
 *
 * 运行方式：npx tsx examples/09-memory.ts
 */

import { z } from 'zod';
import {
  CompactionManager,
  createCompactionManager,
  createTruncateCompactionManager,
  createSummarizeCompactionManager,
  createDisabledCompactionManager,
  type CompactionConfig,
  type CompactionContext,
  type CompactionEventPayload,
  truncateOldest,
  summarize,
  importanceWeighted,
  estimateTokens,
  estimateMessageTokens,
  type CompactionResult,
  type PreserveConfig,
} from '../src/memory/index.js';
import type { Message } from '../src/core/events.js';
import type { LLMAdapter, LLMResponse, LLMChunk, LLMOptions } from '../src/core/interfaces.js';

// ============================================================
// Mock Data: 模拟消息历史
// ============================================================

/**
 * 创建模拟消息数组
 *
 * 用于演示不同压缩策略的效果。
 */
function createMockMessages(count: number): Message[] {
  const messages: Message[] = [
    // 系统消息
    { role: 'system', content: '你是一个智能助手，帮助用户完成任务。你有多种工具可以使用。' },
    // 用户消息
    { role: 'user', content: '你好，请帮我分析一下这个项目的代码结构。' },
    // 助手响应
    { role: 'assistant', content: '好的，我来帮你分析项目结构。首先让我查看项目的目录结构...' },
    // 工具结果
    { role: 'tool', content: '项目包含 src/、tests/、docs/ 三个主要目录。', toolCallId: 'tc-001' },
    // 更多对话...
    { role: 'user', content: '请详细说明 src 目录下的模块划分。' },
    {
      role: 'assistant',
      content:
        'src 目录包含以下核心模块：core（核心类型）、loop（Agent 循环）、operators（操作符）...',
    },
  ];

  // 添加更多历史消息
  for (let i = 0; i < count - 7; i++) {
    const roleIndex = i % 3;
    if (roleIndex === 0) {
      messages.push({
        role: 'user',
        content: `用户问题 #${i + 1}：请解释第 ${i + 1} 个功能模块的作用。`,
      });
    } else if (roleIndex === 1) {
      messages.push({
        role: 'assistant',
        content: `助手回答 #${i + 1}：第 ${i + 1} 个模块负责...`,
      });
    } else {
      messages.push({
        role: 'tool',
        content: `工具结果 #${i + 1}：执行成功，返回数据...`,
        toolCallId: `tc-${i + 1}`,
      });
    }
  }

  return messages;
}

/**
 * 模拟 LLM 适配器
 *
 * 用于 summarize 策略的演示。
 */
class MockLLMAdapter implements LLMAdapter {
  readonly name = 'mock-llm';
  readonly provider = 'mock';

  async chat(messages: Message[], _options?: LLMOptions): Promise<LLMResponse> {
    // 模拟 LLM 响应
    const historySummary = messages
      .filter(m => m.role === 'user')
      .slice(0, 5)
      .map(m => m.content.slice(0, 50))
      .join('; ');

    return {
      content: `对话历史摘要：讨论了项目架构、核心模块、代码结构等 ${messages.length} 条消息。主要话题包括：${historySummary}...`,
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50 },
    };
  }

  async *stream(messages: Message[], _options?: LLMOptions): AsyncGenerator<LLMChunk> {
    // 模拟流式响应
    const response = `对话历史摘要：讨论了项目架构、核心模块、代码结构等 ${messages.length} 条消息...`;
    yield { text: response };
  }
}

// ============================================================
// Example 1: Basic Compaction with Truncate Strategy
// ============================================================

/**
 * 示例 1: 基础压缩 - Truncate-Oldest 策略
 *
 * 最简单的策略：移除最旧的消息，保留最近 N 条。
 */
async function example1_truncateOldest(): Promise<void> {
  console.log('\n=== 示例 1: Truncate-Oldest 策略 ===\n');

  // 创建消息历史（30 条消息）
  const messages = createMockMessages(30);
  const maxTokens = 2000; // 模拟上下文窗口限制

  // 创建 CompactionManager（使用 truncate-oldest 策略）
  const manager = createTruncateCompactionManager(10);

  // 创建压缩上下文
  const context: CompactionContext = {
    sessionId: 'session-truncate-001',
    messages,
    currentTokenEstimate: estimateTokens(messages),
    maxTokens,
  };

  console.log('压缩前状态:');
  console.log(`  消息数: ${messages.length}`);
  console.log(`  Token 估算: ${context.currentTokenEstimate}`);
  console.log(
    `  阈值: ${maxTokens} (触发阈值: ${(manager.getConfig().triggerThreshold * maxTokens).toFixed(0)})`
  );

  // 检查是否需要压缩
  const needsCompaction = manager.needsCompaction(context);
  console.log(`  需要压缩: ${needsCompaction}`);

  if (needsCompaction) {
    // 执行压缩
    const result = await manager.compact(context);

    console.log('\n压缩后状态:');
    console.log(`  消息数: ${result.messages.length}`);
    console.log(`  Token 估算: ${result.tokensAfter}`);
    console.log(`  移除消息数: ${result.removedCount}`);
    console.log(`  Token 减少: ${result.tokensBefore - result.tokensAfter}`);
    console.log(`  使用策略: ${result.strategy}`);
  }
}

// ============================================================
// Example 2: Summarize Strategy with LLM
// ============================================================

/**
 * 示例 2: 摘要压缩策略
 *
 * 使用 LLM 生成对话历史摘要，保留关键上下文。
 */
async function example2_summarize(): Promise<void> {
  console.log('\n=== 示例 2: Summarize 策略 ===\n');

  // 创建消息历史（25 条消息）
  const messages = createMockMessages(25);
  const maxTokens = 1500;

  // 创建模拟 LLM 适配器
  const llmAdapter = new MockLLMAdapter();

  // 创建 CompactionManager（使用 summarize 策略）
  const manager = createSummarizeCompactionManager(llmAdapter, 8, 300);

  // 创建压缩上下文
  const context: CompactionContext = {
    sessionId: 'session-summarize-001',
    messages,
    currentTokenEstimate: estimateTokens(messages),
    maxTokens,
  };

  console.log('压缩前状态:');
  console.log(`  消息数: ${messages.length}`);
  console.log(`  Token 估算: ${context.currentTokenEstimate}`);

  // 直接调用 summarize 函数
  const result = await summarize(messages, 8, llmAdapter, 300);

  console.log('\n压缩后状态:');
  console.log(`  消息数: ${result.messages.length}`);
  console.log(`  Token 估算: ${result.tokensAfter}`);
  console.log(`  移除消息数: ${result.removedCount}`);
  console.log(`  摘要消息数: ${result.summarizedCount ?? 0}`);

  if (result.summary) {
    console.log(`\n生成的摘要:`);
    console.log(`  "${result.summary.slice(0, 100)}..."`);
  }

  // 显示摘要消息
  const summaryMessage = result.messages[0];
  if (summaryMessage?.role === 'system' && summaryMessage.name === 'compaction-summary') {
    console.log('\n摘要消息内容:');
    console.log(`  角色: ${summaryMessage.role}`);
    console.log(`  名称: ${summaryMessage.name}`);
  }
}

// ============================================================
// Example 3: Importance-Weighted Strategy
// ============================================================

/**
 * 示例 3: 基于重要性的压缩策略
 *
 * 根据消息重要性评分决定保留哪些消息。
 */
async function example3_importanceWeighted(): Promise<void> {
  console.log('\n=== 示例 3: Importance-Weighted 策略 ===\n');

  // 创建包含多种消息类型的历史
  const messages: Message[] = [
    { role: 'system', content: '系统提示词，定义助手行为...' },
    { role: 'user', content: '请帮我分析数据' },
    { role: 'assistant', content: '好的，我来分析...' },
    { role: 'tool', content: 'error: 数据加载失败', toolCallId: 'tc-1' },
    { role: 'assistant', content: '遇到错误，让我重试...' },
    { role: 'tool', content: '数据加载成功', toolCallId: 'tc-2' },
    { role: 'user', content: '继续分析' },
    { role: 'assistant', content: '分析结果如下...' },
    { role: 'user', content: '这个结论是什么意思？' },
    { role: 'assistant', content: '这个结论表示...' },
  ];

  // 添加更多消息以达到需要压缩的状态
  for (let i = 0; i < 20; i++) {
    messages.push({ role: 'user', content: `问题 #${i + 1}` });
    messages.push({ role: 'assistant', content: `回答 #${i + 1}` });
  }

  const maxTokens = 800;
  const targetTokens = 400;

  console.log('压缩前状态:');
  console.log(`  消息数: ${messages.length}`);
  console.log(`  Token 估算: ${estimateTokens(messages)}`);
  console.log(`  目标 Token: ${targetTokens}`);

  // 使用 importanceWeighted 策略
  const result = importanceWeighted(messages, 5, targetTokens);

  console.log('\n压缩后状态:');
  console.log(`  消息数: ${result.messages.length}`);
  console.log(`  Token 估算: ${result.tokensAfter}`);
  console.log(`  移除消息数: ${result.removedCount}`);
  console.log(`  Token 减少: ${result.tokensBefore - result.tokensAfter}`);

  // 分析保留的消息类型分布
  const roleCounts = result.messages.reduce(
    (acc, m) => {
      acc[m.role] = (acc[m.role] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log('\n保留消息类型分布:');
  for (const [role, count] of Object.entries(roleCounts)) {
    console.log(`  ${role}: ${count}`);
  }
}

// ============================================================
// Example 4: Custom Preserve Configuration
// ============================================================

/**
 * 示例 4: 自定义保留配置
 *
 * 精细控制哪些消息需要保留。
 */
async function example4_customPreserveConfig(): Promise<void> {
  console.log('\n=== 示例 4: 自定义保留配置 ===\n');

  // 创建消息历史
  const messages = createMockMessages(40);

  // 自定义保留配置
  const preserveConfig: PreserveConfig = {
    systemPrompt: true, // 保留系统提示
    lastNUserMessages: 3, // 保留最近 3 条用户消息
    lastNToolResults: 5, // 保留最近 5 条工具结果
    preserveIndices: [5, 10], // 额外保留特定索引的消息
  };

  console.log('自定义保留配置:');
  console.log(`  保留系统提示: ${preserveConfig.systemPrompt}`);
  console.log(`  保留最近用户消息: ${preserveConfig.lastNUserMessages}`);
  console.log(`  保留最近工具结果: ${preserveConfig.lastNToolResults}`);
  console.log(`  额外保留索引: ${preserveConfig.preserveIndices?.join(', ') ?? '无'}`);

  // 使用 truncateOldest 并传入自定义配置
  const result = truncateOldest(messages, 15, preserveConfig);

  console.log('\n压缩结果:');
  console.log(`  原始消息数: ${messages.length}`);
  console.log(`  压缩后消息数: ${result.messages.length}`);
  console.log(`  Token 减少: ${result.tokensBefore - result.tokensAfter}`);

  // 验证保留的消息
  console.log('\n验证保留策略:');
  const systemMessages = result.messages.filter(m => m.role === 'system');
  const userMessages = result.messages.filter(m => m.role === 'user');
  const toolMessages = result.messages.filter(m => m.role === 'tool');

  console.log(`  系统消息保留: ${systemMessages.length}`);
  console.log(`  用户消息保留: ${userMessages.length} (配置: ${preserveConfig.lastNUserMessages})`);
  console.log(`  工具消息保留: ${toolMessages.length} (配置: ${preserveConfig.lastNToolResults})`);
}

// ============================================================
// Example 5: CompactionManager with Event Observability
// ============================================================

/**
 * 示例 5: CompactionManager 事件可观测性
 *
 * 订阅压缩事件，监控压缩行为。
 */
async function example5_eventObservability(): Promise<void> {
  console.log('\n=== 示例 5: 事件可观测性 ===\n');

  const messages = createMockMessages(35);
  const maxTokens = 1800;

  // 创建 CompactionManager
  const manager = new CompactionManager({
    strategy: 'truncate-oldest',
    preserveRecent: 12,
    triggerThreshold: 0.75,
  });

  // 订阅压缩事件 (callback 模式)
  const eventLog: CompactionEventPayload[] = [];
  const unsubscribe = manager.on(event => {
    eventLog.push(event);
    console.log(`[事件] ${event.type}`);
    if (event.type === 'compaction.start') {
      console.log(`  策略: ${event.strategy}`);
      console.log(`  Token 阈值: ${event.tokensBefore}`);
    }
    if (event.type === 'compaction.complete') {
      console.log(`  移除消息: ${event.removedMessages}`);
      console.log(`  Token 变化: ${event.tokensBefore} → ${event.tokensAfter}`);
    }
  });

  // 创建上下文
  const context = manager.createContext('session-observable-001', messages, maxTokens);

  console.log('执行压缩...\n');
  const result = await manager.compact(context);

  console.log('\n事件日志汇总:');
  console.log(`  总事件数: ${eventLog.length}`);
  console.log(`  开始事件: ${eventLog.filter(e => e.type === 'compaction.start').length}`);
  console.log(`  完成事件: ${eventLog.filter(e => e.type === 'compaction.complete').length}`);
}

// ============================================================
// Example 6: compactIfNeeded Helper
// ============================================================

/**
 * 示例 6: compactIfNeeded 便捷方法
 *
 * 自动判断是否需要压缩，无需手动检查。
 */
async function example6_compactIfNeeded(): Promise<void> {
  console.log('\n=== 示例 6: compactIfNeeded 便捷方法 ===\n');

  // 创建两个不同大小的消息集
  const smallMessages = createMockMessages(10);
  const largeMessages = createMockMessages(50);

  const maxTokens = 2000;

  const manager = createCompactionManager();

  console.log('测试小消息集（不需要压缩）:');
  const result1 = await manager.compactIfNeeded('session-small', smallMessages, maxTokens);
  if (result1 === null) {
    console.log('  结果: 不需要压缩');
  } else {
    console.log(`  结果: 已压缩，移除 ${result1.removedCount} 条消息`);
  }

  console.log('\n测试大消息集（需要压缩）:');
  const result2 = await manager.compactIfNeeded('session-large', largeMessages, maxTokens);
  if (result2 === null) {
    console.log('  结果: 不需要压缩');
  } else {
    console.log(`  结果: 已压缩，移除 ${result2.removedCount} 条消息`);
    console.log(`  Token 变化: ${result2.tokensBefore} → ${result2.tokensAfter}`);
  }
}

// ============================================================
// Example 7: Disabled Compaction
// ============================================================

/**
 * 示例 7: 禁用压缩
 *
 * 某些场景下可能不需要压缩功能。
 */
async function example7_disabledCompaction(): Promise<void> {
  console.log('\n=== 示例 7: 禁用压缩 ===\n');

  const messages = createMockMessages(100);
  const maxTokens = 1000;

  // 创建禁用压缩的管理器
  const manager = createDisabledCompactionManager();

  const context: CompactionContext = {
    sessionId: 'session-disabled',
    messages,
    currentTokenEstimate: estimateTokens(messages),
    maxTokens,
  };

  console.log('禁用压缩测试:');
  console.log(`  消息数: ${messages.length}`);
  console.log(`  Token 估算: ${context.currentTokenEstimate}`);
  console.log(`  最大 Token: ${maxTokens}`);
  console.log(`  压缩启用: ${manager.getConfig().enabled}`);
  console.log(`  需要压缩: ${manager.needsCompaction(context)}`);

  // 尝试压缩（应该返回 null）
  const result = await manager.compactIfNeeded('session-disabled', messages, maxTokens);
  console.log(`  压缩结果: ${result === null ? '无操作（已禁用）' : '已压缩'}`);
}

// ============================================================
// Example 8: Token Estimation Utilities
// ============================================================

/**
 * 示例 8: Token 估算工具
 *
 * 了解如何估算消息的 Token 数量。
 */
async function example8_tokenEstimation(): Promise<void> {
  console.log('\n=== 示例 8: Token 估算工具 ===\n');

  // 单条消息的 Token 估算
  const singleMessage: Message = {
    role: 'user',
    content: '这是一条测试消息，用于演示 Token 估算功能。This is a test message.',
  };

  console.log('单条消息 Token 估算:');
  console.log(`  内容: "${singleMessage.content}"`);
  console.log(`  字符数: ${singleMessage.content.length}`);
  console.log(`  Token 估算: ${estimateMessageTokens(singleMessage)}`);
  console.log(
    `  计算公式: Math.ceil(${singleMessage.content.length} / 4) = ${Math.ceil(singleMessage.content.length / 4)}`
  );

  // 多条消息的 Token 估算
  const messages: Message[] = [
    { role: 'system', content: '你是一个智能助手' },
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！有什么可以帮你的吗？' },
    { role: 'user', content: '请解释一下 AgentForge 框架' },
    { role: 'assistant', content: 'AgentForge 是一个基于事件流的 Agent 框架...' },
  ];

  const totalTokens = estimateTokens(messages);

  console.log('\n多条消息 Token 估算:');
  console.log(`  消息数: ${messages.length}`);
  console.log(`  总 Token 估算: ${totalTokens}`);

  // 分条显示
  console.log('\n  各消息详情:');
  messages.forEach((msg, i) => {
    const tokens = estimateMessageTokens(msg);
    console.log(`    [${i}] ${msg.role}: ${tokens} tokens (${msg.content.length} chars)`);
  });

  console.log('\n注意: Token 估算是近似值');
  console.log('  - 计算方式: 1 Token ≈ 4 字符');
  console.log('  - 实际值取决于具体模型的分词方式');
  console.log('  - 中文通常比英文需要更多 Token');
}

// ============================================================
// Example 9: Dynamic Configuration Update
// ============================================================

/**
 * 示例 9: 动态更新配置
 *
 * 运行时调整压缩策略和参数。
 */
async function example9_dynamicConfig(): Promise<void> {
  console.log('\n=== 示例 9: 动态配置更新 ===\n');

  const messages = createMockMessages(40);
  const maxTokens = 2000;

  // 创建初始配置的管理器
  const manager = new CompactionManager({
    strategy: 'truncate-oldest',
    preserveRecent: 5,
    triggerThreshold: 0.8,
  });

  console.log('初始配置:');
  const config1 = manager.getConfig();
  console.log(`  策略: ${config1.strategy}`);
  console.log(`  保留最近: ${config1.preserveRecent}`);
  console.log(`  触发阈值: ${config1.triggerThreshold}`);

  // 第一次压缩
  let result = await manager.compactIfNeeded('session-dynamic', messages, maxTokens);
  if (result) {
    console.log('\n第一次压缩结果:');
    console.log(`  保留消息: ${result.messages.length}`);
    console.log(`  Token 变化: ${result.tokensBefore} → ${result.tokensAfter}`);
  }

  // 动态更新配置
  console.log('\n更新配置...');
  manager.updateConfig({
    strategy: 'importance-weighted',
    preserveRecent: 10,
    targetTokenRatio: 0.4,
  });

  console.log('更新后配置:');
  const config2 = manager.getConfig();
  console.log(`  策略: ${config2.strategy}`);
  console.log(`  保留最近: ${config2.preserveRecent}`);
  console.log(`  目标 Token 比例: ${config2.targetTokenRatio}`);

  // 第二次压缩（使用新配置）
  result = await manager.compactIfNeeded('session-dynamic', messages, maxTokens);
  if (result) {
    console.log('\n第二次压缩结果:');
    console.log(`  保留消息: ${result.messages.length}`);
    console.log(`  Token 变化: ${result.tokensBefore} → ${result.tokensAfter}`);
  }
}

// ============================================================
// Main Entry Point
// ============================================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('AgentForge Memory Management 示例');
  console.log('========================================');

  await example1_truncateOldest();
  await example2_summarize();
  await example3_importanceWeighted();
  await example4_customPreserveConfig();
  await example5_eventObservability();
  await example6_compactIfNeeded();
  await example7_disabledCompaction();
  await example8_tokenEstimation();
  await example9_dynamicConfig();

  console.log('\n========================================');
  console.log('示例执行完成');
  console.log('========================================');
}

// 运行示例
main().catch(console.error);
