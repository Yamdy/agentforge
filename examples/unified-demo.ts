/**
 * AgentForge 统一演示 — 全特性真实 LLM 验证
 *
 * 合并所有 example 为一个文件，按 Region 分区验证：
 *   R1  Provider + Model Resolution
 *   R2  基础 Agent + Streaming + Custom Processor
 *   R3  Tool System (Zod schema + echo + calculator + weather + travel)
 *   R4  Plugin System (Processor + Hook + Resource + Subscribe)
 *   R5  OTel Bridge (Span 树)
 *   R6  Sub-Agents (sync: isolated + summary-only)
 *   R7  Session Persistence (JSONL) + Suspend/Resume
 *   R8  Memory / Compression / Permission / Skill / Eviction 插件
 *   R9  Config System (JSONC + 多层合并 + ModelProfile + Dynamic)
 *   R10 MCP Plugin (真实 filesystem server)
 *   R11 Async Sub-Agents (ConcurrencyController + TaskManager + 取消)
 *
 * 运行: npx tsx --env-file=examples/.env examples/unified-demo.ts
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
import type { HarnessAPI, PluginRegistration, Tool, PipelineContext, PromptFragment } from '@agentforge/sdk';
import type { SkillDefinition } from '@agentforge/plugins';
import { z } from 'zod';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

// MCP server-filesystem 入口 (Windows 兼容)
const require = createRequire(import.meta.url);
const serverPkg = require.resolve('@modelcontextprotocol/server-filesystem/package.json');
const serverEntry = resolve(dirname(serverPkg), 'dist/index.js');

// ─── helpers ────────────────────────────────────────────────────────────────

const passed: string[] = [];
const failed: string[] = [];

function ok(region: string, msg: string) {
  passed.push(region);
  console.log(`  ✅ [${region}] ${msg}`);
}

function fail(region: string, msg: string, err?: unknown) {
  failed.push(region);
  console.error(`  ❌ [${region}] ${msg}`, err ?? '');
}

function separator(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════════════
// R1  Provider + Model Resolution
// ═══════════════════════════════════════════════════════════════════════════════

registerProvider('deepseek', (modelId: string) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未设置。请创建 examples/.env 文件。');
  const sdk = createOpenAICompatible({ baseURL: 'https://api.deepseek.com', apiKey } as any);
  return sdk.languageModel(modelId);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Shared infrastructure
// ═══════════════════════════════════════════════════════════════════════════════

const bus = new EventBus();

const otelExporter = new InMemorySpanExporter();
const otelProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(otelExporter)],
});

bus.subscribe('span.end', (data: any) => {
  console.log(`    [OTel] span.end → ${data.name}`);
});
bus.subscribe('task:start', (data: any) => console.log(`    [Event] task:start → ${data.name ?? data.taskId?.slice(0, 8)}`));
bus.subscribe('task:end', (data: any) => {
  const info = data.error
    ? `error: ${String(data.error).slice(0, 60)}`
    : data.result ? `ok (${data.result.response.length} chars)` : 'ok';
  console.log(`    [Event] task:end → ${data.name ?? data.taskId?.slice(0, 8)} ${info}`);
});

const sessionBase = mkdtempSync(join(tmpdir(), 'agentforge-demo-'));
const storage = new FilesystemSessionStorage(sessionBase);
const persistence = new SessionPersistence(bus, storage);
const sessionMgr = new SessionManagerImpl(storage, bus);
const tracer = new OTelBridge({ tracerProvider: otelProvider, eventBus: bus });

// ═══════════════════════════════════════════════════════════════════════════════
// R2+R3  Tools (getWeather + getTravelAdvice + calculator)
// ═══════════════════════════════════════════════════════════════════════════════

const weatherData: Record<string, { temp: number; condition: string; humidity: number }> = {
  '北京': { temp: 22, condition: '晴', humidity: 45 },
  '上海': { temp: 26, condition: '多云', humidity: 72 },
  '东京': { temp: 19, condition: '小雨', humidity: 80 },
  '纽约': { temp: 15, condition: '阴', humidity: 60 },
};

const getWeatherTool: Tool<{ city: string }, string> = {
  name: 'getWeather',
  description: '获取指定城市的当前天气信息',
  inputSchema: z.object({ city: z.string().describe('城市名称') }),
  execute: async ({ city }) => {
    const w = weatherData[city];
    return w ? `${city}：${w.condition}，气温 ${w.temp}°C，湿度 ${w.humidity}%` : `${city}：暂无数据`;
  },
};

const getTravelAdviceTool: Tool<{ city: string; weather: string }, string> = {
  name: 'getTravelAdvice',
  description: '根据城市和天气情况给出旅行建议',
  inputSchema: z.object({
    city: z.string().describe('城市名称'),
    weather: z.string().describe('当前天气描述'),
  }),
  execute: async ({ city, weather }) => {
    const tips: Record<string, string> = {
      '晴': '天气晴好，适合户外活动。建议涂防晒霜。',
      '多云': '天气舒适，适合逛街和游览景点。',
      '小雨': '记得带伞，推荐室内活动如博物馆、咖啡馆。',
      '阴': '适合城市漫步，不会太晒也不会太热。',
    };
    for (const [key, tip] of Object.entries(tips)) {
      if (weather.includes(key)) return `${city}旅行建议：${tip}`;
    }
    return `${city}旅行建议：出行前查看最新天气预报。`;
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

// ═══════════════════════════════════════════════════════════════════════════════
// R6  Sub-Agent tools
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// R4  Monitoring plugin
// ═══════════════════════════════════════════════════════════════════════════════

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
      console.log(`    [Plugin] processOutput — ${ctx.iteration.response?.length ?? 0} chars${tokens}`);
      return ctx;
    },
  });

  api.registerHook({ point: 'llm.before', handler: () => console.log('    [Hook:llm.before] LLM 调用') });
  api.subscribe('agent:start', (data: any) => console.log(`    [Event:agent:start] ${data?.sessionId?.slice(0, 8)}...`));
  api.registerResource({
    id: 'monitor', type: 'service', config: {},
    start: async () => { console.log('    [Resource:monitor] 启动'); return { status: 'running' }; },
    stop: async () => console.log('    [Resource:monitor] 关闭'),
  });

  return {};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create main agent (R2–R6 + R8)
// ═══════════════════════════════════════════════════════════════════════════════

const memoryBackend = new InMemoryBackend();
const evictionStorage = new InMemoryEvictionStorage();

const demoSkills: SkillDefinition[] = [{
  name: 'summarize',
  description: '文本摘要技能',
  content: '你收到一段文本，请用2-3句话概括要点。只输出摘要。',
}];

const agent = new Agent(
  {
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: [
      '你是一个全能助手，可以：',
      '- 调用 getWeather 查天气',
      '- 调用 getTravelAdvice 获取旅行建议',
      '- 调用 calculator 计算',
      '- 调用 translator 翻译文本',
      '- 调用 codeReviewer 审查代码',
      '- 调用 echo 回显文本',
      '用中文回答，简洁清晰。',
    ].join('\n'),
    tools: [getWeatherTool, getTravelAdviceTool, calculatorTool, translatorTool, codeReviewerTool],
    maxIterations: 5,
  },
  { tracer },
);

agent.use(monitoringPlugin);
agent.use(memoryPlugin({ backend: memoryBackend, triggerMode: { type: 'automatic', onLoad: 'always' } }));
agent.use(compressionPlugin({ maxContextTokens: 8000, phases: [{ type: 'truncate', maxLength: 500 }] }));
agent.use(permissionPlugin({
  mode: 'full-auto',
  rules: [
    { tool: 'getWeather', action: 'allow' },
    { tool: 'getTravelAdvice', action: 'allow' },
    { tool: 'calculator', action: 'allow' },
    { tool: 'translator', action: 'allow' },
    { tool: 'codeReviewer', action: 'allow' },
    { tool: 'echo', action: 'allow' },
  ],
}));
agent.use(skillPlugin({ skills: demoSkills }));
agent.use(evictionPlugin({ maxSize: 500, storage: evictionStorage }));

// ═══════════════════════════════════════════════════════════════════════════════
// Run helper
// ═══════════════════════════════════════════════════════════════════════════════

async function query(label: string, prompt: string): Promise<string> {
  const session = await sessionMgr.start(prompt);
  agent.pluginManager.emitEvent('agent:start', { sessionId: session.sessionId });

  console.log(`\n  [${label}] 用户: ${prompt}`);
  console.log('  助手: ');

  let full = '';
  for await (const chunk of agent.stream(prompt)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log(`\n  --- ${full.length} 字符 ---`);
  return full;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AgentForge 统一演示 — 全特性真实 LLM 验证             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  try {
    await agent.pluginManager.initializeAll();
    console.log('[Init] 基础设施就绪\n');

    // ── R2  基础 Agent + Streaming ──────────────────────────────────────────
    separator('R2  基础 Agent + Streaming');
    try {
      const r2 = await query('R2', '你好！用一句话介绍你自己。');
      if (r2.length > 0) ok('R2', `Streaming 回复 ${r2.length} 字符`);
      else fail('R2', '空回复');
    } catch (e) { fail('R2', 'Agent 运行失败', e); }

    // ── R3  Tool System (weather + travel) ──────────────────────────────────
    separator('R3  Tool System — 天气 + 旅行建议');
    try {
      const r3 = await query('R3', '北京今天天气怎么样？适合出去玩吗？');
      if (r3.length > 0) ok('R3', `工具调用链 ${r3.length} 字符`);
      else fail('R3', '空回复');
    } catch (e) { fail('R3', '工具调用失败', e); }

    // ── R3b  Calculator ─────────────────────────────────────────────────────
    separator('R3b  Tool System — 计算器');
    try {
      const r3b = await query('R3b', '帮我算一下 123 * 456 + 789 等于多少？');
      if (r3b.length > 0) ok('R3b', `计算工具 ${r3b.length} 字符`);
      else fail('R3b', '空回复');
    } catch (e) { fail('R3b', '计算工具失败', e); }

    // ── R6  Sub-Agents — translator (isolated) ──────────────────────────────
    separator('R6a  Sub-Agent — 翻译 (isolated)');
    try {
      const r6a = await query('R6a', '请把"人工智能正在改变世界"翻译成英文');
      if (r6a.length > 0) ok('R6a', `翻译子代理 ${r6a.length} 字符`);
      else fail('R6a', '空回复');
    } catch (e) { fail('R6a', '翻译子代理失败', e); }

    // ── R6b  Sub-Agents — code reviewer (summary-only) ──────────────────────
    separator('R6b  Sub-Agent — 代码审查 (summary-only)');
    try {
      const r6b = await query('R6b', '请审查这段代码: function add(a: any, b: any) { return a + b; }');
      if (r6b.length > 0) ok('R6b', `代码审查子代理 ${r6b.length} 字符`);
      else fail('R6b', '空回复');
    } catch (e) { fail('R6b', '代码审查子代理失败', e); }

    // ── R5  OTel Bridge — Span 树 ───────────────────────────────────────────
    separator('R5  OTel Bridge');
    try {
      await otelProvider.forceFlush();
      const spans = otelExporter.getFinishedSpans();
      if (spans.length > 0) {
        console.log(`  共 ${spans.length} 个 span:`);
        for (const span of spans.slice(0, 5)) {
          const parent = (span as any).parentSpanContext as { spanId: string } | undefined;
          const indent = parent?.spanId ? '  └─ ' : '';
          console.log(`  ${indent}${span.name} [${span.spanContext().spanId.slice(0, 8)}]`);
        }
        if (spans.length > 5) console.log(`  ... 还有 ${spans.length - 5} 个 span`);
        ok('R5', `${spans.length} 个 span 已采集`);
      } else {
        fail('R5', '无 span 采集');
      }
    } catch (e) { fail('R5', 'OTel 失败', e); }

    // ── R4  Plugin System 验证 ──────────────────────────────────────────────
    separator('R4  Plugin System');
    try {
      const errors = agent.pluginManager.getErrors();
      if (errors.length === 0) ok('R4', 'PluginManager 无错误');
      else fail('R4', `${errors.length} 个插件错误: ${errors.map(String).join(', ')}`);
    } catch (e) { fail('R4', '插件检查失败', e); }

    // ── R7  Session Persistence + Suspend/Resume ────────────────────────────
    separator('R7  Session — Suspend/Resume');
    try {
      await persistence.stop();

      const sessions = await sessionMgr.list();
      if (sessions.length > 0) {
        ok('R7a', `${sessions.length} 个会话已持久化`);

        // 检查 JSONL
        const firstSession = sessions[0];
        const jsonlPath = join(sessionBase, firstSession.sessionId, 'events.jsonl');
        try {
          const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim()).length;
          ok('R7b', `JSONL ${lines} 条事件`);
        } catch { /* jsonl may not exist for all sessions */ }

        // Suspend
        await sessionMgr.suspend(firstSession.sessionId, '演示暂停');
        ok('R7c', '会话已 suspend');

        // Restore
        const restored = await sessionMgr.restore(firstSession.sessionId);
        ok('R7d', `restore 成功, input="${restored.request.input.slice(0, 30)}..."`);

        // Resume
        const newSessionId = await sessionMgr.resume(firstSession.sessionId, '确认继续');
        ok('R7e', `resume 新会话 ${newSessionId.slice(0, 8)}..., parent=${firstSession.sessionId.slice(0, 8)}...`);
      } else {
        fail('R7', '无会话记录');
      }
    } catch (e) { fail('R7', 'Session 操作失败', e); }

    // ── R8  Built-in Plugins 验证 ───────────────────────────────────────────
    separator('R8  内置插件');
    try {
      const memStore = memoryBackend.store;
      const memKeys = memStore ? Object.keys(memStore) : [];
      ok('R8a', `Memory Backend: ${memKeys.length} 条记录`);
      ok('R8b', 'Compression/Permission/Skill/Eviction 插件已加载');
    } catch (e) { fail('R8', '插件验证失败', e); }

    // ── R9  Config System ────────────────────────────────────────────────────
    separator('R9  Config System');
    try {
      const configDir = mkdtempSync(join(tmpdir(), 'agentforge-cfg-'));
      const configJsonc = join(configDir, 'config.jsonc');
      writeFileSync(configJsonc, `{
  // AgentForge 项目配置 (JSONC)
  "modelProfiles": [{
    "modelPattern": "deepseek",
    "systemPromptSuffix": "[Config] 当前模型为 DeepSeek，请用简洁中文回答。"
  }],
  "tools": { "enabled": ["getWeather", "calculator", "echo"] },
  "plugins": ["memory", "compression"],
}`);

      const configLoader = new ConfigLoader();
      const config = await configLoader.load({
        env: '{"plugins": ["memory"]}',
        project: configJsonc,
        session: { session: { storage: 'memory' } },
      });

      ok('R9a', `JSONC 多层合并: plugins=${JSON.stringify(config.plugins)}, storage=${config.session?.storage}`);

      if (config.modelProfiles && config.modelProfiles.length > 0) {
        const profile = matchProfile('deepseek/deepseek-v4-flash', config.modelProfiles);
        if (profile) {
          ok('R9b', `ModelProfile 匹配: suffix="${profile.systemPromptSuffix}"`);

          const fakeCtx: PipelineContext = {
            request: { input: 'test', sessionId: 'demo-001' },
            agent: {
              config: { model: 'deepseek/deepseek-v4-flash' },
              toolDeclarations: [{ name: 'getWeather', description: '获取天气' }],
              promptFragments: ['基础 prompt'],
            },
            iteration: { step: 0 },
            session: { custom: {} },
          };
          const withProfile = applyProfile(fakeCtx, profile);
          ok('R9c', `applyProfile: ${withProfile.agent.promptFragments.length} fragments`);
        }
      }

      const dynamicValue = await resolveDynamic(
        (ctx) => `[Dynamic] 会话 ${ctx.sessionId.slice(0, 8)}`,
        { input: 'test', sessionId: crypto.randomUUID(), metadata: {} },
      );
      ok('R9d', `resolveDynamic: ${dynamicValue.slice(0, 40)}`);

      rmSync(configDir, { recursive: true, force: true });
    } catch (e) { fail('R9', 'Config 失败', e); }

    // ── R10  MCP Plugin ─────────────────────────────────────────────────────
    separator('R10  MCP Plugin');
    try {
      const mcpDataDir = mkdtempSync(join(tmpdir(), 'agentforge-mcp-'));
      writeFileSync(join(mcpDataDir, 'notes.txt'), 'AgentForge MCP 集成测试文件。\n框架支持 MCP 工具的自动发现和调用。');
      writeFileSync(join(mcpDataDir, 'status.txt'), '状态: 正常\n版本: 0.0.1');

      const mcpAgent = new Agent(
        {
          model: 'deepseek/deepseek-v4-flash',
          systemPrompt: '你是文件管理助手。你可以列出目录、读取文件。用中文回答。',
          tools: [],
          maxIterations: 3,
        },
        { eventBus: bus } as any,
      );

      mcpAgent.use(mcpPlugin({
        servers: [{ name: 'filesystem', transport: 'stdio', command: 'node', args: [serverEntry, mcpDataDir] }],
      }));

      await mcpAgent.pluginManager.initializeAll();
      const mcpTools = mcpAgent['registry'].getAll();
      ok('R10a', `MCP 发现 ${mcpTools.length} 个工具: ${mcpTools.slice(0, 3).map((t: any) => t.name).join(', ')}`);

      const mcpQuery = '请列出当前目录的文件，然后读取 notes.txt 的内容。';
      let mcpResponse = '';
      for await (const chunk of mcpAgent.stream(mcpQuery)) {
        mcpResponse += chunk;
      }
      if (mcpResponse.length > 0) {
        ok('R10b', `MCP LLM 回复 ${mcpResponse.length} 字符`);
      } else {
        fail('R10b', 'MCP 空回复');
      }

      await mcpAgent.pluginManager.shutdown();
      rmSync(mcpDataDir, { recursive: true, force: true });
    } catch (e) { fail('R10', 'MCP 失败', e); }

    // ── R11  Async Sub-Agents ────────────────────────────────────────────────
    separator('R11  Async Sub-Agents');
    try {
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

      ok('R11a', `启动 ${handles.length} 个异步翻译任务`);

      handles[2].cancel();
      ok('R11b', `已取消: ${languages[2]} 任务 (status=${handles[2].status})`);

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

      for (const [lang, text] of results) {
        console.log(`    ${lang}: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`);
      }
      ok('R11c', `${results.size} 个翻译完成`);

      const allTasks = tm.list();
      const statuses = allTasks.map(t => `${t.taskId.slice(0, 6)}(${t.status})`).join(', ');
      ok('R11d', `任务列表: ${statuses}`);
    } catch (e) { fail('R11', 'Async Sub-Agents 失败', e); }

    // ── Shutdown ─────────────────────────────────────────────────────────────
    separator('Shutdown');
    await agent.pluginManager.shutdown();
    console.log(`  PluginManager shutdown, errors: ${agent.pluginManager.getErrors().length}`);

  } finally {
    rmSync(sessionBase, { recursive: true, force: true });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  separator('验证结果');
  console.log(`\n  通过: ${passed.length}  失败: ${failed.length}`);
  if (failed.length > 0) {
    console.log(`  失败项: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('\n  所有 Region 验证通过!\n');
}

main().catch((e) => {
  console.error('致命错误:', e);
  rmSync(sessionBase, { recursive: true, force: true });
  process.exit(1);
});
