/**
 * Kitchen Sink — 框架全特性演示
 *
 * 在一个 Agent 中展示 AgentForge 全部已实现能力：
 *  - Model Resolution + Custom Provider (DeepSeek)
 *  - Agent + Agentic Loop (多轮迭代)
 *  - Tool System (Zod schema + hooks)
 *  - Streaming 输出
 *  - Custom Processors (guardrail + 监控)
 *  - Plugin System (Processor + Tool + Hook + Resource + EventBus)
 *  - Hook System (llm.before)
 *  - EventBus (task:start/end + agent:start)
 *  - Observability / OTel (OTelBridge + span 树)
 *  - Sub-Agents: isolated (translator) + summary-only (codeReviewer)
 *  - Session Persistence (JSONL) + SessionManager
 *  - Built-in Echo Tool
 *  - Token Usage Tracking
 *
 * 运行: npx tsx examples/kitchen-sink.ts
 */

import {
  Agent,
  registerProvider,
  EventBus,
  PluginManager,
  createSubAgentTool,
  FilesystemSessionStorage,
  SessionPersistence,
  SessionManagerImpl,
} from '@agentforge/core';
import { OTelBridge } from '@agentforge/observability';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { HarnessAPI, PluginRegistration, Tool } from '@agentforge/sdk';
import { z } from 'zod';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ===========================================================================
// 0. Model Resolution — 注册 DeepSeek provider
// ===========================================================================

registerProvider('deepseek', (modelId) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  });
  return sdk.languageModel(modelId);
});

// ===========================================================================
// 1. 基础设施 — EventBus / OTel / Session / PluginManager
// ===========================================================================

const bus = new EventBus();

// OTel: InMemorySpanExporter 收集 span
const exporter = new InMemorySpanExporter();
const otelProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
bus.subscribe('span.end', (data: any) => {
  console.log(`  [OTel] span.end → ${data.name} (${data.spanContext.traceId.slice(0, 8)}...)`);
});

// Sub-agent events
bus.subscribe('task:start', (data: any) => console.log(`  [Event] task:start → ${data.name}`));
bus.subscribe('task:end', (data: any) => {
  const info = data.error ? `error: ${data.error.slice(0, 60)}` : `ok (${data.result.response.length} chars)`;
  console.log(`  [Event] task:end → ${data.name} ${info}`);
});

// Session persistence
const sessionBase = mkdtempSync(join(tmpdir(), 'agentforge-ks-'));
const storage = new FilesystemSessionStorage(sessionBase);
const persistence = new SessionPersistence(bus, storage);
const sessionMgr = new SessionManagerImpl(storage, bus);

// ===========================================================================
// 2. 工具定义 — getWeather + calculator
// ===========================================================================

const getWeatherTool: Tool<{ city: string }, string> = {
  name: 'getWeather',
  description: '获取指定城市的当前天气信息',
  inputSchema: z.object({ city: z.string().describe('城市名称') }),
  execute: async ({ city }) => {
    const data: Record<string, { temp: number; condition: string; humidity: number }> = {
      '北京': { temp: 22, condition: '晴', humidity: 45 },
      '上海': { temp: 26, condition: '多云', humidity: 72 },
      '东京': { temp: 19, condition: '小雨', humidity: 80 },
    };
    const w = data[city];
    return w ? `${city}：${w.condition}，气温 ${w.temp}°C，湿度 ${w.humidity}%` : `${city}：暂无数据`;
  },
};

// ===========================================================================
// 3. 子代理工具 — translator (isolated) + codeReviewer (summary-only)
// ===========================================================================

const translatorTool = createSubAgentTool(
  {
    name: 'translator',
    description: '将中文文本翻译成英文。传入 task 字段为需要翻译的文本。',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你是专业翻译。用户给你中文文本，你只返回英文翻译，不要解释。',
    contextPolicy: 'isolated',
    maxIterations: 1,
    inputSchema: z.object({ task: z.string() }),
  },
  { model: 'deepseek/deepseek-v4-flash', tools: [], eventBus: bus },
);

const codeReviewerTool = createSubAgentTool(
  {
    name: 'codeReviewer',
    description: '审查代码片段，指出潜在问题。传入 task 字段为代码片段。',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你是代码审查专家。简要指出代码问题，不超过3条。',
    contextPolicy: 'summary-only',
    maxIterations: 1,
    inputSchema: z.object({ task: z.string() }),
  },
  {
    model: 'deepseek/deepseek-v4-flash',
    tools: [],
    eventBus: bus,
    getSessionState: () => ({
      messageHistory: [
        { role: 'user', content: '我们在做一个 TypeScript Agent 框架' },
        { role: 'assistant', content: '了解，你们在构建 AgentForge' },
      ],
    }),
  },
);

// ===========================================================================
// 4. 插件 — monitoringPlugin (Processor + Hook + Resource + Subscribe)
// ===========================================================================

function monitoringPlugin(api: HarnessAPI): PluginRegistration {
  api.registerProcessor('buildContext', {
    stage: 'buildContext',
    execute: async (ctx) => {
      return { ...ctx, pipeline: { ...ctx.pipeline, startTime: Date.now() } };
    },
  });

  api.registerProcessor('processOutput', {
    stage: 'processOutput',
    execute: async (ctx) => {
      const elapsed = Date.now() - ((ctx.pipeline.startTime as number) ?? 0);
      console.log(`  [Plugin] processOutput — 耗时 ${elapsed}ms`);
      return ctx;
    },
  });

  api.registerHook({
    point: 'llm.before',
    handler: () => console.log('  [Hook:llm.before] LLM 调用即将开始'),
  });

  api.subscribe('agent:start', (data: any) =>
    console.log(`  [Event:agent:start] 会话 ${data?.sessionId?.slice(0, 8) ?? 'unknown'}...`),
  );

  api.registerResource({
    id: 'monitor',
    type: 'service',
    config: {},
    start: async () => {
      console.log('  [Resource:monitor] 启动');
      return { status: 'running' };
    },
    stop: async () => console.log('  [Resource:monitor] 关闭'),
  });

  return {};
}

// ===========================================================================
// 5. 创建 Agent + 注入全部特性
// ===========================================================================

const tracer = new OTelBridge({ tracerProvider: otelProvider, eventBus: bus });

const agent = new Agent(
  {
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: [
      '你是一个全能助手，可以：',
      '- 调用 getWeather 查天气',
      '- 调用 translator 翻译文本（传入 task 字段）',
      '- 调用 codeReviewer 审查代码（传入 task 字段）',
      '- 调用 echo 回显文本',
      '用中文回答，简洁清晰。',
    ].join('\n'),
    tools: [getWeatherTool, translatorTool, codeReviewerTool],
    maxIterations: 5,
  },
  { tracer },
);

// Custom Processors
agent.use({
  stage: 'processStepOutput',
  execute: async (ctx) => {
    const resp = ctx.pipeline.response as string | undefined;
    if (resp && resp.length > 2000) console.log('  [Guardrail] 输出较长，建议压缩');
    return ctx;
  },
});

// PluginManager
const pluginMgr = new PluginManager(agent.pipelineRunner, agent.toolRegistry);
pluginMgr.initializePlugin(monitoringPlugin);

// ===========================================================================
// 6. 运行 3 轮对话
// ===========================================================================

async function runQuery(label: string, query: string) {
  const session = await sessionMgr.start(query);
  pluginMgr.emitEvent('agent:start', { sessionId: session.sessionId });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${label}] 用户: ${query}`);
  console.log('助手: ');

  let full = '';
  for await (const chunk of agent.stream(query)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log(`\n--- ${full.length} 字符 ---`);
}

async function main() {
  console.log('=== AgentForge Kitchen Sink — 全特性演示 ===\n');

  await pluginMgr.initializeAll();
  console.log('[Init] 基础设施就绪\n');

  // 第 1 轮: 工具调用 (天气)
  await runQuery('第1轮: 工具调用', '北京今天天气怎么样？');

  // 第 2 轮: 子代理 (翻译, isolated)
  await runQuery('第2轮: 子代理翻译', '请把"人工智能正在改变世界"翻译成英文');

  // 第 3 轮: 子代理 (代码审查, summary-only)
  await runQuery('第3轮: 子代理代码审查', '请审查这段代码: function add(a: any, b: any) { return a + b; }');

  // =========================================================================
  // 7. 后处理: Session / OTel / Plugin shutdown
  // =========================================================================

  console.log(`\n${'='.repeat(60)}`);
  console.log('\n--- Session 列表 ---');
  await persistence.stop();
  const sessions = await sessionMgr.list();
  for (const s of sessions) {
    console.log(`  ${s.sessionId.slice(0, 8)}... status=${s.status}${s.parentSessionId ? ` parent=${s.parentSessionId.slice(0, 8)}...` : ''}`);
  }

  // 查看一个 session 的 JSONL 事件数
  if (sessions.length > 0) {
    const jsonlPath = join(sessionBase, sessions[0].sessionId, 'events.jsonl');
    try {
      const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim()).length;
      console.log(`  [JSONL] 第一个会话 ${lines} 条事件`);
    } catch { /* ignore */ }
  }

  console.log('\n--- OTel Span 树 ---');
  await otelProvider.forceFlush();
  const spans = exporter.getFinishedSpans();
  console.log(`  共 ${spans.length} 个 span`);
  for (const span of spans.slice(0, 8)) {
    const parent = (span as any).parentSpanContext as { spanId: string } | undefined;
    const indent = parent?.spanId ? '  └─ ' : '';
    console.log(`${indent}${span.name} [${span.spanContext().spanId.slice(0, 8)}]`);
  }
  if (spans.length > 8) console.log(`  ... 还有 ${spans.length - 8} 个 span`);

  console.log('\n--- 关闭 ---');
  await pluginMgr.shutdown();
  console.log(`  PluginManager shutdown 完成, errors: ${pluginMgr.getErrors().length}`);

  rmSync(sessionBase, { recursive: true, force: true });
  console.log('\n=== 演示完成 ===');
}

main().catch(console.error);
