/**
 * AgentForge 端到端全流程示例
 *
 * 本示例展示如何用 AgentForge 快速搭建一个完整可用的 Agent，
 * 集成工具调用、断点恢复、记忆管理、可观测性、插件系统等核心能力。
 *
 * 不依赖真实 LLM API —— 使用 MockLLM 模拟多轮对话 + 工具调用。
 *
 * 运行方式: npx tsx examples/11-full-pipeline.ts
 */

// ============================================================
// 1. 核心导入
// ============================================================

// L2 API — 配置驱动的 Agent 工厂
import { createAgent, type AgentConfig, type Agent } from '../src/api/create-agent.js';

// 核心类型
import type {
  AgentEvent,
  AgentContext,
  LLMResponse,
  LLMChunk,
  LLMOptions,
  Message,
  Checkpoint,
  CheckpointStorage,
  Tracer,
  Metrics,
} from '../src/core/index.js';
import {
  type ToolDefinition,
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  SimpleToolRegistry,
  generateSessionId,
  createInitialState,
  isTerminalEvent,
  createCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
} from '../src/core/index.js';

// Context 构建 (L3 — 包含 withTracer/withMetrics)
import { AgentContextBuilder } from '../src/api/context-builder.js';

import type { LLMAdapter } from '../src/core/interfaces.js';

// 插件系统
import {
  PluginManager,
  createPluginManager,
  loggingPlugin,
  metricsPlugin,
  type ObserverPlugin,
  type PluginContext,
} from '../src/plugins/index.js';

// 记忆压缩
import {
  createTruncateCompactionManager,
  createDisabledCompactionManager,
} from '../src/memory/index.js';

// 资源监控
import { ResourceMonitor } from '../src/observability/index.js';

// ============================================================
// 2. Mock LLM — 模拟多轮对话 + 工具调用
// ============================================================

/**
 * 智能 Mock LLM
 *
 * 模拟三种场景：
 * - 纯对话：直接回复
 * - 工具调用：返回 tool_calls, 等待工具结果后再次调用 LLM
 * - 多轮：根据对话历史动态响应
 */
class SmartMockLLM implements LLMAdapter {
  readonly name = 'smart-mock';
  readonly provider = 'mock';
  private callCount = 0;

  async chat(messages: Message[], _options?: LLMOptions): Promise<LLMResponse> {
    this.callCount++;
    await new Promise(resolve => setTimeout(resolve, 50)); // 模拟延迟

    const lastMessage = messages[messages.length - 1];
    const content =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content);

    // 规则 1: 如果用户问天气 → 调用 get_weather 工具
    if (content?.includes('天气') || content?.includes('weather')) {
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: `tc-weather-${this.callCount}`,
            name: 'get_weather',
            args: { city: '北京', unit: 'celsius' },
          },
        ],
        usage: { promptTokens: 50, completionTokens: 20 },
      };
    }

    // 规则 2: 如果用户问计算 → 调用 calculator 工具
    if (content?.includes('计算') || content?.includes('算')) {
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: `tc-calc-${this.callCount}`,
            name: 'calculator',
            args: { expression: '25 * 4 + 13' },
          },
        ],
        usage: { promptTokens: 40, completionTokens: 15 },
      };
    }

    // 规则 3: 如果最后一条是 tool 消息 → 用工具结果生成自然语言回复
    if (lastMessage?.role === 'tool') {
      const toolResult =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      return {
        content: `根据查询结果：${toolResult.substring(0, 100)}`,
        finishReason: 'stop',
        usage: { promptTokens: 80, completionTokens: 30 },
      };
    }

    // 规则 4: 默认对话回复
    return {
      content:
        `你好！我是 AgentForge 演示助手（Mock LLM，第 ${this.callCount} 次调用）。` +
        `\n\n你可以问我天气、让我做计算，或者随便聊聊。`,
      finishReason: 'stop',
      usage: { promptTokens: 20, completionTokens: 40 },
    };
  }

  async *stream(messages: Message[], _options?: LLMOptions): AsyncGenerator<LLMChunk> {
    // 流式模式：一次性返回完整内容
    yield {
      text: '这是流式响应的模拟内容。',
      finishReason: 'stop',
    };
  }
}

// ============================================================
// 3. 工具定义 — 天气 & 计算器
// ============================================================

const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: '获取指定城市的天气信息',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称' },
      unit: { type: 'string', description: '温度单位 (celsius/fahrenheit)' },
    },
    required: ['city'],
  },
  execute: async (args: unknown) => {
    const { city, unit } = args as { city: string; unit?: string };
    const temp = unit === 'fahrenheit' ? 77 : 25;
    return JSON.stringify({
      city,
      temperature: temp,
      unit: unit ?? 'celsius',
      condition: '晴朗',
      humidity: 60,
    });
  },
};

const calculatorTool: ToolDefinition = {
  name: 'calculator',
  description: '执行数学表达式计算',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，如 "2 + 3 * 4"' },
    },
    required: ['expression'],
  },
  execute: async (args: unknown) => {
    const { expression } = args as { expression: string };
    try {
      const result = Function('"use strict"; return (' + expression + ')')();
      return JSON.stringify({ expression, result: String(result) });
    } catch {
      return JSON.stringify({ expression, error: '无法计算该表达式' });
    }
  },
};

// ============================================================
// 4. 内置检查点存储（演示用）
// ============================================================

class DemoCheckpointStorage implements CheckpointStorage {
  private readonly store = new Map<string, Checkpoint>();
  private saveCount = 0;

  async save(cp: Checkpoint): Promise<void> {
    this.saveCount++;
    this.store.set(cp.id, cp);
    console.log(
      `  💾 [Checkpoint] 保存 #${this.saveCount}: ${cp.position} (step=${cp.state.step})`
    );
  }

  async load(sessionId: string): Promise<Checkpoint | null> {
    const all = await this.list(sessionId);
    if (all.length === 0) return null;
    return all.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
  }

  async list(sessionId?: string): Promise<Checkpoint[]> {
    const all = Array.from(this.store.values());
    if (sessionId === undefined) return all;
    return all.filter(cp => cp.sessionId === sessionId);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async deleteAll(sessionId: string): Promise<void> {
    const entries = Array.from(this.store.entries());
    for (const [id, cp] of entries) {
      if (cp.sessionId === sessionId) {
        this.store.delete(id);
      }
    }
  }

  getSaveCount(): number {
    return this.saveCount;
  }
}

// ============================================================
// 5. 自定义 Observer 插件 — 计费追踪
// ============================================================

const billingPlugin: ObserverPlugin = {
  name: 'billing',
  type: 'observer',
  priority: 30,
  eventTypes: ['llm.response', 'tool.result', 'agent.complete'],
  enabled: true,

  observe(event: AgentEvent, _ctx: PluginContext): void {
    if (event.type === 'llm.response' && event.usage) {
      const cost = (
        event.usage.promptTokens * 0.00003 +
        event.usage.completionTokens * 0.00006
      ).toFixed(4);
      console.log(
        `  💰 [计费] Token: prompt=${event.usage.promptTokens}, completion=${event.usage.completionTokens}, 估算费用: $${cost}`
      );
    }

    if (event.type === 'tool.result') {
      const isError = event.isError ? '❌' : '✅';
      console.log(
        `  🔧 [工具] ${event.toolName} ${isError} (${event.result?.substring(0, 60)}...)`
      );
    }

    if (event.type === 'agent.complete') {
      console.log(
        `  📊 [统计] 总步骤=${event.steps}, Token: input=${event.tokens.input}, output=${event.tokens.output}`
      );
    }
  },
};

// ============================================================
// 6. 简易 Metrics 实现
// ============================================================

class ConsoleMetrics implements Metrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();

  increment(name: string, value = 1, tags?: Record<string, string>): void {
    const key = tags
      ? `${name}{${Object.entries(tags)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}}`
      : name;
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  histogram(name: string, value: number, _tags?: Record<string, string>): void {
    const values = this.histograms.get(name) ?? [];
    values.push(value);
    this.histograms.set(name, values);
  }

  gauge(_name: string, _value: number, _tags?: Record<string, string>): void {
    // 简化：忽略 gauge
  }

  report(): string {
    const lines: string[] = ['\n📊 指标报告:'];
    this.counters.forEach((v, k) => lines.push(`  ${k}: ${v}`));
    this.histograms.forEach((v, k) => {
      const avg = v.reduce((a, b) => a + b, 0) / v.length;
      lines.push(`  ${k}: avg=${avg.toFixed(1)}, samples=${v.length}`);
    });
    return lines.join('\n');
  }
}

// ============================================================
// 7. 简易 Tracer 实现
// ============================================================

class ConsoleTracer implements Tracer {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, unknown>; parent?: string }
  ): string {
    const spanId = `span-${Date.now()}`;
    console.log(
      `  🔍 [Trace] ▶ startSpan: ${name}`,
      options?.parent ? `parent=${options.parent}` : ''
    );
    return spanId;
  }

  endSpan(spanId: string, _options?: { code?: string }): void {
    console.log(`  🔍 [Trace] ■ endSpan: ${spanId}`);
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    console.log(
      `  🔍 [Trace] ⚡ event: ${name} @ ${spanId}`,
      attributes ? JSON.stringify(attributes) : ''
    );
  }

  recordException(spanId: string, error: Error): void {
    console.log(`  🔍 [Trace] ❌ exception @ ${spanId}: ${error.message}`);
  }
}

// ============================================================
// 8. 辅助：事件统计收集器
// ============================================================

interface AgentRunStats {
  totalEvents: number;
  llmCalls: number;
  toolExecutions: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  events: AgentEvent[];
}

function createRunStatsCollector(): {
  events: AgentEvent[];
  handler: (event: AgentEvent) => void;
  getStats: (startTime: number) => AgentRunStats;
} {
  const events: AgentEvent[] = [];
  
  const handler = (event: AgentEvent) => {
    events.push(event);
  };

  const getStats = (startTime: number): AgentRunStats => {
    let llmCalls = 0;
    let toolExecutions = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (const event of events) {
      if (event.type === 'llm.response') {
        llmCalls++;
        if (event.usage) {
          promptTokens += event.usage.promptTokens;
          completionTokens += event.usage.completionTokens;
        }
      }
      if (event.type === 'tool.result') {
        toolExecutions++;
      }
    }

    return {
      totalEvents: events.length,
      llmCalls,
      toolExecutions,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - startTime,
      events,
    };
  };

  return { events, handler, getStats };
}

// ============================================================
// 9. 场景 A: L2 API — 配置驱动，5 行代码跑起 Agent
// ============================================================

async function scenarioA_createAgent(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  场景 A: L2 API — createAgent 配置驱动');
  console.log('═'.repeat(60) + '\n');

  const llm = new SmartMockLLM();

  // ✨ 5 行核心代码 — 创建并运行一个完整 Agent
  const agent = createAgent({
    name: 'demo-agent',
    model: { provider: 'mock', model: 'mock-v1' },
    maxSteps: 5,
    llmAdapter: llm,
    tools: [weatherTool, calculatorTool],
  });

  console.log('📝 测试 1: 纯对话');
  console.log('   用户: 你好，介绍一下你自己\n');
  const result1 = await agent.run('你好，介绍一下你自己');
  console.log(`   🤖 回复: ${result1}\n`);

  console.log('📝 测试 2: 触发工具调用（天气查询）');
  console.log('   用户: 北京今天天气怎么样？\n');

  // 用 stream 模式把工具调用过程可视化
  const subscription = agent.stream('北京今天天气怎么样？', {
    onStep: (step, max) => console.log(`   ⏳ Step ${step}/${max}`),
    onToolCall: name => console.log(`   🔧 调用工具: ${name}`),
    onToolResult: (name, result) =>
      console.log(`   ✅ 工具结果: ${name} → ${result.substring(0, 80)}...`),
    onComplete: output => console.log(`   🏁 完成: ${output.substring(0, 100)}`),
    onEvent: event => {
      if (event.type === 'llm.response' && event.content) {
        console.log(`   💬 LLM: ${event.content.substring(0, 80)}`);
      }
    },
  });
  await subscription.result;
}

// ============================================================
// 10. 场景 B: L3 API — ContextBuilder + 事件监听 + 插件
// ============================================================

async function scenarioB_fullPipeline(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  场景 B: L3 API — 全管线 (事件监听 + 插件 + 检查点 + 指标)');
  console.log('═'.repeat(60) + '\n');

  const llm = new SmartMockLLM();
  const metrics = new ConsoleMetrics();
  const tracer = new ConsoleTracer();
  const checkpointStorage = new DemoCheckpointStorage();

  // 用 AgentContextBuilder (L3 API) 手动组装 — 支持 withTracer/withMetrics
  const ctx: AgentContext = AgentContextBuilder.create()
    .withSessionId(generateSessionId('pipeline'))
    .withAgentName('pipeline-agent')
    .withLLM(llm)
    .withTools([weatherTool, calculatorTool])
    .withMemory(new InMemoryStore())
    .withPauseController(new DefaultPauseController())
    .withCheckpoint(checkpointStorage)
    .withTracer(tracer)
    .withMetrics(metrics)
    .build();

  console.log(
    `✅ Context 已构建: sessionId=${ctx.sessionId}, tools=${ctx.tools.list().join(', ')}\n`
  );

  // 创建 Agent Loop
  const { createAgentLoop } = await import('../src/loop/agent-loop.js');
  const loop = createAgentLoop(ctx, {
    model: { provider: 'mock', model: 'mock-v1' },
    maxSteps: 8,
    maxLLMRepairAttempts: 2,
    parallelToolCalls: true,
    checkpoint: { enabled: true, interval: 'llm_response' },
  });

  // 事件统计收集器
  const collector = createRunStatsCollector();

  // 监听所有事件
  const unsub = loop.onAny((event) => {
    // 收集事件
    collector.handler(event);

    // 日志输出
    const prefix = `[${event.type}]`;
    
    switch (event.type) {
      case 'agent.start':
        console.log(`  📋 ${prefix} sessionId=${event.sessionId}`);
        break;
      case 'llm.request':
        console.log(`  ℹ️  ${prefix}`);
        break;
      case 'llm.response':
        console.log(`  💬 ${prefix} content=${event.content?.substring(0, 60)}...`);
        break;
      case 'tool.call':
        console.log(`  🔧 ${prefix} ${event.toolName}`);
        break;
      case 'tool.result':
        console.log(`  ✅ ${prefix} ${event.toolName}`);
        break;
      case 'agent.complete':
        console.log(`  🏁 ${prefix} output=${event.output?.substring(0, 60)}...`);
        break;
    }

    // 指标记录
    if (event.type === 'llm.response' && event.usage) {
      metrics.increment('llm.calls');
      metrics.increment('llm.prompt_tokens', event.usage.promptTokens);
      metrics.increment('llm.completion_tokens', event.usage.completionTokens);
      metrics.histogram('llm.response_tokens', event.usage.completionTokens);
    }
    if (event.type === 'tool.result') {
      metrics.increment('tool.executions');
    }
  });

  // 运行 Agent
  console.log('🚀 开始运行 Agent...\n');
  const startTime = Date.now();

  await loop.run('帮我查一下北京天气，然后计算 25 乘以 4 加 13');
  unsub();

  const stats = collector.getStats(startTime);

  console.log('\n' + '─'.repeat(40));
  console.log(`📊 事件统计: 收到 ${stats.totalEvents} 个事件`);

  console.log(`   总事件: ${stats.totalEvents}`);
  console.log(`   LLM 调用: ${stats.llmCalls}`);
  console.log(`   工具执行: ${stats.toolExecutions}`);
  console.log(
    `   Token: prompt=${stats.promptTokens}, completion=${stats.completionTokens}`
  );
  console.log(`   耗时: ${stats.durationMs}ms`);

  console.log(metrics.report());

  // 检查点统计
  console.log(`\n💾 检查点: 共保存 ${checkpointStorage.getSaveCount()} 次`);
}

// ============================================================
// 11. 场景 C: 插件系统 + 记忆压缩
// ============================================================

async function scenarioC_pluginsAndCompaction(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  场景 C: 插件系统 + 记忆压缩');
  console.log('═'.repeat(60) + '\n');

  const llm = new SmartMockLLM();

  // — 插件管理器 —
  const pluginManager = createPluginManager();
  pluginManager.register(loggingPlugin); // 内置日志插件
  pluginManager.register(metricsPlugin); // 内置指标插件
  pluginManager.register(billingPlugin); // 自定义计费插件

  console.log(
    `🔌 已注册插件: ${pluginManager
      .getAll()
      .map(p => p.name)
      .join(', ')}\n`
  );

  // — 记忆压缩 —
  const compaction = createTruncateCompactionManager(10); // 保留最近 10 条消息
  console.log('🧠 记忆压缩: 策略=truncate-oldest, preserveRecent=10\n');

  // 模拟长对话来触发压缩
  const messages: Message[] = [];
  for (let i = 1; i <= 20; i++) {
    messages.push({ role: 'user', content: `这是第 ${i} 条消息` });
    messages.push({ role: 'assistant', content: `回复第 ${i} 条消息` });
  }

  console.log(`📦 压缩前: ${messages.length} 条消息`);
  const compactionCtx = compaction.createContext('demo-session', messages, 4000);
  console.log(`   估算 Token: ${compactionCtx.currentTokenEstimate}`);
  console.log(`   是否需要压缩: ${compaction.needsCompaction(compactionCtx)}`);

  if (compaction.needsCompaction(compactionCtx)) {
    const result = await compaction.compact(compactionCtx);
    console.log(`\n✂️  压缩完成:`);
    console.log(`   策略: ${result.strategy}`);
    console.log(`   压缩前: ${result.tokensBefore} tokens, ${messages.length} 条消息`);
    console.log(`   压缩后: ${result.tokensAfter} tokens, ${result.messages.length} 条消息保留`);
    console.log(`   移除: ${result.removedCount} 条消息`);
  }

  // 禁用压缩的场景
  const disabled = createDisabledCompactionManager();
  console.log(`\n🚫 禁用压缩: ${disabled.getConfig().enabled}`);

  // 使用 createAgent 做一轮简单对话，展示插件如何工作
  const agent = createAgent({
    name: 'plugin-demo',
    model: { provider: 'mock', model: 'mock-v1' },
    maxSteps: 3,
    llmAdapter: llm,
    tools: [],
  });

  console.log('\n📝 带 Plugin 的简单对话:');
  const result = await agent.run('你好');
  console.log(`   🤖 回复: ${result.substring(0, 80)}`);
}

// ============================================================
// 12. 场景 D: 检查点保存与恢复模拟
// ============================================================

async function scenarioD_checkpointRecovery(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  场景 D: 检查点保存 → 序列化 → 恢复');
  console.log('═'.repeat(60) + '\n');

  // 模拟一个运行中的 Agent 状态
  const sessionId = generateSessionId('recovery');
  const state = createInitialState({
    sessionId,
    agentName: 'recovery-agent',
    model: { provider: 'openai', model: 'gpt-4o' },
    maxSteps: 10,
  });

  // 创建检查点
  const cp = createCheckpoint({
    id: 'cp-demo-001',
    sessionId,
    position: 'after_llm',
    state: {
      ...state,
      step: 3,
      messages: [
        { role: 'user', content: '帮我分析数据' },
        { role: 'assistant', content: '好的，我来分析...' },
        { role: 'tool', content: '数据已加载', toolCallId: 'tc-load' },
      ],
    },
  });

  console.log('📦 创建检查点:');
  console.log(`   ID: ${cp.id}`);
  console.log(`   Session: ${cp.sessionId}`);
  console.log(`   Position: ${cp.position}`);
  console.log(`   Step: ${cp.state.step}`);
  console.log(`   Messages: ${cp.state.messages.length} 条`);

  // 序列化 → JSON 字符串
  console.log('\n💾 序列化检查点...');
  const json = serializeCheckpoint(cp);
  console.log(`   JSON 长度: ${json.length} 字节`);

  // 反序列化 → 恢复检查点
  console.log('\n📤 反序列化检查点...');
  const restored = deserializeCheckpoint(json);
  console.log(`   ID 匹配: ${restored.id === cp.id}`);
  console.log(`   Position 匹配: ${restored.position === cp.position}`);
  console.log(`   Step 匹配: ${restored.state.step === cp.state.step}`);
  console.log(`   Messages 匹配: ${restored.state.messages.length === cp.state.messages.length}`);

  // 保存到 DemoCheckpointStorage
  const storage = new DemoCheckpointStorage();
  await storage.save(cp);
  const loaded = await storage.load(sessionId);
  console.log(`\n💾 从存储加载:`);
  console.log(`   加载成功: ${loaded !== null}`);
  if (loaded) {
    console.log(`   Step: ${loaded.state.step}`);
    console.log(`   Messages: ${loaded.state.messages.length} 条`);
  }
}

// ============================================================
// 13. 场景 E: 预设配置 & 自定义事件处理
// ============================================================

async function scenarioE_operatorPresets(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  场景 E: 预设配置 + 自定义事件处理');
  console.log('═'.repeat(60) + '\n');

  const llm = new SmartMockLLM();
  const customMetrics = new ConsoleMetrics();

  // 方式 1: Debug Preset
  console.log('🔧 方式 1: Debug Preset');
  const debugAgent = createAgent({
    name: 'debug-agent',
    model: { provider: 'mock', model: 'mock-v1' },
    maxSteps: 3,
    llmAdapter: llm,
    tools: [],
    preset: 'debug', // 内置 debug 预设
  });

  const debugResult = await debugAgent.run('你好');
  console.log(`   结果: ${debugResult.substring(0, 60)}...\n`);

  // 方式 2: Test Preset — 收集所有事件用于断言
  console.log('🔧 方式 2: Test Preset (事件收集)');

  const testAgent = createAgent({
    name: 'test-agent',
    model: { provider: 'mock', model: 'mock-v1' },
    maxSteps: 3,
    llmAdapter: llm,
    tools: [],
    preset: 'test',
  });

  // preset='test' 在 createAgent 中配置事件收集
  const testResult = await testAgent.run('测试消息');
  console.log(`   结果: ${testResult.substring(0, 60)}...\n`);

  // 方式 3: 自定义事件处理 — 使用 onAny 实现类似操作符的效果
  console.log('🔧 方式 3: 自定义事件处理 (onAny)');
  const customAgent = createAgent({
    name: 'custom-preset-agent',
    model: { provider: 'mock', model: 'mock-v1' },
    maxSteps: 3,
    llmAdapter: llm,
    tools: [calculatorTool],
  });

  // 通过 onAny 实现自定义日志 + 指标收集
  const unsub = customAgent.onAny((event) => {
    // 自定义日志
    console.log(`  [custom] ${event.type}`);

    // 自定义指标收集
    if (event.type === 'llm.response' && event.usage) {
      customMetrics.increment('custom.llm.calls');
      customMetrics.increment('custom.llm.prompt_tokens', event.usage.promptTokens);
      customMetrics.increment('custom.llm.completion_tokens', event.usage.completionTokens);
    }
    if (event.type === 'tool.call') {
      customMetrics.increment('custom.tool.calls');
    }
  });

  const customResult = await customAgent.run('帮我计算');
  unsub();
  console.log(`   结果: ${customResult.substring(0, 60)}`);
  console.log(customMetrics.report());
}

// ============================================================
// 14. 场景 F: 资源监控与运行时保护
// ============================================================

async function scenarioF_resourceMonitoring(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  场景 F: 资源监控与运行时保护');
  console.log('═'.repeat(60) + '\n');

  const monitor = new ResourceMonitor({
    intervalMs: 500,
    memoryWarningThreshold: 0.7,
    memoryCriticalThreshold: 0.9,
  });

  // 获取单次快照
  const snapshot = monitor.collect();
  console.log('📊 资源快照:');
  console.log(
    `   堆内存: ${(snapshot.memory.heapUsed / 1024 / 1024).toFixed(2)} / ${(snapshot.memory.heapTotal / 1024 / 1024).toFixed(2)} MB`
  );
  console.log(`   RSS: ${(snapshot.memory.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   压力等级: ${monitor.getPressure(snapshot)}`);
  console.log(`   格式化: ${monitor.format(snapshot)}`);

  // 在 Agent 运行中集成资源监控
  const llm = new SmartMockLLM();
  const agent = createAgent({
    name: 'monitored-agent',
    model: { provider: 'mock', model: 'mock-v1' },
    maxSteps: 3,
    llmAdapter: llm,
    tools: [],
  });

  console.log('\n🚀 运行 Agent 并监控资源...');
  const startMem = monitor.collect().memory.heapUsed;
  await agent.run('你好');
  const endMem = monitor.collect().memory.heapUsed;

  console.log(`\n📊 运行前后内存变化:`);
  console.log(`   运行前: ${(startMem / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   运行后: ${(endMem / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   差值: ${((endMem - startMem) / 1024).toFixed(2)} KB`);
}

// ============================================================
// 15. 主入口
// ============================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          AgentForge 端到端全流程示例                       ║');
  console.log('║                                                            ║');
  console.log('║  场景 A: L2 API — 5 行代码创建 Agent                      ║');
  console.log('║  场景 B: L3 API — 全管线 (事件监听 + 插件 + 检查点 + 指标)  ║');
  console.log('║  场景 C: 插件系统 + 记忆压缩                               ║');
  console.log('║  场景 D: 检查点保存 → 序列化 → 恢复                        ║');
  console.log('║  场景 E: 预设配置 + 自定义事件处理                          ║');
  console.log('║  场景 F: 资源监控与运行时保护                               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await scenarioA_createAgent();
    await scenarioB_fullPipeline();
    await scenarioC_pluginsAndCompaction();
    await scenarioD_checkpointRecovery();
    await scenarioE_operatorPresets();
    await scenarioF_resourceMonitoring();

    console.log('\n' + '═'.repeat(60));
    console.log('  ✅ 所有场景运行完成！');
    console.log('═'.repeat(60) + '\n');
  } catch (error) {
    console.error('❌ 示例执行出错:', error);
    process.exit(1);
  }
}

main();
