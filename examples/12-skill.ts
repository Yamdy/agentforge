/**
 * AgentForge Skill 系统示例
 *
 * 本示例展示：
 * 1. 使用真实 Skills 目录加载技能
 * 2. 如何使用 SkillLoader 加载 SKILL.md 文件
 * 3. 如何使用 SkillParser 解析 YAML frontmatter
 * 4. SkillRegistry 的注册和查询功能
 * 5. SkillWatcher 实现热加载
 *
 * 运行方式：npx tsx examples/12-skill.ts
 *
 * 真实 Skills 目录：C:\Users\90514\.config\opencode\skills
 * 包含：effect-ts-guide, xlsx, pptx, pdf, webapp-testing 等
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  // 加载器
  loadSkill,
  loadSkillsFromDirectory,
  discoverSkills,
  SkillRegistry,
  // 解析器
  parseSkillFile,
  extractSections,
  extractTitle,
  validateSkillName,
  checkCompatibility,
  // 类型
  type SkillInfo,
  type SkillLoadResult,
  type SkillFrontmatter,
  // Hooks
  createLoggingHook,
  createValidationHook,
  createCachingHook,
  createCacheInvalidationHook,
  createReloadLoggingHook,
  // Watcher
  SkillWatcher,
  watchSkills,
  type SkillReloadEvent,
} from '../src/skill/index.js';

// ============================================================
// 真实 Skills 目录路径
// ============================================================

/**
 * 真实的 Skills 目录（项目示例）
 * 包含多个真实技能：docx, pdf, pptx, skill-creator, webapp-testing, xlsx
 */
const SKILLS_DIR = join(process.cwd(), 'examples', 'skills');

// ============================================================
// 示例 0：加载真实 Skills 目录
// ============================================================

/**
 * 加载真实 Skills 目录示例
 *
 * 从项目的 skills 目录加载真实的技能文件，展示实际使用场景。
 */
async function example0_LoadRealSkills(): Promise<void> {
  console.log('=== 示例 0：加载真实 Skills 目录 ===\n');

  if (!existsSync(SKILLS_DIR)) {
    console.log(`Skills 目录不存在: ${SKILLS_DIR}\n`);
    return;
  }

  console.log(`从项目目录加载技能: ${SKILLS_DIR}\n`);

  // 使用 loadSkillsFromDirectory 批量加载
  console.log('使用 loadSkillsFromDirectory 批量加载:');
  const skills = await loadSkillsFromDirectory(SKILLS_DIR);

  console.log(`加载成功！共发现 ${skills.length} 个技能\n`);

  // 显示所有加载的技能
  for (const skill of skills) {
    console.log(`技能: ${skill.frontmatter.name}`);
    console.log(`  描述: ${skill.frontmatter.description?.slice(0, 80) ?? '无描述'}...`);
    console.log(`  位置: ${skill.location}`);
    console.log(`  内容长度: ${skill.content.length} 字符`);
    console.log('');
  }
  console.log('\n');

  // 使用 SkillRegistry 从目录加载
  console.log('使用 SkillRegistry 从目录加载:');
  const registry = new SkillRegistry({
    hooks: [createLoggingHook()],
  });

  const registeredSkills = await registry.loadDirectory(SKILLS_DIR);
  console.log(`注册了 ${registeredSkills.length} 个技能`);

  // 列出所有已注册技能
  console.log('\n已注册的技能名称:');
  for (const name of registry.list()) {
    console.log(`  - ${name}`);
  }
  console.log('\n');

  // 按关键词搜索
  console.log('按关键词搜索:');
  const effectSkills = registry.findByKeywords(['effect']);
  console.log(`  包含 'effect' 关键词: ${effectSkills.length} 个`);

  const testSkills = registry.findByKeywords(['testing']);
  console.log(`  包含 'testing' 关键词: ${testSkills.length} 个`);
  console.log('\n');

  // 获取特定技能详情
  const effectTsSkill = registry.get('effect-ts-guide');
  if (effectTsSkill !== undefined) {
    console.log('effect-ts-guide 技能详情:');
    console.log(`  名称: ${effectTsSkill.frontmatter.name}`);
    console.log(`  描述: ${effectTsSkill.frontmatter.description?.slice(0, 100)}...`);
    console.log(`  许可证: ${effectTsSkill.frontmatter.license ?? '未指定'}`);
    console.log('');
  }

  // 检查技能是否存在
  console.log('检查技能是否存在:');
  console.log(`  effect-ts-guide 存在: ${registry.has('effect-ts-guide')}`);
  console.log(`  nonexistent-skill 存在: ${registry.has('nonexistent-skill')}`);
  console.log('\n');
}

// ============================================================
// 示例 LLM：使用真实 LLM 测试 Skill 集成
// ============================================================

/**
 * 使用真实 LLM 测试 Skill 集成
 *
 * 演示如何将 Skill 内容注入到 LLM prompt 中，
 * 实现技能驱动的 AI 响应。
 *
 * 需要设置环境变量: OPENAI_API_KEY 或 OPENAI_BASE_URL
 */
async function exampleLLM_SkillIntegration(): Promise<void> {
  console.log('=== 示例 LLM：使用真实 LLM 测试 Skill 集成 ===\n');

  // 检查 API Key
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  const baseURL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const modelName = process.env.MODEL_NAME ?? 'gpt-4o-mini';

  if (!apiKey) {
    console.log('⚠️  未设置 OPENAI_API_KEY 环境变量');
    console.log('   请设置后重试:');
    console.log('   export OPENAI_API_KEY=your-api-key');
    console.log('   或使用其他 Provider:');
    console.log('   export OPENAI_BASE_URL=https://api.deepseek.com/v1');
    console.log('   export OPENAI_API_KEY=your-deepseek-key\n');
    return;
  }

  console.log(`配置信息:`);
  console.log(`  Base URL: ${baseURL}`);
  console.log(`  Model: ${modelName}\n`);

  // 加载技能
  if (!existsSync(SKILLS_DIR)) {
    console.log(`Skills 目录不存在: ${SKILLS_DIR}\n`);
    return;
  }

  const registry = new SkillRegistry();
  await registry.loadDirectory(SKILLS_DIR);

  console.log(`已加载 ${registry.list().length} 个技能:\n`);
  for (const name of registry.list()) {
    console.log(`  - ${name}`);
  }
  console.log('\n');

  // 获取 docx 技能
  const docxSkill = registry.get('docx');
  if (docxSkill === undefined) {
    console.log('未找到 docx 技能\n');
    return;
  }

  console.log('使用 docx 技能进行 LLM 测试:');
  console.log(`  技能描述: ${docxSkill.frontmatter.description?.slice(0, 100)}...\n`);

  // 构建 prompt，包含技能内容
  const userQuestion = '如何创建一个带有标题和段落的 Word 文档？';
  const skillContext = docxSkill.content.slice(0, 2000); // 截取前 2000 字符

  const systemPrompt = `你是一个专业的文档助手。请参考以下技能知识来回答问题。

## 技能知识 (docx)

${skillContext}

---

请基于以上技能知识回答用户的问题。`;

  console.log('用户问题:');
  console.log(`  "${userQuestion}"\n`);

  console.log('调用 LLM (这可能需要几秒钟)...\n');

  try {
    // 动态导入 AI SDK
    const { generateText } = await import('ai');
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');

    const provider = createOpenAICompatible({
      name: 'openai-compatible',
      baseURL,
      apiKey,
    });

    const model = provider(modelName);

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userQuestion,
      maxTokens: 1000,
    });

    console.log('LLM 响应:');
    console.log('─'.repeat(50));
    console.log(result.text);
    console.log('─'.repeat(50));
    console.log(`\nToken 使用: prompt=${result.usage.promptTokens}, completion=${result.usage.completionTokens}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`LLM 调用失败: ${message}\n`);
  }

  console.log('Skill + LLM 集成测试完成\n');
}

// ============================================================
// Mock SKILL.md 内容
// ============================================================

/**
 * 模拟的 SKILL.md 文件内容
 *
 * SKILL.md 格式：
 * - YAML frontmatter（用 --- 包裹）
 * - Markdown 正文（技能指令）
 */
const MOCK_SKILL_CONTENT = `---
name: code-review
description: 代码审查技能，提供专业的代码质量和安全审查能力
version: "1.0.0"
author: AgentForge Team
license: MIT
keywords:
  - review
  - code-quality
  - security
  - best-practices
triggers:
  - review this code
  - check code quality
  - security audit
allowedTools:
  - read
  - grep
  - lsp_diagnostics
compatibility: agentforge >=0.1.0
---

# Code Review Skill

## 概述

这是一个专业的代码审查技能，帮助开发者发现代码中的问题。

## 使用场景

- 代码合并前的质量检查
- 安全漏洞扫描
- 最佳实践验证

## 检查规则

### 1. 代码质量
- 检查命名规范
- 检查函数长度
- 检查圈复杂度

### 2. 安全检查
- SQL 注入风险
- XSS 漏洞
- 敏感信息泄露

### 3. 性能优化
- 循环优化建议
- 内存使用分析

## 输出格式

审查结果应包含：
- 问题等级（error/warning/info）
- 问题描述
- 修复建议
`;

const MOCK_SKILL_SIMPLE = `---
name: simple-helper
description: 简单的辅助技能
---

# Simple Helper

这是一个简单的辅助技能示例。
`;

const MOCK_SKILL_INVALID = `---
name: ""
description: 无效的技能
---
# Invalid
`;

// ============================================================
// 示例 1：加载 SKILL.md 文件
// ============================================================

async function example1_LoadSkill(): Promise<void> {
  console.log('=== 示例 1：加载 SKILL.md 文件 ===\n');

  // 创建临时目录和文件
  const tempDir = join(process.cwd(), '.temp-skills');
  const skillPath = join(tempDir, 'code-review', 'SKILL.md');

  try {
    // 确保目录存在
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    mkdirSync(join(tempDir, 'code-review'), { recursive: true });

    // 写入技能文件
    writeFileSync(skillPath, MOCK_SKILL_CONTENT, 'utf-8');

    console.log(`创建测试文件: ${skillPath}\n`);

    // 使用 loadSkill 加载单个技能
    console.log('使用 loadSkill 加载:');
    const result = await loadSkill(skillPath);

    if (result.success) {
      console.log('加载成功!');
      console.log(`  名称: ${result.skill.frontmatter.name}`);
      console.log(`  描述: ${result.skill.frontmatter.description}`);
      console.log(`  版本: ${result.skill.frontmatter.version ?? 'N/A'}`);
      console.log(`  作者: ${result.skill.frontmatter.author ?? 'N/A'}`);
      console.log(`  关键词: ${result.skill.frontmatter.keywords?.join(', ') ?? '无'}`);
      console.log(`  触发词: ${result.skill.frontmatter.triggers?.join(', ') ?? '无'}`);
      console.log(`  允许工具: ${result.skill.frontmatter.allowedTools?.join(', ') ?? '无限制'}`);
      console.log(`  位置: ${result.skill.location}`);
      console.log(`  内容长度: ${result.skill.content.length} 字符`);
    }
    if (result.success === false) {
      console.log(`加载失败: ${result.error}`);
    }
    console.log('\n');

    // 测试加载不存在的文件
    console.log('测试加载不存在的文件:');
    const notFoundResult = await loadSkill('/nonexistent/SKILL.md');
    if (notFoundResult.success === false) {
      console.log(`  预期失败: ${notFoundResult.error}`);
    }
    console.log('\n');

    // 测试加载无效的技能文件
    const invalidPath = join(tempDir, 'invalid', 'SKILL.md');
    mkdirSync(join(tempDir, 'invalid'), { recursive: true });
    writeFileSync(invalidPath, MOCK_SKILL_INVALID, 'utf-8');

    console.log('测试加载无效的技能文件:');
    const invalidResult = await loadSkill(invalidPath);
    if (invalidResult.success === false) {
      console.log(`  预期失败: ${invalidResult.error}`);
    }
    console.log('\n');
  } finally {
    // 清理临时文件
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// ============================================================
// 示例 2：解析 YAML Frontmatter
// ============================================================

async function example2_ParseSkillFile(): Promise<void> {
  console.log('=== 示例 2：解析 YAML Frontmatter ===\n');

  // 直接解析字符串内容
  console.log('使用 parseSkillFile 解析:');
  const parseResult = parseSkillFile(MOCK_SKILL_CONTENT);

  if (parseResult.success) {
    console.log('解析成功!');
    console.log(`  名称: ${parseResult.data.frontmatter.name}`);
    console.log(`  原始 frontmatter 长度: ${parseResult.data.rawFrontmatter.length}`);
    console.log(`  Markdown 内容长度: ${parseResult.data.content.length}`);
  }
  if (parseResult.success === false) {
    console.log(`解析失败: ${parseResult.error.message}`);
  }
  console.log('\n');

  // 提取标题
  console.log('提取 Markdown 标题:');
  const title = extractTitle(MOCK_SKILL_CONTENT);
  console.log(`  标题: ${title ?? '未找到'}\n`);

  // 提取章节
  console.log('提取 Markdown 章节:');
  const sections = extractSections(MOCK_SKILL_CONTENT);
  for (const [sectionTitle, content] of Array.from(sections.entries())) {
    console.log(`  ## ${sectionTitle}`);
    console.log(`     内容长度: ${content.length} 字符`);
  }
  console.log('\n');

  // 验证技能名称
  console.log('验证技能名称:');
  console.log(`  'code-review': ${validateSkillName('code-review')}`);
  console.log(`  'CodeReview': ${validateSkillName('CodeReview')} (需小写)`);
  console.log(`  'code_review': ${validateSkillName('code_review')}`);
  console.log(`  '123code': ${validateSkillName('123code')} (需字母开头)`);
  console.log('\n');

  // 检查兼容性
  console.log('检查版本兼容性:');
  console.log(`  'agentforge >=0.1.0' vs '0.2.0': ${checkCompatibility('agentforge >=0.1.0', '0.2.0')}`);
  console.log(`  'agentforge >=1.0.0' vs '0.1.0': ${checkCompatibility('agentforge >=1.0.0', '0.1.0')}`);
  console.log('\n');

  // 解析无效内容
  console.log('测试解析无效内容:');
  const invalidParseResult = parseSkillFile(MOCK_SKILL_INVALID);
  if (invalidParseResult.success === false) {
    console.log(`  预期失败: ${invalidParseResult.error.message}`);
    if (invalidParseResult.error.line !== undefined) {
      console.log(`  错误行号: ${invalidParseResult.error.line}`);
    }
  }
  console.log('\n');

  // 测试缺失 frontmatter
  console.log('测试缺失 frontmarker:');
  const noFrontmatterResult = parseSkillFile('# No Frontmatter\n\nContent');
  if (noFrontmatterResult.success === false) {
    console.log(`  预期失败: ${noFrontmatterResult.error.message}`);
  }
  console.log('\n');
}

// ============================================================
// 示例 3：SkillRegistry 集成
// ============================================================

async function example3_SkillRegistry(): Promise<void> {
  console.log('=== 示例 3：SkillRegistry 集成 ===\n');

  // 创建临时目录结构
  const tempDir = join(process.cwd(), '.temp-registry');

  try {
    // 创建多个技能目录
    const skills = [
      { name: 'code-review', content: MOCK_SKILL_CONTENT },
      { name: 'simple-helper', content: MOCK_SKILL_SIMPLE },
    ];

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    for (const skill of skills) {
      const skillDir = join(tempDir, skill.name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), skill.content, 'utf-8');
    }

    // 创建 SkillRegistry
    console.log('创建 SkillRegistry:');
    const registry = new SkillRegistry({
      hooks: [createLoggingHook()],
      debug: true,
    });
    console.log('  注册中心已创建\n');

    // 从目录加载技能
    console.log('从目录加载技能:');
    const loadedSkills = await registry.loadDirectory(tempDir);
    console.log(`  已加载 ${loadedSkills.length} 个技能\n`);

    // 列出所有技能
    console.log('列出所有已注册技能:');
    const skillNames = registry.list();
    for (const name of skillNames) {
      const skill = registry.get(name);
      if (skill) {
        console.log(`  - ${name}: ${skill.frontmatter.description}`);
      }
    }
    console.log('\n');

    // 检查技能是否存在
    console.log('检查技能是否存在:');
    console.log(`  code-review: ${registry.has('code-review')}`);
    console.log(`  nonexistent: ${registry.has('nonexistent')}`);
    console.log('\n');

    // 按关键词查找
    console.log('按关键词查找技能:');
    const reviewSkills = registry.findByKeywords(['review']);
    console.log(`  关键词 'review' 匹配: ${reviewSkills.map((s) => s.frontmatter.name).join(', ')}`);
    const securitySkills = registry.findByKeywords(['security']);
    console.log(`  关键词 'security' 匹配: ${securitySkills.map((s) => s.frontmatter.name).join(', ')}`);
    console.log('\n');

    // 按触发词查找
    console.log('按触发词查找技能:');
    const triggerSkills = registry.findByTriggers(['review this code']);
    console.log(`  触发词 'review this code' 匹配: ${triggerSkills.map((s) => s.frontmatter.name).join(', ')}`);
    console.log('\n');

    // 手动注册技能
    console.log('手动注册技能:');
    const customSkill: SkillInfo = {
      frontmatter: {
        name: 'custom-skill',
        description: '自定义手动注册的技能',
        keywords: ['custom', 'manual'],
      },
      content: '# Custom Skill\n\n手动注册的技能内容',
      location: 'memory://custom-skill',
      updatedAt: new Date(),
    };
    registry.register(customSkill);
    console.log(`  已注册: ${customSkill.frontmatter.name}`);
    console.log(`  当前技能总数: ${registry.list().length}\n`);

    // 删除技能
    console.log('删除技能:');
    const removed = registry.remove('simple-helper');
    console.log(`  删除 simple-helper: ${removed}`);
    console.log(`  当前技能总数: ${registry.list().length}\n`);

    // 清空注册中心
    console.log('清空注册中心:');
    registry.clear();
    console.log(`  清空后技能总数: ${registry.list().length}\n`);

    // 使用 Hooks 示例
    console.log('使用 Hooks 加载:');
    const hookedRegistry = new SkillRegistry({
      hooks: [
        createLoggingHook(),
        createValidationHook({
          minDescriptionLength: 10,
          maxTools: 5,
        }),
        createCachingHook(),
      ],
    });

    const hookedSkill = await hookedRegistry.load(join(tempDir, 'code-review', 'SKILL.md'));
    if (hookedSkill.success) {
      console.log(`  Hook 处理后加载成功: ${hookedSkill.skill.frontmatter.name}\n`);
    }
  } finally {
    // 清理
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// ============================================================
// 示例 4：技能发现
// ============================================================

async function example4_DiscoverSkills(): Promise<void> {
  console.log('=== 示例 4：技能发现 ===\n');

  // 创建嵌套目录结构
  const tempDir = join(process.cwd(), '.temp-discover');

  try {
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // 创建多层目录结构
    const paths = [
      join(tempDir, 'skills', 'review'),
      join(tempDir, 'skills', 'helper'),
      join(tempDir, 'custom', 'deep', 'nested'),
    ];

    for (const p of paths) {
      mkdirSync(p, { recursive: true });
    }

    // 在不同层级放置 SKILL.md
    writeFileSync(join(paths[0], 'SKILL.md'), MOCK_SKILL_CONTENT, 'utf-8');
    writeFileSync(join(paths[1], 'SKILL.md'), MOCK_SKILL_SIMPLE, 'utf-8');

    // 在根目录放置一个（需要创建目录）
    mkdirSync(join(tempDir, 'root-skill'), { recursive: true });
    writeFileSync(join(tempDir, 'root-skill', 'SKILL.md'), MOCK_SKILL_SIMPLE.replace('simple-helper', 'root-skill'), 'utf-8');

    // 发现技能
    console.log('发现技能（递归搜索）:');
    const discovered = await discoverSkills([tempDir], {
      recursive: true,
      maxDepth: 5,
    });
    console.log(`  发现 ${discovered.length} 个技能:`);
    for (const skill of discovered) {
      console.log(`    - ${skill.frontmatter.name} (${skill.location})`);
    }
    console.log('\n');

    // 使用过滤器
    console.log('使用名称过滤器:');
    const filtered = await discoverSkills([tempDir], {
      nameFilter: /^code-/,
    });
    console.log(`  匹配 /^code-/: ${filtered.map((s) => s.frontmatter.name).join(', ')}`);
    console.log('\n');

    // 使用关键词过滤器
    console.log('使用关键词过滤器:');
    const keywordFiltered = await discoverSkills([tempDir], {
      keywordFilter: ['review'],
    });
    console.log(`  包含 'review': ${keywordFiltered.map((s) => s.frontmatter.name).join(', ')}`);
    console.log('\n');

    // 限制深度
    console.log('限制搜索深度:');
    const shallow = await discoverSkills([tempDir], {
      recursive: true,
      maxDepth: 2,
    });
    console.log(`  深度 2 发现: ${shallow.length} 个技能\n`);
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// ============================================================
// 示例 5：热加载监听
// ============================================================

async function example5_HotReload(): Promise<void> {
  console.log('=== 示例 5：热加载监听 ===\n');

  const tempDir = join(process.cwd(), '.temp-watch');

  try {
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // 创建初始技能
    const skillDir = join(tempDir, 'hot-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), MOCK_SKILL_SIMPLE, 'utf-8');

    // 创建注册中心
    const registry = new SkillRegistry();

    // 创建 Watcher
    console.log('创建 SkillWatcher:');
    const watcher = new SkillWatcher({
      directories: [tempDir],
      debounceMs: 100,
      debug: true,
      hooks: [
        createReloadLoggingHook(),
        createCacheInvalidationHook(registry),
      ],
    });

    console.log(`  监听目录: ${tempDir}`);
    console.log(`  防抖时间: 100ms\n`);

    // 订阅事件
    const events: SkillReloadEvent[] = [];
    const subscription = watcher.events$.subscribe((event) => {
      events.push(event);
    });

    // 启动监听
    await watcher.start();
    console.log('Watcher 已启动\n');

    // 等待初始扫描完成
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 显示初始技能
    console.log('初始加载的技能:');
    for (const [path, skill] of Array.from(watcher.getKnownSkills().entries())) {
      console.log(`  - ${skill.frontmatter.name} (${path})`);
    }
    console.log('\n');

    // 修改文件
    console.log('修改技能文件...');
    const updatedContent = MOCK_SKILL_CONTENT.replace('code-review', 'hot-skill');
    writeFileSync(join(skillDir, 'SKILL.md'), updatedContent, 'utf-8');

    // 等待事件
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log('\n变更后的技能:');
    const knownSkills = watcher.getKnownSkills();
    const changedSkill = knownSkills.get(join(skillDir, 'SKILL.md'));
    if (changedSkill) {
      console.log(`  - ${changedSkill.frontmatter.name}`);
      console.log(`    描述: ${changedSkill.frontmatter.description}`);
    }
    console.log('\n');

    // 新增文件
    console.log('新增技能文件...');
    const newSkillDir = join(tempDir, 'new-skill');
    mkdirSync(newSkillDir, { recursive: true });
    writeFileSync(
      join(newSkillDir, 'SKILL.md'),
      MOCK_SKILL_SIMPLE.replace('simple-helper', 'new-skill'),
      'utf-8'
    );

    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log('\n新增后的已知技能:');
    for (const [path, skill] of Array.from(watcher.getKnownSkills().entries())) {
      console.log(`  - ${skill.frontmatter.name} (${path})`);
    }
    console.log('\n');

    // 显示捕获的事件
    console.log('捕获的重新加载事件:');
    for (const event of events) {
      console.log(`  - ${event.type}: ${event.skillName ?? event.filePath}`);
      if (event.error) {
        console.log(`    错误: ${event.error}`);
      }
    }
    console.log('\n');

    // 停止监听
    console.log('停止 Watcher...');
    watcher.stop();
    subscription.unsubscribe();
    console.log('Watcher 已停止\n');

    // 显示注册中心状态
    console.log('注册中心状态（通过 Hook 同步）:');
    for (const name of registry.list()) {
      const skill = registry.get(name);
      if (skill) {
        console.log(`  - ${name}: ${skill.frontmatter.description}`);
      }
    }
    console.log('\n');

    // 使用便捷函数
    console.log('使用 watchSkills 便捷函数:');
    const watch$ = watchSkills([tempDir], {
      debounceMs: 100,
      debug: false,
    });

    // 注意：这里只是演示 API，实际使用时需要保持订阅
    console.log('  Observable 已创建，调用 watcher.stop() 可停止\n');
    watch$.watcher.stop();
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// ============================================================
// 主入口
// ============================================================

async function main(): Promise<void> {
  const example = process.argv[2] ?? 'all';

  switch (example) {
    case 'real':
      await example0_LoadRealSkills();
      break;
    case 'llm':
      await exampleLLM_SkillIntegration();
      break;
    case '1':
      await example1_LoadSkill();
      break;
    case '2':
      await example2_ParseSkillFile();
      break;
    case '3':
      await example3_SkillRegistry();
      break;
    case '4':
      await example4_DiscoverSkills();
      break;
    case '5':
      await example5_HotReload();
      break;
    case 'all':
    default:
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║        AgentForge Skill 系统示例                        ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');

      console.log('用法: npx tsx examples/12-skill.ts <示例编号>\n');
      console.log('可用示例:');
      console.log('  real - 加载真实 Skills 目录');
      console.log('  llm  - 使用真实 LLM 测试 Skill 集成');
      console.log('  1    - 加载单个 SKILL.md 文件');
      console.log('  2    - 解析 YAML Frontmatter');
      console.log('  3    - SkillRegistry 集成');
      console.log('  4    - 技能发现');
      console.log('  5    - 热加载监听');
      console.log('  all  - 运行所有示例（默认）\n');

      // 运行真实示例
      await example0_LoadRealSkills();
      break;
  }

  console.log('=== 示例完成 ===');
}

// 运行示例
main().catch(console.error);
