/**
 * Kitchen Sink — 框架全特性演示 (四区域 API)
 *
 * 在一个 Agent 中展示 AgentForge 全部已实现能力：
 *  - Model Resolution + Custom Provider (DeepSeek)          [Issue 03]
 *  - Agent + Agentic Loop (多轮迭代)                         [Issue 02]
 *  - Tool System (Zod schema + hooks)                        [Issue 05]
 *  - Streaming 输出
 *  - Full 8-stage Pipeline                                   [Issue 06]
 *  - Plugin System (Processor + Tool + Hook + Resource)      [Issue 07]
 *  - Hook System (llm.before / tool.wrap)                    [Issue 07]
 *  - EventBus (task:start/end + agent:start)                 [Issue 07]
 *  - Observability / OTel (OTelBridge + span 树)             [Issue 04, 08]
 *  - Sub-Agents: isolated + summary-only                     [Issue 10]
 *  - Session Persistence (JSONL) + SessionManager            [Issue 09]
 *  - Memory Plugin (InMemoryBackend, automatic trigger)      [Issue 11]
 *  - Compression Plugin (truncate phase)                     [Issue 12]
 *  - Permission Plugin (full-auto mode with rules)           [Issue 13]
 *  - Skill Plugin (inline SkillDefinition)                   [Issue 14]
 *  - Eviction Plugin (InMemoryEvictionStorage, tool.wrap)    [Issue 12]
 *  - Token Usage Tracking
 *  - Echo Tool (built-in)
 *  - Config System (JSONC, multi-layer merge, ModelProfile) [Issue 16]
 *  - MCP Plugin (stdio transport, real server-filesystem)   [Issue 15]
 *  - Async Sub-Agents (ConcurrencyController, TaskManager)  [Issue 17]
 *
 * 运行: npx tsx examples/kitchen-sink.ts
 */

import {
  Agent,
  registerProvider,
  EventBus,
  createSubAgentTool,
  FilesystemSessionStorage,
  SessionPersistence,
  SessionManagerImpl,
  ConfigLoader,
  matchProfile,
  applyProfile,
  resolveDynamic,
  ConcurrencyController,
  TaskManagerImpl,
} from '@agentforge/core';
import { OTelBridge } from '@agentforge/observability';
import {
  memoryPlugin,
  InMemoryBackend,
  compressionPlugin,
  permissionPlugin,
  skillPlugin,
  evictionPlugin,
  InMemoryEvictionStorage,
  mcpPlugin,
} from '@agentforge/plugins';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { HarnessAPI, PluginRegistration, Tool } from '@agentforge/sdk';
import type { SkillDefinition } from '@agentforge/plugins';
import { z } from 'zod';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

// MCP server filesystem 入口 (Windows 兼容 — 避免 spawn('npx'))
const require = createRequire(import.meta.url);
const serverPkg = require.resolve('@modelcontextprotocol/server-filesystem/package.json');
const serverEntry = resolve(dirname(serverPkg), 'dist/index.js');

// ===========================================================================
// 0. Model Resolution — 注册 DeepSeek provider                    [Issue 03]
// ===========================================================================

registerProvider('deepseek', (modelId: string) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  } as any);
  return sdk.languageModel(modelId);
});

// ===========================================================================
// 1. 基础设施 — EventBus / OTel / Session Storage       [Issue 04, 08, 09]
// ===========================================================================

const bus = new EventBus();

const otelExporter = new InMemorySpanExporter();
const otelProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(otelExporter)],
});

bus.subscribe('span.end', (data: any) => {
  console.log(`  [OTel] span.end → ${data.name} (${data.spanContext.traceId.slice(0, 8)}...)`);
});
bus.subscribe('task:start', (data: any) => console.log(`  [Event] task:start → ${data.name}`));
bus.subscribe('task:end', (data: any) => {
  const info = data.error
    ? `error: ${data.error.slice(0, 60)}`
    : `ok (${data.result.response.length} chars)`;
  console.log(`  [Event] task:end → ${data.name} ${info}`);
});

const sessionBase = mkdtempSync(join(tmpdir(), 'agentforge-ks-'));
const storage = new FilesystemSessionStorage(sessionBase);
const persistence = new SessionPersistence(bus, storage);
const sessionMgr = new SessionManagerImpl(storage, bus);

// ===========================================================================
// 2. 工具定义 — getWeather + calculator                        [Issue 05]
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
    return w
      ? `${city}：${w.condition}，气温 ${w.temp}°C，湿度 ${w.humidity}%`
      : `${city}：暂无数据`;
  },
};

const calculatorTool: Tool<{ expression: string }, string> = {
  name: 'calculator',
  description: '计算简单的数学表达式，如 "2+3" 或 "10*5"',
  inputSchema: z.object({ expression: z.string().describe('数学表达式') }),
  execute: async ({ expression }) => {
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

// ===========================================================================
// 3. 子代理 — translator (isolated) + codeReviewer (summary-only)  [Issue 10]
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
// 4. 插件                                                [Issue 07, 11-14]
// ===========================================================================

// 4a. Custom monitoring plugin (Processor + Hook + Resource + Subscribe)
function monitoringPlugin(api: HarnessAPI): PluginRegistration {
  api.registerProcessor('buildContext', {
    stage: 'buildContext',
    execute: async (ctx) => ({
      ...ctx,
      agent: {
        ...ctx.agent,
        promptFragments: [...ctx.agent.promptFragments, `[monitoring] buildContext at ${new Date().toISOString()}]`],
      },
    }),
  });

  api.registerProcessor('processOutput', {
    stage: 'processOutput',
    execute: async (ctx) => {
      const usage = ctx.iteration.tokenUsage;
      const tokens = usage ? ` (tokens: ${usage.input}+${usage.output})` : '';
      console.log(`  [Plugin] processOutput — response ${ctx.iteration.response?.length ?? 0} chars${tokens}`);
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

// 4b-4f: Shared plugin instances
const memoryBackend = new InMemoryBackend();
const evictionStorage = new InMemoryEvictionStorage();

const demoSkills: SkillDefinition[] = [
  {
    name: 'summarize',
    description: '文本摘要技能：将长文本压缩为简短摘要',
    content: '你收到一段文本，请用2-3句话概括要点。只输出摘要。',
  },
];

// ===========================================================================
// 5. 创建 Agent + 注入全部特性                       [Issue 02, 06, 07]
// ===========================================================================

const tracer = new OTelBridge({ tracerProvider: otelProvider, eventBus: bus });

const agent = new Agent(
  {
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: [
      '你是一个全能助手，可以：',
      '- 调用 getWeather 查天气',
      '- 调用 calculator 计算',
      '- 调用 translator 翻译文本（传入 task 字段）',
      '- 调用 codeReviewer 审查代码（传入 task 字段）',
      '- 调用 echo 回显文本',
      '用中文回答，简洁清晰。',
    ].join('\n'),
    tools: [getWeatherTool, calculatorTool, translatorTool, codeReviewerTool],
    maxIterations: 5,
  },
  { tracer },
);

// Custom guardrail processor
agent.use({
  stage: 'processStepOutput',
  execute: async (ctx) => {
    const resp = ctx.iteration.response;
    if (resp && resp.length > 2000) console.log('  [Guardrail] 输出较长，建议压缩');
    return ctx;
  },
});

// All plugins via agent.use() → registered on internal PluginManager
agent.use(monitoringPlugin);
agent.use(memoryPlugin({ backend: memoryBackend, triggerMode: { type: 'automatic', onLoad: 'always' } }));
agent.use(compressionPlugin({ maxContextTokens: 8000, phases: [{ type: 'truncate', maxLength: 500 }] }));
agent.use(permissionPlugin({
  mode: 'full-auto',
  rules: [
    { tool: 'getWeather', action: 'allow' },
    { tool: 'calculator', action: 'allow' },
    { tool: 'translator', action: 'allow' },
    { tool: 'codeReviewer', action: 'allow' },
    { tool: 'echo', action: 'allow' },
  ],
}));
agent.use(skillPlugin({ skills: demoSkills }));
agent.use(evictionPlugin({ maxSize: 500, storage: evictionStorage }));

// ===========================================================================
// 6. 运行 3 轮对话 + 后处理
// ===========================================================================

async function runQuery(label: string, query: string) {
  const session = await sessionMgr.start(query);
  agent.pluginManager.emitEvent('agent:start', { sessionId: session.sessionId });

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
  console.log('=== AgentForge Kitchen Sink — 全特性演示 (四区域 API) ===\n');

  await agent.pluginManager.initializeAll();
  console.log('[Init] 基础设施就绪\n');

  // 第 1 轮: 工具调用 (天气)
  await runQuery('第1轮: 工具调用', '北京今天天气怎么样？');

  // 第 2 轮: 子代理 (翻译, isolated)
  await runQuery('第2轮: 子代理翻译', '请把"人工智能正在改变世界"翻译成英文');

  // 第 3 轮: 子代理 (代码审查, summary-only)
  await runQuery('第3轮: 子代理代码审查', '请审查这段代码: function add(a: any, b: any) { return a + b; }');

  // =========================================================================
  // 7. 后处理: Session / OTel / Memory / Plugin shutdown
  // =========================================================================

  console.log(`\n${'='.repeat(60)}`);
  console.log('\n--- Session 列表 ---');
  await persistence.stop();
  const sessions = await sessionMgr.list();
  for (const s of sessions) {
    console.log(`  ${s.sessionId.slice(0, 8)}... status=${s.status}${s.parentSessionId ? ` parent=${s.parentSessionId.slice(0, 8)}...` : ''}`);
  }

  if (sessions.length > 0) {
    const jsonlPath = join(sessionBase, sessions[0].sessionId, 'events.jsonl');
    try {
      const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim()).length;
      console.log(`  [JSONL] 第一个会话 ${lines} 条事件`);
    } catch { /* ignore */ }
  }

  console.log('\n--- OTel Span 树 ---');
  await otelProvider.forceFlush();
  const spans = otelExporter.getFinishedSpans();
  console.log(`  共 ${spans.length} 个 span`);
  for (const span of spans.slice(0, 8)) {
    const parent = (span as any).parentSpanContext as { spanId: string } | undefined;
    const indent = parent?.spanId ? '  └─ ' : '';
    console.log(`${indent}${span.name} [${span.spanContext().spanId.slice(0, 8)}]`);
  }
  if (spans.length > 8) console.log(`  ... 还有 ${spans.length - 8} 个 span`);

  console.log('\n--- 关闭 ---');
  await agent.pluginManager.shutdown();
  console.log(`  PluginManager shutdown 完成, errors: ${agent.pluginManager.getErrors().length}`);

  // =========================================================================
  // 8. Region 5: Config + MCP + Async Sub-Agents               [Issue 15-17]
  // =========================================================================

  console.log(`\n${'='.repeat(60)}`);
  console.log('=== Region 5: Config + MCP + Async Sub-Agents ===\n');

  // --- 8a. Config (Issue 16) ---
  console.log('--- 8a. Config: JSONC 多层合并 + ModelProfile ---');

  const configDir = mkdtempSync(join(tmpdir(), 'agentforge-cfg-'));
  const configJsonc = join(configDir, 'config.jsonc');
  writeFileSync(configJsonc, `{
    // AgentForge 项目配置 (JSONC — 支持注释)
    "modelProfiles": [
      {
        "modelPattern": "deepseek",
        "systemPromptSuffix": "[Config] 当前模型为 DeepSeek，请用简洁中文回答。"
      }
    ],
    /* 工具白名单 */
    "tools": {
      "enabled": ["getWeather", "calculator", "translator", "codeReviewer", "echo"]
    },
    "plugins": ["memory", "compression"],
  }`);

  const configLoader = new ConfigLoader();
  const config = await configLoader.load({
    env: '{"plugins": ["memory"]}',
    project: configJsonc,
    session: { session: { storage: 'memory' } },
  });

  console.log(`  [Config] 合并结果: plugins=${JSON.stringify(config.plugins)}, storage=${config.session?.storage}`);
  console.log(`  [Config] modelProfiles: ${(config.modelProfiles ?? []).length} 个`);

  if (config.modelProfiles && config.modelProfiles.length > 0) {
    const profile = matchProfile('deepseek/deepseek-v4-flash', config.modelProfiles);
    if (profile) {
      console.log(`  [Config] ModelProfile 匹配: suffix="${profile.systemPromptSuffix}"`);
    }
  }

  const dynamicValue = await resolveDynamic(
    (ctx) => `[Dynamic] 会话 ${ctx.sessionId.slice(0, 8)} 于 ${new Date().toISOString()} 创建`,
    { input: 'test', sessionId: 'demo-session-001', metadata: {} },
  );
  console.log(`  [Config] resolveDynamic: ${dynamicValue}`);

  rmSync(configDir, { recursive: true, force: true });

  // --- 8b. MCP (Issue 15) ---
  console.log('\n--- 8b. MCP: 真实 filesystem server ---');

  const mcpDataDir = mkdtempSync(join(tmpdir(), 'agentforge-mcp-'));
  writeFileSync(join(mcpDataDir, 'notes.txt'), '这是 AgentForge 的 MCP 集成测试文件。\n框架支持 MCP 工具的自动发现和调用。');
  writeFileSync(join(mcpDataDir, 'status.txt'), '状态: 正常\n版本: 0.0.1');

  const mcpAgent = new Agent(
    {
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: '你是一个文件管理助手。你可以列出目录、读取文件。用中文回答。',
      tools: [],
      maxIterations: 3,
    },
    { eventBus: bus } as any,
  );

  mcpAgent.use(mcpPlugin({
    servers: [{
      name: 'filesystem',
      transport: 'stdio',
      command: 'node',
      args: [serverEntry, mcpDataDir],
    }],
  }));

  await mcpAgent.pluginManager.initializeAll();
  const mcpTools = mcpAgent['registry'].getAll();
  console.log(`  [MCP] 发现 ${mcpTools.length} 个工具: ${mcpTools.slice(0, 3).map((t: any) => t.name).join(', ')}...`);

  const mcpQuery = '请列出当前目录的文件，然后读取 notes.txt 的内容。';
  console.log(`  [MCP] 用户: ${mcpQuery}`);
  let mcpResponse = '';
  for await (const chunk of mcpAgent.stream(mcpQuery)) {
    mcpResponse += chunk;
  }
  console.log(`  [MCP] 助手: ${mcpResponse.slice(0, 200)}${mcpResponse.length > 200 ? '...' : ''}`);

  await mcpAgent.pluginManager.shutdown();
  rmSync(mcpDataDir, { recursive: true, force: true });
  console.log('  [MCP] MCP server 已关闭');

  // --- 8c. Async Sub-Agents (Issue 17) ---
  console.log('\n--- 8c. Async Sub-Agents: 并发翻译任务 ---');

  const cc = new ConcurrencyController([{ key: 'translate', maxConcurrent: 2 }]);
  const tm = new TaskManagerImpl({
    eventBus: bus,
    concurrencyController: cc,
    runAgentFn: async (agentConfig, input, _signal) => {
      const { Agent: AgentCtor } = await import('@agentforge/core');
      const taskAgent = new AgentCtor(agentConfig, { eventBus: bus } as any);
      const response = await taskAgent.run(input);
      return { response, tokenUsage: { input: 0, output: 0 }, sessionId: crypto.randomUUID() };
    },
  });

  const languages = ['英语', '日语', '法语'] as const;
  const sourceText = 'AgentForge 是一个功能强大的 AI Agent 框架';

  const handles = await Promise.all(
    languages.map((lang) =>
      tm.launch(
        {
          name: `translate-to-${lang}`,
          description: `翻译成${lang}`,
          model: 'deepseek/deepseek-v4-flash',
          systemPrompt: `你是翻译专家。将用户给你的文本翻译成${lang}。只输出翻译结果。`,
          contextPolicy: 'isolated',
          maxIterations: 1,
          concurrencySlot: { key: 'translate', maxConcurrent: 2 },
        } as any,
        sourceText,
      ),
    ),
  );

  console.log(`  [Async] 启动 ${handles.length} 个翻译任务 (并发上限: 2)`);

  handles[2].cancel();
  console.log(`  [Async] 已取消: ${languages[2]} 翻译任务`);

  const results = new Map<string, string>();
  await new Promise<void>((resolveAll) => {
    let pending = 2;
    for (let i = 0; i < 2; i++) {
      handles[i].on_complete((result) => {
        results.set(languages[i], result.response);
        pending--;
        if (pending === 0) resolveAll();
      });
    }
    setTimeout(resolveAll, 60_000);
  });

  console.log('  [Async] 翻译结果:');
  for (const [lang, text] of results) {
    console.log(`    ${lang}: ${text}`);
  }

  const allTasks = tm.list();
  console.log(`  [Async] 任务列表: ${allTasks.map((t) => `${t.taskId.slice(0, 8)}(${t.status})`).join(', ')}`);
  console.log(`  [Async] 并发槽位: translate=${cc.getActiveCount('translate')}/2`);

  rmSync(sessionBase, { recursive: true, force: true });
  console.log('\n=== 演示完成 ===');
}

main().catch(console.error);
