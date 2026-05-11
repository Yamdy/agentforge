/**
 * Config Demo — Issue 16 集成演示
 *
 * 演示 Config System 的核心能力:
 *  - ConfigLoader: JSONC 解析 + 多层合并 (env < global < project < session)
 *  - ModelProfile: 按模型模式匹配，注入 systemPromptSuffix
 *  - applyProfile: 将 profile 应用到 PipelineContext
 *  - resolveDynamic: 动态配置值解析
 *  - 真实 LLM 调用验证 Config 驱动的 prompt
 *
 * 运行: npx tsx examples/config-demo.ts
 */

import {
  Agent,
  registerProvider,
  EventBus,
  ConfigLoader,
  matchProfile,
  applyProfile,
  resolveDynamic,
} from '@agentforge/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { PipelineContext, PromptFragment } from '@agentforge/sdk';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ===========================================================================
// 0. Model Resolution — 注册 DeepSeek provider
// ===========================================================================

registerProvider('deepseek', (modelId: string) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  } as any);
  return sdk.languageModel(modelId);
});

// ===========================================================================
// 1. JSONC 多层合并
// ===========================================================================

async function main() {
  console.log('=== Config Demo — Issue 16 集成演示 ===\n');

  const bus = new EventBus();
  const configDir = mkdtempSync(join(tmpdir(), 'agentforge-cfg-'));
  const configJsonc = join(configDir, 'config.jsonc');

  // 写入带注释的 JSONC 配置文件
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
    "enabled": ["getWeather", "calculator", "echo"]
  },
  "plugins": ["memory", "compression"],
}`);

  const configLoader = new ConfigLoader();

  // 三层合并: env (最低) < project (文件) < session (最高)
  const config = await configLoader.load({
    env: '{"plugins": ["memory"]}',
    project: configJsonc,
    session: { session: { storage: 'memory' } },
  });

  console.log('--- 1. JSONC 多层合并 ---');
  console.log(`  plugins (env+project合并): ${JSON.stringify(config.plugins)}`);
  console.log(`  session.storage (session覆盖): ${config.session?.storage}`);
  console.log(`  tools.enabled: ${JSON.stringify(config.tools?.enabled)}`);
  console.log(`  modelProfiles: ${(config.modelProfiles ?? []).length} 个`);

  // ===========================================================================
  // 2. ModelProfile 匹配 + applyProfile
  // ===========================================================================

  console.log('\n--- 2. ModelProfile 匹配 ---');

  if (config.modelProfiles && config.modelProfiles.length > 0) {
    const profile = matchProfile('deepseek/deepseek-v4-flash', config.modelProfiles);
    if (profile) {
      console.log(`  匹配成功: pattern="${profile.modelPattern}"`);
      console.log(`  systemPromptSuffix: "${profile.systemPromptSuffix}"`);

      // 构造最小 PipelineContext 演示 applyProfile
      const fakeCtx: PipelineContext = {
        request: { input: 'test', sessionId: 'demo-001' },
        agent: {
          config: { model: 'deepseek/deepseek-v4-flash' },
          toolDeclarations: [
            { name: 'getWeather', description: '获取天气' },
            { name: 'secretTool', description: '秘密工具' },
          ],
          promptFragments: ['基础 prompt'],
        },
        iteration: { step: 0 },
        session: { custom: {} },
      };

      const withProfile = applyProfile(fakeCtx, {
        ...profile,
        toolOverrides: { secretTool: { exclude: true } },
      });
      console.log(`  applyProfile 后 promptFragments: ${JSON.stringify(withProfile.agent.promptFragments)}`);
      console.log(`  applyProfile 后 toolDeclarations: ${withProfile.agent.toolDeclarations.map((t: any) => t.name).join(', ')} (secretTool 已排除)`);
    } else {
      console.log('  未匹配到 ModelProfile');
    }
  }

  // ===========================================================================
  // 3. resolveDynamic 动态配置
  // ===========================================================================

  console.log('\n--- 3. resolveDynamic 动态配置 ---');

  const sessionId = crypto.randomUUID();
  const dynamicPrompt = await resolveDynamic(
    (ctx) => `[Dynamic] 会话 ${ctx.sessionId.slice(0, 8)} 于 ${new Date().toISOString()} 创建`,
    { input: 'test', sessionId, metadata: {} },
  );
  console.log(`  动态值: ${dynamicPrompt}`);

  // 静态值直接返回
  const staticVal = await resolveDynamic('静态值', { input: '', sessionId: 'x', metadata: {} });
  console.log(`  静态值: ${staticVal}`);

  // ===========================================================================
  // 4. 真实 LLM 调用 — Config 驱动的 systemPrompt
  // ===========================================================================

  console.log('\n--- 4. 真实 LLM 调用 (Config 驱动 prompt) ---');

  const suffix = config.modelProfiles?.[0]?.systemPromptSuffix ?? '';
  const agent = new Agent(
    {
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: `你是一个助手。${suffix}`,
      tools: [],
      maxIterations: 1,
    },
    { eventBus: bus },
  );

  console.log('  用户: 什么是 AgentForge？');
  console.log('  助手: ');
  let response = '';
  for await (const chunk of agent.stream('用一句话介绍什么是 AgentForge')) {
    process.stdout.write(chunk);
    response += chunk;
  }
  console.log(`\n  (${response.length} 字符)`);

  // ===========================================================================
  // 清理
  // ===========================================================================

  rmSync(configDir, { recursive: true, force: true });
  console.log('\n=== Config Demo 完成 ===');
}

main().catch(console.error);
