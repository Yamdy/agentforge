/**
 * MCP Plugin Demo — MCP 插件真实服务器演示 (Issue 15)
 *
 * 启动 @modelcontextprotocol/server-filesystem MCP 服务器,
 * 通过 MCP 协议发现工具, 然后让 DeepSeek LLM 调用这些工具完成文件操作。
 *
 * 运行: npx tsx examples/mcp-demo.ts
 */

import {
  Agent,
  registerProvider,
  EventBus,
} from '@agentforge/core';
import { mcpPlugin } from '@agentforge/plugins';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ===========================================================================
// Windows 兼容: spawn('npx') 在 Windows 上需要 .cmd 后缀
// 直接用 node 运行 server-filesystem 入口脚本, 跨平台一致
// ===========================================================================

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
// 1. 准备临时目录和测试文件
// ===========================================================================

const mcpDataDir = mkdtempSync(join(tmpdir(), 'agentforge-mcp-'));
console.log(`[MCP] 临时目录: ${mcpDataDir}`);

writeFileSync(join(mcpDataDir, 'notes.txt'), [
  '项目备忘录',
  '==========',
  '1. AgentForge 是一个 TypeScript Agent 框架',
  '2. 支持 MCP 协议连接外部工具服务器',
  '3. 当前版本 v0.5.0-dev',
  '4. 下一步: 完成 Issue 15 MCP Plugin',
].join('\n'), 'utf-8');

writeFileSync(join(mcpDataDir, 'status.txt'), [
  '系统状态报告',
  '============',
  '状态: 正常运行',
  '版本: v0.5.0-dev',
  '构建: 2026-05-11',
  'MCP: 已启用',
].join('\n'), 'utf-8');

writeFileSync(join(mcpDataDir, 'readme.txt'), [
  '这是 AgentForge MCP Plugin 演示目录。',
  '包含 notes.txt、status.txt 和 readme.txt 三个文件。',
].join('\n'), 'utf-8');

console.log('[MCP] 测试文件已创建: notes.txt, status.txt, readme.txt');

// ===========================================================================
// 2. 创建 Agent + 配置 MCP Plugin                                 [Issue 15]
// ===========================================================================

const bus = new EventBus();

const agent = new Agent(
  {
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你是一个文件管理助手。你可以列出目录、读取文件。用中文回答。',
    tools: [],
    maxIterations: 3,
  },
  { eventBus: bus },
);

// 配置 MCP Plugin — 启动 filesystem MCP 服务器
// 使用 node 直接运行 server-filesystem 入口脚本 (避免 Windows npx spawn 问题)
agent.use(mcpPlugin({
  servers: [{
    name: 'filesystem',
    transport: 'stdio',
    command: 'node',
    args: [serverEntry, mcpDataDir],
  }],
}));

// EventBus 事件日志
bus.subscribe('task:start', (data: any) => console.log(`  [Event] task:start → ${data.name}`));
bus.subscribe('task:end', (data: any) => {
  const info = data.error
    ? `error: ${String(data.error).slice(0, 60)}`
    : `ok`;
  console.log(`  [Event] task:end → ${data.name} ${info}`);
});

// ===========================================================================
// 3. 初始化 — 启动 MCP 服务器 + 发现工具
// ===========================================================================

async function main() {
  console.log('\n=== AgentForge MCP Plugin Demo — MCP 真实服务器演示 ===\n');

  console.log('[MCP] 初始化插件, 启动 MCP 服务器...');
  await agent.pluginManager.initializeAll();
  console.log('[MCP] 插件初始化完成\n');

  // 通过 agent 内部 registry 查看已注册的 MCP 工具
  const mcpTools = agent['registry'].getAll();
  console.log(`[MCP] 发现 ${mcpTools.length} 个工具:`);
  for (const t of mcpTools) {
    console.log(`  - ${t.name}: ${t.description ?? '(无描述)'}`);
  }
  console.log();

  // ===========================================================================
  // 4. 真实 LLM 调用 — Agent 通过 MCP 工具操作文件
  // ===========================================================================

  const query = '请列出当前目录的文件，然后读取 notes.txt 的内容。';
  console.log(`${'='.repeat(60)}`);
  console.log(`[用户] ${query}`);
  console.log('\n[助手] ');

  let full = '';
  for await (const chunk of agent.stream(query)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log(`\n--- ${full.length} 字符 ---`);

  // ===========================================================================
  // 5. 第二轮 — 读取另一个文件
  // ===========================================================================

  const query2 = '请读取 status.txt 的内容。';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[用户] ${query2}`);
  console.log('\n[助手] ');

  let full2 = '';
  for await (const stream of agent.stream(query2)) {
    process.stdout.write(stream);
    full2 += stream;
  }
  console.log(`\n--- ${full2.length} 字符 ---`);

  // ===========================================================================
  // 6. 关闭 — 停止 MCP 服务器 + 清理临时文件
  // ===========================================================================

  console.log(`\n${'='.repeat(60)}`);
  console.log('\n--- 关闭 ---');
  await agent.pluginManager.shutdown();
  console.log('[MCP] MCP 服务器已关闭');
  console.log(`[MCP] PluginManager shutdown 完成, errors: ${agent.pluginManager.getErrors().length}`);

  rmSync(mcpDataDir, { recursive: true, force: true });
  console.log(`[MCP] 临时目录已清理: ${mcpDataDir}`);

  console.log('\n=== MCP Demo 完成 ===');
}

main().catch((err) => {
  console.error('[MCP] 演示失败:', err);
  // 尝试清理临时目录
  try { rmSync(mcpDataDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
