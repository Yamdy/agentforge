/**
 * 真实示例：测试 AGENTS.md 自动发现
 *
 * 运行方式：npx tsx examples/test-agents-md.ts
 */

import { loadAgentsMd } from '../src/memory/agents-md.js';
import { join } from 'path';
import { mkdirSync, writeFileSync, existsSync } from 'fs';

// 创建测试目录结构
const testDir = join(process.cwd(), 'test-agents-md');
const subDir = join(testDir, 'src', 'components');

if (!existsSync(subDir)) {
  mkdirSync(subDir, { recursive: true });
}

// 创建根目录 AGENTS.md
writeFileSync(
  join(testDir, 'AGENTS.md'),
  `# Root AGENTS.md

## Project Overview
This is a test project for AgentForge.

## Coding Standards
- Use TypeScript
- Follow ESLint rules
`
);

// 创建 src 目录 AGENTS.md
writeFileSync(
  join(testDir, 'src', 'AGENTS.md'),
  `# Source AGENTS.md

## Source Code Guidelines
- All source files should be in src/
- Use proper imports
`
);

// 创建子目录 AGENTS.md
writeFileSync(
  join(subDir, 'AGENTS.md'),
  `# Components AGENTS.md

## Component Guidelines
- Use functional components
- Follow naming conventions
`
);

console.log('✅ 测试目录创建完成:', testDir);

// 测试 1: 从子目录加载
async function testLoadFromSubdir() {
  console.log('\n📝 测试 1: 从子目录加载 AGENTS.md');

  const result = await loadAgentsMd({
    cwd: subDir,
    filename: 'AGENTS.md',
  });

  console.log('发现的文件:', result.paths);
  console.log('估算 Token 数:', result.estimatedTokens);

  // 注意：会一直向上遍历到文件系统根目录，所以可能发现更多文件
  if (result.paths.length >= 3) {
    console.log('✅ 发现了', result.paths.length, '个 AGENTS.md 文件（包括项目根目录）');
  } else {
    console.error('❌ 应该发现至少 3 个文件，实际:', result.paths.length);
  }

  // 验证内容包含测试目录的文件内容
  if (
    result.content.includes('Root AGENTS.md') &&
    result.content.includes('Source AGENTS.md') &&
    result.content.includes('Components AGENTS.md')
  ) {
    console.log('✅ 内容合并正确');
  } else {
    console.error('❌ 内容合并失败');
  }
}

// 测试 2: 从根目录加载
async function testLoadFromRoot() {
  console.log('\n📝 测试 2: 从根目录加载 AGENTS.md');

  const result = await loadAgentsMd({
    cwd: testDir,
    filename: 'AGENTS.md',
  });

  console.log('发现的文件:', result.paths);

  // 注意：会向上遍历，可能发现项目根目录的 AGENTS.md
  if (result.paths.length >= 1) {
    console.log('✅ 发现了', result.paths.length, '个 AGENTS.md 文件');
  } else {
    console.error('❌ 应该发现至少 1 个文件');
  }
}

// 测试 3: 自定义文件名
async function testCustomFilename() {
  console.log('\n📝 测试 3: 自定义文件名');

  // 创建自定义文件
  writeFileSync(join(testDir, 'RULES.md'), '# Custom Rules\nBe nice!');

  const result = await loadAgentsMd({
    cwd: testDir,
    filename: 'RULES.md',
  });

  if (result.paths.length === 1 && result.content.includes('Custom Rules')) {
    console.log('✅ 自定义文件名加载成功');
  } else {
    console.error('❌ 自定义文件名加载失败');
  }
}

// 测试 4: 最大深度限制
async function testMaxDepth() {
  console.log('\n📝 测试 4: 最大深度限制');

  const result = await loadAgentsMd({
    cwd: subDir,
    filename: 'AGENTS.md',
    maxDepth: 1, // 只向上遍历 1 层
  });

  console.log('发现的文件:', result.paths);

  // maxDepth=1 表示只检查当前目录，不向上遍历
  if (result.paths.length === 1) {
    console.log('✅ 最大深度限制生效');
  } else {
    console.log('⚠️ 最大深度限制行为与预期不同，实际:', result.paths.length);
  }
}

// 测试 5: 不存在的目录
async function testNonExistentDir() {
  console.log('\n📝 测试 5: 不存在的目录');

  const result = await loadAgentsMd({
    cwd: '/non/existent/path',
    filename: 'AGENTS.md',
  });

  if (result.paths.length === 0 && result.content === '') {
    console.log('✅ 不存在的目录处理正确');
  } else {
    console.error('❌ 不存在的目录处理失败');
  }
}

// 运行所有测试
async function runAllTests() {
  try {
    await testLoadFromSubdir();
    await testLoadFromRoot();
    await testCustomFilename();
    await testMaxDepth();
    await testNonExistentDir();

    console.log('\n🎉 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

runAllTests();
