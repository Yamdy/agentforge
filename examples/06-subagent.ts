/**
 * AgentForge SubAgent 示例
 *
 * 本示例展示如何使用 SubagentRegistry 管理和调用子代理。
 * SubAgent 允许将复杂的任务分解为多个专门的代理协作完成。
 *
 * 核心概念:
 * - SubagentRegistry: 管理子代理的注册和执行
 * - AgentLoop: 代理执行循环的接口 (Promise + 回调事件，不再使用 Observable)
 * - registry.run(name, input, listener, options?) → Promise<string>
 * - agent.onAny(listener) 订阅事件
 *
 * 运行方式: npx tsx examples/06-subagent.ts
 */

// ============================================================
// 导入核心类型
// ============================================================

// SubAgent 模块
import {
  SubagentRegistry,
  createSubagentRegistry,
  type SubagentConfig,
  type AgentLoop,
} from '../src/subagent/index.js';

// 核心类型
import {
  type AgentEvent,
  type LLMAdapter,
  type LLMResponse,
  type LLMChunk,
  type Message,
  type ToolDefinition,
  generateId,
} from '../src/core/index.js';

import type { ToolRegistry, ToolContext, FunctionDefinition } from '../src/core/interfaces.js';

// ============================================================
// Mock LLM Adapter
// ============================================================

/**
 * 模拟的 LLM Adapter
 *
 * 用于演示目的，不依赖真实 API
 */
class MockLLMAdapter implements LLMAdapter {
  readonly name = 'mock-adapter';
  readonly provider = 'mock';

  private callCount = 0;
  private responses: LLMResponse[] = [];

  /**
   * 设置预设响应
   */
  setResponses(responses: LLMResponse[]): void {
    this.responses = responses;
    this.callCount = 0;
  }

  async chat(messages: Message[]): Promise<LLMResponse> {
    this.callCount++;

    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 50));

    if (this.callCount <= this.responses.length) {
      return this.responses[this.callCount - 1]!;
    }

    return {
      content: '默认响应',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10 },
    };
  }

  async *stream(messages: Message[]): AsyncGenerator<LLMChunk> {
    const response = this.responses[0]!;
    yield {
      text: response.content,
      finishReason: response.finishReason ?? 'stop',
    };
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ============================================================
// Mock Tool Registry
// ============================================================

/**
 * 模拟的工具注册表
 */
class MockToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getFunctionDef(name: string): FunctionDefinition | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;

    const params = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: params.properties ?? {},
        required: params.required,
      },
    };
  }

  getFunctionDefs(): FunctionDefinition[] {
    return this.list().map(n => this.getFunctionDef(n)!);
  }

  async execute(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    return tool.execute(args, ctx);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const t of tools) {
      this.register(t);
    }
  }
}

// ============================================================
// Mock Agent Loop (Promise-based, no Observable)
// ============================================================

/**
 * 模拟的 AgentLoop 实现 (Promise + 回调)
 *
 * 新 API:
 * - run(input): Promise<string> — 返回最终输出
 * - onAny(listener): () => void — 订阅所有事件，返回取消函数
 * - on(type, listener): () => void — 订阅特定事件类型
 *
 * 用于演示子代理的基本行为
 */
class MockAgentLoop implements AgentLoop {
  private listeners: Array<(event: AgentEvent) => void> = [];

  constructor(
    private name: string,
    private response: string,
    private events?: AgentEvent[]
  ) {}

  onAny(listener: (event: AgentEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  on(type: string, listener: (event: AgentEvent) => void): () => void {
    const wrapped = (e: AgentEvent) => {
      if (e.type === type) listener(e);
    };
    this.listeners.push(wrapped);
    return () => {
      const idx = this.listeners.indexOf(wrapped);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async run(input: string): Promise<string> {
    const sessionId = generateId('session');
    const events = this.events ?? [
      {
        type: 'agent.start',
        timestamp: Date.now(),
        sessionId,
        input,
        agentName: this.name,
        model: { provider: 'mock', model: 'mock-model' },
      } as AgentEvent,
      { type: 'agent.step', timestamp: Date.now(), sessionId, step: 1, maxSteps: 1 } as AgentEvent,
      {
        type: 'agent.complete',
        timestamp: Date.now(),
        sessionId,
        output: this.response,
      } as AgentEvent,
    ];

    // 通知所有监听器
    for (const l of this.listeners) {
      for (const event of events) {
        l(event);
      }
    }

    return this.response;
  }

  destroy(): void {
    // Mock 实现无需清理资源
  }
}

// ============================================================
// 示例 1: 基础子代理注册和执行
// ============================================================

async function example1_basicSubagent(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 1: 基础子代理注册和执行');
  console.log('========================================\n');

  // 创建子代理注册表
  const registry = createSubagentRegistry();

  // 创建一个研究型子代理
  const researchAgent = new MockAgentLoop(
    'research-agent',
    '研究发现: AI 市场正在快速增长，预计 2025 年将达到 5000 亿美元。'
  );

  // 注册子代理
  registry.register({
    name: 'research-agent',
    description: '搜索和总结信息的子代理',
    agent: researchAgent,
  });

  console.log('已注册子代理:');
  for (const info of registry.list()) {
    console.log(`  - ${info.name}: ${info.description ?? '无描述'}`);
  }

  // 检查子代理是否存在
  console.log(`\n检查 'research-agent' 是否存在: ${registry.has('research-agent')}`);

  // 运行子代理（新 API: registry.run(name, input, listener) → Promise<string>）
  console.log('\n运行子代理:');
  const events: AgentEvent[] = [];

  const output = await registry.run('research-agent', '搜索 AI 市场趋势', (event) => {
    events.push(event);
    console.log(`  事件: ${event.type}`);
  });

  // 找到 subagent.complete 事件
  const completeEvent = events.find(e => e.type === 'subagent.complete');
  if (completeEvent && completeEvent.type === 'subagent.complete') {
    console.log(`\n子代理输出: ${completeEvent.output}`);
  }

  console.log(`\n最终输出 (Promise<string>): ${output}`);

  // 清理
  researchAgent.destroy();
  registry.clear();
}

// ============================================================
// 示例 2: 嵌套子代理调用
// ============================================================

async function example2_nestedSubagents(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 2: 嵌套子代理调用');
  console.log('========================================\n');

  const registry = createSubagentRegistry();

  // 创建多个专门的子代理
  const searchAgent = new MockAgentLoop('search-agent', '搜索结果: 找到 10 篇相关文章');

  const analysisAgent = new MockAgentLoop('analysis-agent', '分析结果: 市场趋势向上，建议关注');

  const summaryAgent = new MockAgentLoop('summary-agent', '总结: AI 市场前景乐观，投资机会增多');

  // 注册所有子代理
  registry.register({
    name: 'search-agent',
    description: '搜索相关信息的子代理',
    agent: searchAgent,
  });

  registry.register({
    name: 'analysis-agent',
    description: '分析数据的子代理',
    agent: analysisAgent,
  });

  registry.register({
    name: 'summary-agent',
    description: '总结内容的子代理',
    agent: summaryAgent,
  });

  console.log('已注册子代理:');
  for (const info of registry.list()) {
    console.log(`  - ${info.name} (${info.mode})`);
  }

  // 模拟嵌套调用: 主代理调用分析代理，分析代理再调用搜索代理
  console.log('\n模拟嵌套调用流程:');
  console.log('  1. summary-agent 被调用');
  console.log('  2. summary-agent 调用 analysis-agent');
  console.log('  3. analysis-agent 调用 search-agent');

  // 按顺序执行嵌套调用（新 API: listener 回调收集事件）
  const allEvents: AgentEvent[] = [];

  // 步骤 1: 运行搜索代理
  console.log('\n--- 执行 search-agent ---');
  await registry.run('search-agent', '搜索 AI 市场', (e) => allEvents.push(e));

  // 步骤 2: 运行分析代理
  console.log('--- 执行 analysis-agent ---');
  await registry.run('analysis-agent', '分析搜索结果', (e) => allEvents.push(e));

  // 步骤 3: 运行总结代理
  console.log('--- 执行 summary-agent ---');
  await registry.run('summary-agent', '总结分析结果', (e) => allEvents.push(e));

  // 统计事件
  const eventCounts = new Map<string, number>();
  for (const event of allEvents) {
    const count = eventCounts.get(event.type) ?? 0;
    eventCounts.set(event.type, count + 1);
  }

  console.log('\n事件统计:');
  eventCounts.forEach((count, type) => {
    console.log(`  ${type}: ${count}`);
  });

  // 清理
  searchAgent.destroy();
  analysisAgent.destroy();
  summaryAgent.destroy();
  registry.clear();
}

// ============================================================
// 示例 3: 带工具的子代理
// ============================================================

async function example3_subagentWithTools(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 3: 带工具的子代理');
  console.log('========================================\n');

  // 创建工具注册表
  const toolRegistry = new MockToolRegistry([
    {
      name: 'search',
      description: '搜索网络信息',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询' },
        },
        required: ['query'],
      },
      execute: async (args: unknown) => {
        const { query } = args as { query: string };
        return `搜索结果: ${query} - 找到 5 条相关信息`;
      },
    },
    {
      name: 'analyze',
      description: '分析文本内容',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要分析的文本' },
        },
        required: ['text'],
      },
      execute: async (args: unknown) => {
        const { text } = args as { text: string };
        return `分析结果: 文本长度 ${text.length}, 情感倾向: 正面`;
      },
    },
  ]);

  console.log('可用工具:');
  for (const name of toolRegistry.list()) {
    const def = toolRegistry.getFunctionDef(name);
    console.log(`  - ${name}: ${def?.description}`);
  }

  // 创建带工具的子代理
  const registry = createSubagentRegistry();

  // 创建一个会使用工具的代理循环
  const toolAgent = new MockAgentLoop('tool-agent', '已使用 search 和 analyze 工具完成任务');

  registry.register({
    name: 'tool-agent',
    description: '可以调用工具的子代理',
    agent: toolAgent,
    config: {
      tools: toolRegistry.list(),
    },
  });

  // 执行工具调用演示
  console.log('\n执行工具调用:');

  const searchResult = await toolRegistry.execute('search', { query: 'AI 市场趋势 2025' });
  console.log(`  search 结果: ${searchResult}`);

  const analyzeResult = await toolRegistry.execute('analyze', { text: 'AI 市场正在蓬勃发展' });
  console.log(`  analyze 结果: ${analyzeResult}`);

  // 运行带工具的子代理
  console.log('\n运行子代理:');
  await registry.run('tool-agent', '分析 AI 市场', (e) => {
    console.log(`  事件: ${e.type}`);
  });

  // 清理
  toolAgent.destroy();
  registry.clear();
}

// ============================================================
// 示例 4: 子代理生命周期管理
// ============================================================

async function example4_subagentLifecycle(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 4: 子代理生命周期管理');
  console.log('========================================\n');

  const registry = createSubagentRegistry();

  // 注册多个子代理
  const agents = [
    { name: 'writer', desc: '内容写作代理' },
    { name: 'reviewer', desc: '内容审核代理' },
    { name: 'publisher', desc: '发布代理' },
  ];

  for (const { name, desc } of agents) {
    registry.register({
      name,
      description: desc,
      agent: new MockAgentLoop(name, `${name} 完成任务`),
    });
    console.log(`注册: ${name}`);
  }

  console.log(`\n当前注册数量: ${registry.list().length}`);

  // 获取单个子代理信息
  const writerInfo = registry.get('writer');
  if (writerInfo) {
    console.log(`\n获取 'writer' 信息:`);
    console.log(`  名称: ${writerInfo.name}`);
    console.log(`  描述: ${writerInfo.description}`);
    console.log(`  模式: ${writerInfo.mode}`);
  }

  // 注销子代理
  console.log('\n注销 reviewer...');
  const unregistered = registry.unregister('reviewer');
  console.log(`  注销结果: ${unregistered}`);
  console.log(`  剩余数量: ${registry.list().length}`);

  // 检查注销后状态
  console.log(`\n检查 'reviewer' 是否存在: ${registry.has('reviewer')}`);

  // 清空所有子代理
  console.log('\n清空所有子代理...');
  registry.clear();
  console.log(`  清空后数量: ${registry.list().length}`);
}

// ============================================================
// 示例 5: 子代理错误处理
// ============================================================

async function example5_errorHandling(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 5: 子代理错误处理');
  console.log('========================================\n');

  const registry = createSubagentRegistry();

  // 注册一个正常的子代理
  const normalAgent = new MockAgentLoop('normal-agent', '正常完成任务');
  registry.register({
    name: 'normal-agent',
    description: '正常工作的子代理',
    agent: normalAgent,
  });

  // 尝试运行不存在的子代理
  console.log('尝试运行不存在的子代理:');
  const errorEvents: AgentEvent[] = [];

  await registry.run('non-existent-agent', '测试', (e) => {
    errorEvents.push(e);
    if (e.type === 'subagent.error') {
      console.log(`  错误事件: ${e.type}`);
      console.log(`  错误名称: ${e.error.name}`);
      console.log(`  错误消息: ${e.error.message}`);
    }
  });

  // 创建一个会产生错误的子代理（Promise-based，不使用 Observable）
  const errorAgent: AgentLoop = (() => {
    const listeners: Array<(event: AgentEvent) => void> = [];

    return {
      onAny(listener) {
        listeners.push(listener);
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      },
      on(type, listener) {
        const wrapped = (e: AgentEvent) => {
          if (e.type === type) listener(e);
        };
        listeners.push(wrapped);
        return () => {
          const idx = listeners.indexOf(wrapped);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      },
      async run(_input: string): Promise<string> {
        const sessionId = generateId('session');

        for (const l of listeners) {
          l({
            type: 'agent.start',
            timestamp: Date.now(),
            sessionId,
            input: _input,
            agentName: 'error-agent',
            model: { provider: 'mock', model: 'mock-model' },
          } as AgentEvent);

          l({
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId,
            error: { name: 'ExecutionError', message: '执行过程中发生错误' },
          } as AgentEvent);
        }

        return ''; // 错误代理不产生有效输出
      },
    };
  })();

  registry.register({
    name: 'error-agent',
    description: '会出错的子代理',
    agent: errorAgent,
  });

  console.log('\n运行会出错的子代理:');
  await registry.run('error-agent', '测试错误', (e) => {
    if (e.type === 'agent.error') {
      console.log(`  代理错误: ${(e as any).error?.message ?? '未知错误'}`);
    }
  });

  // 清理
  normalAgent.destroy();
  registry.clear();
}

// ============================================================
// 主入口
// ============================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║     AgentForge SubAgent 示例               ║');
  console.log('╚════════════════════════════════════════════╝');

  try {
    await example1_basicSubagent();
    await example2_nestedSubagents();
    await example3_subagentWithTools();
    await example4_subagentLifecycle();
    await example5_errorHandling();

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
