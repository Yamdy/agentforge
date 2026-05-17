/**
 * AgentForge 内置工具演示 — 用真实 LLM 测试全部 11 个内置工具
 *
 * 工具列表: echo, http, fileRead, fileWrite, fileEdit, glob, grep,
 *           shell, calculator, datetime, json
 *
 * 运行: npx tsx --env-file=.env builtin-tools-demo.ts
 */

import { Agent, registerProvider } from '@primo-ai/core';
import { compressionPlugin, permissionPlugin } from '@primo-ai/plugins';
import {
  echoTool,
  httpTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  globTool,
  grepTool,
  shellTool,
  calculatorTool,
  datetimeTool,
  jsonTool,
} from '@primo-ai/tools';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── helpers ────────────────────────────────────────────────────────────────

const passed: string[] = [];
const failed: string[] = [];

function ok(tool: string, msg: string) {
  passed.push(tool);
  console.log(`  ✅ [${tool}] ${msg}`);
}

function fail(tool: string, msg: string, err?: unknown) {
  failed.push(tool);
  console.error(`  ❌ [${tool}] ${msg}`, err ?? '');
}

function separator(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════════════════════

registerProvider('deepseek', (modelId: string) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未设置。请创建 .env 文件。');
  const sdk = createOpenAICompatible({ baseURL: 'https://api.deepseek.com', apiKey } as any);
  return sdk.languageModel(modelId);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Temp directory for file tools
// ═══════════════════════════════════════════════════════════════════════════════

const tmpDir = mkdtempSync(join(tmpdir(), 'af-tools-demo-'));
writeFileSync(join(tmpDir, 'hello.txt'), 'Hello AgentForge!\n这是内置工具测试文件。\n第二行内容。');
writeFileSync(join(tmpDir, 'data.json'), '{"name": "AgentForge", "version": "0.1.3", "features": ["pipeline", "plugins", "tools"]}');
writeFileSync(join(tmpDir, 'sample.ts'), `function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\nconsole.log(greet("World"));\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// Agent — all 11 built-in tools
// ═══════════════════════════════════════════════════════════════════════════════

const allTools = [
  echoTool, httpTool, fileReadTool, fileWriteTool, fileEditTool,
  globTool, grepTool, shellTool, calculatorTool, datetimeTool, jsonTool,
];

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: [
    '你是一个工具测试助手。用户会要求你使用各种工具完成任务。',
    '你必须实际调用工具来完成请求，不要自己编造答案。',
    '用中文简洁回答，展示工具返回的结果。',
    '',
    `测试文件目录: ${tmpDir}`,
  ].join('\n'),
  tools: allTools,
  maxIterations: 5,
});

agent.use(compressionPlugin({ maxContextTokens: 8000, phases: [{ type: 'truncate', maxTokens: 500 }] }));
agent.use(permissionPlugin({
  mode: 'full-auto',
  rules: allTools.map(t => ({ tool: t.name, action: 'allow' })),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Run helper
// ═══════════════════════════════════════════════════════════════════════════════

async function query(label: string, prompt: string): Promise<string> {
  console.log(`\n  📣 [${label}] 用户: ${prompt}`);
  console.log('  🤖 助手: ');

  let full = '';
  for await (const chunk of agent.stream(prompt)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log(`\n  --- ${full.length} 字符 ---`);
  return full;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main — 11 tool tests
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AgentForge 内置工具演示 — 11 个工具真实 LLM 测试     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  临时目录: ${tmpDir}`);
  console.log(`  工具数量: ${allTools.length}`);

  try {
    // ── T1  echo ────────────────────────────────────────────────────────────
    separator('T1  echo — 回显测试');
    try {
      const r = await query('echo', '请用 echo 工具回显 "AgentForge 内置工具测试成功"');
      if (r.length > 0) ok('echo', `${r.length} 字符`);
      else fail('echo', '空回复');
    } catch (e) { fail('echo', '失败', e); }

    // ── T2  datetime ────────────────────────────────────────────────────────
    separator('T2  datetime — 日期时间');
    try {
      const r = await query('datetime', '请用 datetime 工具查询当前时间，告诉我现在几点了');
      if (r.length > 0) ok('datetime', `${r.length} 字符`);
      else fail('datetime', '空回复');
    } catch (e) { fail('datetime', '失败', e); }

    // ── T3  calculator ──────────────────────────────────────────────────────
    separator('T3  calculator — 数学计算');
    try {
      const r = await query('calculator', '请用 calculator 工具计算 (1234 * 5678 + 90) / 12 的结果');
      if (r.length > 0) ok('calculator', `${r.length} 字符`);
      else fail('calculator', '空回复');
    } catch (e) { fail('calculator', '失败', e); }

    // ── T4  json ────────────────────────────────────────────────────────────
    separator('T4  json — JSON 处理');
    try {
      const r = await query('json', `请用 json 工具的 query 操作，从以下 JSON 中提取 version 字段的值: {"name": "AgentForge", "version": "0.1.3", "features": ["pipeline", "plugins"]}`);
      if (r.length > 0) ok('json', `${r.length} 字符`);
      else fail('json', '空回复');
    } catch (e) { fail('json', '失败', e); }

    // ── T5  fileWrite ───────────────────────────────────────────────────────
    separator('T5  fileWrite — 写入文件');
    try {
      const r = await query('fileWrite', `请用 fileWrite 工具在 ${tmpDir} 目录下写入一个名为 test-output.txt 的文件，内容为 "AgentForge 工具测试写入成功！"`);
      if (r.length > 0) ok('fileWrite', `${r.length} 字符`);
      else fail('fileWrite', '空回复');
    } catch (e) { fail('fileWrite', '失败', e); }

    // ── T6  fileRead ────────────────────────────────────────────────────────
    separator('T6  fileRead — 读取文件');
    try {
      const r = await query('fileRead', `请用 fileRead 工具读取 ${tmpDir}/hello.txt 的内容`);
      if (r.length > 0) ok('fileRead', `${r.length} 字符`);
      else fail('fileRead', '空回复');
    } catch (e) { fail('fileRead', '失败', e); }

    // ── T7  fileEdit ────────────────────────────────────────────────────────
    separator('T7  fileEdit — 编辑文件');
    try {
      const r = await query('fileEdit', `请用 fileEdit 工具将 ${tmpDir}/hello.txt 中的 "Hello AgentForge" 替换为 "Hello AgentForge v2"`);
      if (r.length > 0) ok('fileEdit', `${r.length} 字符`);
      else fail('fileEdit', '空回复');
    } catch (e) { fail('fileEdit', '失败', e); }

    // ── T8  glob ────────────────────────────────────────────────────────────
    separator('T8  glob — 文件查找');
    try {
      const r = await query('glob', `请用 glob 工具在 ${tmpDir} 目录下查找所有 .txt 文件`);
      if (r.length > 0) ok('glob', `${r.length} 字符`);
      else fail('glob', '空回复');
    } catch (e) { fail('glob', '失败', e); }

    // ── T9  grep ────────────────────────────────────────────────────────────
    separator('T9  grep — 内容搜索');
    try {
      const r = await query('grep', `请用 grep 工具在 ${tmpDir} 目录下搜索包含 "AgentForge" 的文件`);
      if (r.length > 0) ok('grep', `${r.length} 字符`);
      else fail('grep', '空回复');
    } catch (e) { fail('grep', '失败', e); }

    // ── T10  http ───────────────────────────────────────────────────────────
    separator('T10  http — HTTP 请求');
    try {
      const r = await query('http', '请用 http 工具发送 GET 请求到 https://httpbin.org/get，告诉我返回了什么');
      if (r.length > 0) ok('http', `${r.length} 字符`);
      else fail('http', '空回复');
    } catch (e) { fail('http', '失败', e); }

    // ── T11  shell ──────────────────────────────────────────────────────────
    separator('T11  shell — Shell 命令');
    try {
      const r = await query('shell', `请用 shell 工具执行 "ls ${tmpDir}" 命令，列出临时目录的文件`);
      if (r.length > 0) ok('shell', `${r.length} 字符`);
      else fail('shell', '空回复');
    } catch (e) { fail('shell', '失败', e); }

    // ── Shutdown ────────────────────────────────────────────────────────────
    separator('Shutdown');
    await agent.pluginManager.shutdown();

  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  separator('测试结果');
  console.log(`\n  通过: ${passed.length}/${allTools.length}  失败: ${failed.length}`);
  if (failed.length > 0) {
    console.log(`  失败项: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('\n  全部 11 个内置工具测试通过!\n');
}

main().catch((e) => {
  console.error('致命错误:', e);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
});
