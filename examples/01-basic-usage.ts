/**
 * AgentForge 基础使用示例
 *
 * 本示例展示如何使用 AgentForge 的两种 API：
 * - L2 API (createAgent): 配置驱动的声明式 API，适合大多数开发者
 * - L3 API (createAgentLoop): 编程式 API，提供完整的事件控制能力
 *
 * 运行方式: npx tsx examples/01-basic-usage.ts
 */

// ============================================================
// 导入核心类型
// ============================================================

// L2 API (配置驱动)
import { createAgent, type AgentConfig, type Agent } from '../src/api/create-agent.js';

// L3 API (编程式)
import { createAgentLoop, type AgentLoopConfig } from '../src/loop/agent-loop.js';

// 核心类型和工具
import {
  type AgentEvent,
  type AgentContext,
  type LLMAdapter,
  type LLMResponse,
  type ToolDefinition,
  type Message,
  ContextBuilder,
  InMemoryStore,
  DefaultPauseController,
  isTerminalEvent,
  generateSessionId,
} from '../src/core/index.js';

import type {
  ToolRegistry as ToolRegistryInterface,
  FunctionDefinition,
} from '../src/core/interfaces.js';

// ============================================================
// Mock LLM Adapter
// ============================================================

/**
 * 模拟的 LLM Adapter
 *
 * 在实际项目中，你需要提供真实的 LLM 实现（如 OpenAI, Anthropic 等）
 * 这里使用 Mock 是为了演示目的，不依赖真实 API
 */
class MockLLMAdapter implements LLMAdapter {
  private callCount = 0;

  // 预设的响应内容
  private responses: LLMResponse[] = [
    {
      content: '你好！我是 AgentForge 助手。有什么可以帮助你的吗？',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    },
  ];

  /**
   * 设置预设响应（用于测试场景）
   */
  setResponses(responses: LLMResponse[]): void {
    this.responses = responses;
    this.callCount = 0;
  }

  /**
   * 非流式聊天完成
   */
  async chat(messages: Message[]): Promise<LLMResponse> {
    this.callCount++;

    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 100));

    // 返回预设响应
    if (this.callCount <= this.responses.length) {
      return this.responses[this.callCount - 1]!;
    }

    // 默认响应
    return {
      content: '这是默认响应。',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10 },
    };
  }

  /**
   * 流式聊天完成 (AsyncGenerator 模式)
   */
  async *stream(messages: Message[]): AsyncGenerator<{ text?: string; finishReason?: string }> {
    const response = this.responses[0]!;
    yield {
      text: response.content,
      finishReason: response.finishReason,
    };
  }

  /**
   * 获取调用次数（用于验证）
   */
  getCallCount(): number {
    return this.callCount;
  }
}

// ============================================================
// Mock Tool Registry
// ============================================================

/**
 * 模拟的工具注册表
 *
 * 实际项目中可以使用 SimpleToolRegistry 或自定义实现
 */
class MockToolRegistry implements ToolRegistryInterface {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    // 注册一个简单的 echo 工具
    this.tools.set('echo', {
      name: 'echo',
      description: '回显输入的消息',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '要回显的消息' },
        },
        required: ['message'],
      },
      execute: async (args: unknown) => {
        const { message } = args as { message: string };
        return `Echo: ${message}`;
      },
    });

    // 注册一个获取时间的工具
    this.tools.set('get_time', {
      name: 'get_time',
      description: '获取当前时间',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      execute: async () => {
        return `当前时间: ${new Date().toISOString()}`;
      },
    });
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
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {},
        required: (tool.parameters as { required?: string[] }).required,
      },
    };
  }

  getFunctionDefs(): FunctionDefinition[] {
    return this.list().map(n => this.getFunctionDef(n)!);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    return tool.execute(args);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    tools.forEach(t => this.register(t));
  }
}

// ============================================================
// 示例 1: L2 API - 使用 createAgent (推荐方式)
// ============================================================

async function example_L2_createAgent(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 1: L2 API - createAgent');
  console.log('========================================\n');

  // 创建 Mock LLM 和工具
  const llmAdapter = new MockLLMAdapter();
  const toolRegistry = new MockToolRegistry();

  // 配置 Agent
  const config: AgentConfig = {
    name: 'demo-agent',
    model: {
      provider: 'mock',
      model: 'mock-model',
    },
    maxSteps: 5,
    llmAdapter, // 注入 Mock LLM
    tools: [toolRegistry.get('echo')!, toolRegistry.get('get_time')!],
  };

  // 创建 Agent 实例
  const agent = createAgent(config);

  console.log('Agent 配置:', {
    name: config.name,
    model: config.model,
    maxSteps: config.maxSteps,
  });

  // 方式 A: Promise 模式 - 获取最终结果
  console.log('\n--- 方式 A: Promise 模式 ---');
  try {
    const result = await agent.run('你好，请介绍一下你自己');
    console.log('Agent 响应:', result);
  } catch (error) {
    console.error('执行出错:', error);
  }

  // 方式 B: 流式模式 - 回调处理
  console.log('\n--- 方式 B: 流式模式 ---');
  const subscription = agent.stream('告诉我当前时间', {
    onText: delta => process.stdout.write(delta),
    onToolCall: (name, args) => console.log(`\n调用工具: ${name}`, args),
    onToolResult: (name, result) => console.log(`工具结果: ${name} -> ${result}`),
    onStep: (step, maxSteps) => console.log(`步骤: ${step}/${maxSteps}`),
    onComplete: result => console.log('\n完成:', result),
    onError: error => console.error('错误:', error),
  });

  // 等待完成
  await subscription.result;

  // 方式 C: 事件监听模式 - 通过 on() 完全控制
  console.log('\n--- 方式 C: 事件监听模式 ---');
  const terminalEvents: AgentEvent[] = [];

  // 监听所有事件
  const unsub = agent.onAny(event => {
    console.log(`[${event.type}]`);
    // 收集终端事件
    if (isTerminalEvent(event)) {
      terminalEvents.push(event);
    }
  });

  await agent.run('给我一个简单的问候');
  unsub();

  console.log('终端事件数量:', terminalEvents.length);
}

// ============================================================
// 示例 2: L3 API - 使用 createAgentLoop (高级控制)
// ============================================================

async function example_L3_createAgentLoop(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 2: L3 API - createAgentLoop');
  console.log('========================================\n');

  // 创建 Mock LLM 和工具
  const llmAdapter = new MockLLMAdapter();
  const toolRegistry = new MockToolRegistry();

  // 使用 ContextBuilder 构建 AgentContext
  const ctx: AgentContext = ContextBuilder.create()
    .with({
      sessionId: generateSessionId(),
      agentName: 'advanced-agent',
      llm: llmAdapter,
      memory: new InMemoryStore(),
      pauseController: new DefaultPauseController(),
    })
    .withTools([toolRegistry.get('echo')!, toolRegistry.get('get_time')!])
    .build();

  console.log('Context 构建:', {
    sessionId: ctx.sessionId,
    agentName: ctx.agentName,
    tools: ctx.tools.list(),
  });

  // 配置 Loop
  const loopConfig: AgentLoopConfig = {
    model: {
      provider: 'mock',
      model: 'mock-model',
    },
    maxSteps: 10,
    maxLLMRepairAttempts: 3,
    parallelToolCalls: true,
    streaming: false,
  };

  // 创建 AgentLoop
  const loop = createAgentLoop(ctx, loopConfig);

  // 订阅事件流
  console.log('\n--- 订阅事件流 ---');
  const allEvents: AgentEvent[] = [];

  // 使用 onAny 监听所有事件
  const unsub = loop.onAny(event => {
    allEvents.push(event);
    console.log(`事件: ${event.type}`);

    // 根据事件类型打印详细信息
    switch (event.type) {
      case 'agent.start':
        console.log(`  - 会话ID: ${event.sessionId}`);
        break;
      case 'llm.response':
        console.log(`  - 内容: ${event.content?.substring(0, 50)}...`);
        break;
      case 'tool.call':
        console.log(`  - 工具: ${event.toolName}`);
        break;
      case 'tool.result':
        console.log(`  - 结果: ${event.result?.substring(0, 50)}...`);
        break;
      case 'agent.complete':
        console.log(`  - 输出: ${event.output?.substring(0, 50)}...`);
        break;
    }
  });

  // 运行 (等待终端事件)
  await loop.run('你好，请使用 echo 工具说一句问候语');
  unsub();

  console.log('\n事件统计:');
  const eventCounts = new Map<string, number>();
  for (const event of allEvents) {
    const count = eventCounts.get(event.type) ?? 0;
    eventCounts.set(event.type, count + 1);
  }
  eventCounts.forEach((count, type) => {
    console.log(`  ${type}: ${count}`);
  });
}

// ============================================================
// 示例 3: 事件流处理模式
// ============================================================

async function example_event_stream_patterns(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 3: 事件流处理模式');
  console.log('========================================\n');

  const llmAdapter = new MockLLMAdapter();
  const toolRegistry = new MockToolRegistry();

  const agent = createAgent({
    name: 'stream-demo',
    model: { provider: 'mock', model: 'mock-model' },
    maxSteps: 3,
    llmAdapter,
    tools: [toolRegistry.get('echo')!],
  });

  // 模式 1: 使用 on() 方法监听特定事件
  console.log('--- 模式 1: 事件监听 ---');
  const unsubscribe = agent.on('llm.response', event => {
    // 通过类型保护访问特定属性
    if (event.type === 'llm.response' && 'content' in event) {
      console.log('LLM 响应:', event.content?.substring(0, 50));
    }
  });

  await agent.run('测试事件监听');
  unsubscribe();

  // 模式 2: 通过 onAny 收集特定类型事件
  console.log('\n--- 模式 2: 收集工具事件 ---');
  const toolEvents: AgentEvent[] = [];
  const unsub2 = agent.onAny(event => {
    if (event.type.startsWith('tool.')) {
      toolEvents.push(event);
    }
  });

  await agent.run('使用 echo 工具');
  unsub2();
  console.log('工具事件数量:', toolEvents.length);

  // 模式 3: 超时和错误处理
  console.log('\n--- 模式 3: 错误处理 ---');
  try {
    await agent.run('测试错误处理');
    console.log('执行成功');
  } catch (error) {
    console.log('捕获错误:', error);
  }
}

// ============================================================
// 主入口
// ============================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║     AgentForge 基础使用示例                ║');
  console.log('╚════════════════════════════════════════════╝');

  try {
    // 运行所有示例
    await example_L2_createAgent();
    await example_L3_createAgentLoop();
    await example_event_stream_patterns();

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
