/**
 * AgentForge 操作符使用示例
 *
 * 展示如何使用 RxJS 操作符来处理 Agent 事件流。
 *
 * 运行方式: npx tsx examples/02-operators.ts
 */

import { of, from, Observable, EMPTY } from 'rxjs';
import { map, filter, tap, take, toArray, mergeMap } from 'rxjs/operators';
import {
  filterEventTypePrefix,
  takeUntilTerminal,
  collectMetrics,
  type AgentMetrics,
} from '../src/operators/index.js';
import { isTerminalEvent } from '../src/core/events.js';
import type { AgentEvent } from '../src/core/events.js';

// ============================================================
// 辅助函数：创建模拟事件
// ============================================================

const sessionId = 'session-001';
const timestamp = Date.now();

/** 创建模拟事件流 */
function createMockEventStream(): Observable<AgentEvent> {
  const events: AgentEvent[] = [
    // 1. Agent 启动
    {
      type: 'agent.start',
      timestamp,
      sessionId,
      input: '计算 1 + 1 的结果',
      agentName: 'math-agent',
      model: { provider: 'openai', model: 'gpt-4' },
    },

    // 2. 第一步开始
    {
      type: 'agent.step',
      timestamp: timestamp + 100,
      sessionId,
      step: 1,
      maxSteps: 10,
    },

    // 3. LLM 请求
    {
      type: 'llm.request',
      timestamp: timestamp + 150,
      sessionId,
      messages: [{ role: 'user', content: '计算 1 + 1' }],
      model: { provider: 'openai', model: 'gpt-4' },
    },

    // 4. LLM 响应
    {
      type: 'llm.response',
      timestamp: timestamp + 2000,
      sessionId,
      content: '结果是 2',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5 },
    },

    // 5. 工具调用
    {
      type: 'tool.call',
      timestamp: timestamp + 2100,
      sessionId,
      toolCallId: 'call-001',
      toolName: 'calculator',
      args: { expression: '1 + 1' },
    },

    // 6. 工具执行
    {
      type: 'tool.execute',
      timestamp: timestamp + 2150,
      sessionId,
      toolCallId: 'call-001',
      toolName: 'calculator',
    },

    // 7. 工具结果
    {
      type: 'tool.result',
      timestamp: timestamp + 2200,
      sessionId,
      toolCallId: 'call-001',
      toolName: 'calculator',
      result: '2',
      isError: false,
    },

    // 8. Agent 完成
    {
      type: 'agent.complete',
      timestamp: timestamp + 2500,
      sessionId,
      output: '计算完成，结果是 2',
      steps: 1,
      tokens: { input: 10, output: 5 },
    },

    // 9. 终端事件
    {
      type: 'done',
      timestamp: timestamp + 2600,
      sessionId,
      reason: 'stop',
    },
  ];

  return from(events);
}

// ============================================================
// 示例 1: filterEventTypePrefix - 按前缀过滤事件
// ============================================================

// @vitest-example: filterEventTypePrefix 基本用法
function example1_filterEventTypePrefix(): void {
  console.log('\n=== 示例 1: filterEventTypePrefix - 按前缀过滤 ===\n');

  // 过滤所有 LLM 相关事件
  createMockEventStream()
    .pipe(filterEventTypePrefix('llm.'))
    .subscribe({
      next: event => {
        console.log(`LLM 事件: ${event.type}`);
      },
      complete: () => console.log('流结束'),
    });
}

// ============================================================
// 示例 2: takeUntilTerminal - 直到终端事件
// ============================================================

// @vitest-example: takeUntilTerminal 用法
function example2_takeUntilTerminal(): void {
  console.log('\n=== 示例 2: takeUntilTerminal - 直到终端事件 ===\n');

  createMockEventStream()
    .pipe(
      takeUntilTerminal(),
      toArray() // 收集所有事件到数组
    )
    .subscribe({
      next: events => {
        console.log(`收到 ${events.length} 个事件 (包括终端事件)`);
        events.forEach(e => console.log(`  - ${e.type}`));
      },
    });
}

// ============================================================
// 示例 3: collectMetrics - 收集指标
// ============================================================

// @vitest-example: collectMetrics 用法
function example3_collectMetrics(): void {
  console.log('\n=== 示例 3: collectMetrics - 收集指标 ===\n');

  const metricsCallback = (metrics: AgentMetrics): void => {
    console.log('--- 指标统计 ---');
    console.log(`总事件数: ${metrics.totalEvents}`);
    console.log(`LLM 调用次数: ${metrics.llmCalls}`);
    console.log(`工具执行次数: ${metrics.toolExecutions}`);
    console.log(`错误数: ${metrics.errors}`);
    console.log(`Token 使用: prompt=${metrics.promptTokens}, completion=${metrics.completionTokens}`);
    console.log(`总耗时: ${metrics.durationMs}ms`);
  };

  createMockEventStream()
    .pipe(collectMetrics(metricsCallback))
    .subscribe({
      complete: () => console.log('指标收集完成'),
    });
}

// ============================================================
// 示例 4: 过滤特定事件类型
// ============================================================

// @vitest-example: 过滤特定事件类型
function example4_customFilter(): void {
  console.log('\n=== 示例 4: 过滤特定事件类型 ===\n');

  // 方法 1: 使用 filterEventTypePrefix + filter 组合
  createMockEventStream()
    .pipe(
      filterEventTypePrefix('llm.'),
      filter(event => event.type === 'llm.response'),
      map(event => {
        // 手动处理类型 - 安全因为我们已过滤
        if (event.type === 'llm.response') {
          return {
            type: 'llm.response',
            content: event.content,
            usage: event.usage,
          };
        }
        return null;
      }),
      filter(result => result !== null),
      tap(result => {
        console.log(`LLM 响应内容: ${result!.content}`);
        if (result!.usage) {
          console.log(`Token 使用: prompt=${result!.usage.promptTokens}, completion=${result!.usage.completionTokens}`);
        }
      })
    )
    .subscribe();
}

// ============================================================
// 示例 5: 事件类型检查
// ============================================================

// @vitest-example: 使用 isTerminalEvent 类型守卫
function example5_typeGuards(): void {
  console.log('\n=== 示例 5: 类型守卫 - 检查终端事件 ===\n');

  createMockEventStream()
    .pipe(
      tap(event => {
        // 使用 isTerminalEvent 检查
        if (isTerminalEvent(event)) {
          // 终端事件类型: done, agent.error, cancel
          if (event.type === 'done') {
            console.log(`终端事件: done, 原因: ${event.reason}`);
          } else if (event.type === 'agent.error') {
            console.log(`终端事件: agent.error, 错误: ${event.error.message}`);
          } else if (event.type === 'cancel') {
            console.log(`终端事件: cancel`);
          }
        }
      }),
      filter(event => !isTerminalEvent(event)),
      toArray()
    )
    .subscribe({
      next: events => {
        console.log(`非终端事件数: ${events.length}`);
      },
    });
}

// ============================================================
// 示例 6: 事件转换管道
// ============================================================

// @vitest-example: 事件转换管道
function example6_transformPipeline(): void {
  console.log('\n=== 示例 6: 事件转换管道 ===\n');

  createMockEventStream()
    .pipe(
      // 过滤出工具相关事件
      filterEventTypePrefix('tool.'),
      // 转换为简化格式
      map(event => {
        if (event.type === 'tool.call') {
          return `调用工具: ${event.toolName}`;
        }
        if (event.type === 'tool.execute') {
          return `执行工具: ${event.toolName}`;
        }
        if (event.type === 'tool.result') {
          return `工具结果: ${event.result}`;
        }
        return `工具事件: ${event.type}`;
      }),
      toArray()
    )
    .subscribe({
      next: lines => lines.forEach(line => console.log(`  ${line}`)),
    });
}

// ============================================================
// 示例 7: 错误处理场景
// ============================================================

// @vitest-example: 错误事件处理
function example7_errorHandling(): void {
  console.log('\n=== 示例 7: 错误处理场景 ===\n');

  // 创建包含错误的模拟流
  const errorEvents: AgentEvent[] = [
    {
      type: 'agent.start',
      timestamp,
      sessionId: 'error-session',
      input: '测试错误处理',
      agentName: 'test-agent',
      model: { provider: 'openai', model: 'gpt-4' },
    },
    {
      type: 'agent.error',
      timestamp: timestamp + 100,
      sessionId: 'error-session',
      error: { name: 'TestError', message: '这是一个测试错误' },
    },
    {
      type: 'done',
      timestamp: timestamp + 200,
      sessionId: 'error-session',
      reason: 'error',
    },
  ];

  from(errorEvents)
    .pipe(
      takeUntilTerminal(),
      collectMetrics(metrics => {
        console.log(`错误流指标: ${metrics.errors} 个错误`);
      })
    )
    .subscribe({
      next: e => {
        if (e.type === 'agent.error') {
          console.log(`捕获错误: ${e.error.message}`);
        }
      },
      complete: () => console.log('错误流处理完成'),
    });
}

// ============================================================
// 示例 8: 组合操作符管道
// ============================================================

// @vitest-example: 组合多个操作符
function example8_combinedPipeline(): void {
  console.log('\n=== 示例 8: 组合操作符管道 ===\n');

  createMockEventStream()
    .pipe(
      // 1. 过滤出 LLM 和 Agent 生命周期事件
      filter(event => 
        event.type.startsWith('llm.') || event.type.startsWith('agent.')
      ),
      // 2. 记录每个事件
      tap(event => console.log(`[Pipeline] 处理事件: ${event.type}`)),
      // 3. 收集指标
      collectMetrics(metrics => {
        console.log(`[Pipeline] LLM 调用: ${metrics.llmCalls}`);
      }),
      // 4. 直到终端事件
      takeUntilTerminal(),
      // 5. 取前 10 个
      take(10),
      toArray()
    )
    .subscribe({
      next: events => {
        console.log(`\n最终收集 ${events.length} 个事件:`);
        events.forEach(e => console.log(`  - ${e.type}`));
      },
      complete: () => console.log('[Pipeline] 处理完成'),
    });
}

// ============================================================
// 示例 9: 自定义收集操作符
// ============================================================

/**
 * 自定义操作符：统计事件类型分布
 */
function countEventTypes(source: Observable<AgentEvent>): Observable<Map<string, number>> {
  return new Observable(subscriber => {
    const counts = new Map<string, number>();

    return source.subscribe({
      next(event) {
        const current = counts.get(event.type) ?? 0;
        counts.set(event.type, current + 1);
      },
      error(err) {
        subscriber.error(err);
      },
      complete() {
        subscriber.next(counts);
        subscriber.complete();
      },
    });
  });
}

// @vitest-example: 自定义收集操作符
function example9_customCollector(): void {
  console.log('\n=== 示例 9: 自定义收集操作符 ===\n');

  createMockEventStream()
    .pipe(
      takeUntilTerminal(),
      countEventTypes
    )
    .subscribe({
      next: counts => {
        console.log('事件类型分布:');
        counts.forEach((count, type) => {
          console.log(`  ${type}: ${count} 次`);
        });
      },
    });
}

// ============================================================
// 示例 10: 分组处理
// ============================================================

// @vitest-example: 按步骤分组处理
function example10_groupProcessing(): void {
  console.log('\n=== 示例 10: 分组处理 ===\n');

  createMockEventStream()
    .pipe(
      // 分组：step 事件之前的事件为一组
      toArray(),
      map(events => {
        const groups: AgentEvent[][] = [];
        let currentGroup: AgentEvent[] = [];

        for (const event of events) {
          currentGroup.push(event);
          if (event.type === 'agent.step' || isTerminalEvent(event)) {
            groups.push([...currentGroup]);
            currentGroup = [];
          }
        }

        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }

        return groups;
      })
    )
    .subscribe({
      next: groups => {
        groups.forEach((group, i) => {
          console.log(`组 ${i + 1}: [${group.map(e => e.type).join(', ')}]`);
        });
      },
    });
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('AgentForge 操作符使用示例');
  console.log('========================================');

  // 依次运行示例
  example1_filterEventTypePrefix();
  example2_takeUntilTerminal();
  example3_collectMetrics();
  example4_customFilter();
  example5_typeGuards();
  example6_transformPipeline();
  example7_errorHandling();
  example8_combinedPipeline();
  example9_customCollector();
  example10_groupProcessing();

  console.log('\n========================================');
  console.log('所有示例运行完成');
  console.log('========================================\n');
}

// 执行主函数
main().catch(console.error);
