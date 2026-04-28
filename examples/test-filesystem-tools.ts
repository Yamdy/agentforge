/**
 * 真实示例：测试文件系统工具
 *
 * 运行方式：npx tsx examples/test-filesystem-tools.ts
 */

import { createAgent } from '../src/api/create-agent.js';
import { createFilesystemTools } from '../src/tools/filesystem.js';
import { MockLLMAdapter } from '../tests/loop/agent-loop.spec.js';
import { SimpleToolRegistry } from '../src/core/context-builder.js';
import { InMemoryStore, DefaultPauseController } from '../src/core/context.js';
import { createDefaultAppServices } from '../src/core/context-builder.js';
import { join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';

// 创建测试目录
const testDir = join(process.cwd(), 'test-workspace');
if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true });
}

// 创建测试文件
writeFileSync(join(testDir, 'hello.txt'), 'Hello, AgentForge!');
writeFileSync(
  join(testDir, 'config.json'),
  JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
);

console.log('✅ 测试目录创建完成:', testDir);

// 创建文件系统工具
const fsTools = createFilesystemTools({
  rootDir: testDir,
  writable: true,
});

console.log('✅ 文件系统工具创建完成，共', fsTools.length, '个工具');

// 测试 1: 读取文件
async function testReadFile() {
  console.log('\n📝 测试 1: 读取文件');

  const readFileTool = fsTools.find(t => t.name === 'read_file');
  if (!readFileTool) {
    console.error('❌ read_file 工具未找到');
    return;
  }

  const result = await readFileTool.execute({ path: 'hello.txt' });
  console.log('读取结果:', result);

  if (result.includes('Hello, AgentForge!')) {
    console.log('✅ 读取文件成功');
  } else {
    console.error('❌ 读取文件失败');
  }
}

// 测试 2: 写入文件
async function testWriteFile() {
  console.log('\n📝 测试 2: 写入文件');

  const writeFileTool = fsTools.find(t => t.name === 'write_file');
  if (!writeFileTool) {
    console.error('❌ write_file 工具未找到');
    return;
  }

  const result = await writeFileTool.execute({
    path: 'output.txt',
    content: '这是写入的内容\n第二行',
  });
  console.log('写入结果:', result);

  // 验证文件是否写入成功
  const content = readFileSync(join(testDir, 'output.txt'), 'utf-8');
  if (content === '这是写入的内容\n第二行') {
    console.log('✅ 写入文件成功');
  } else {
    console.error('❌ 写入文件失败');
  }
}

// 测试 3: 列出目录
async function testLs() {
  console.log('\n📝 测试 3: 列出目录');

  const lsTool = fsTools.find(t => t.name === 'ls');
  if (!lsTool) {
    console.error('❌ ls 工具未找到');
    return;
  }

  const result = await lsTool.execute({ path: '.' });
  console.log('目录内容:', result);

  if (result.includes('hello.txt') && result.includes('config.json')) {
    console.log('✅ 列出目录成功');
  } else {
    console.error('❌ 列出目录失败');
  }
}

// 测试 4: 编辑文件
async function testEditFile() {
  console.log('\n📝 测试 4: 编辑文件');

  const editFileTool = fsTools.find(t => t.name === 'edit_file');
  if (!editFileTool) {
    console.error('❌ edit_file 工具未找到');
    return;
  }

  const result = await editFileTool.execute({
    path: 'hello.txt',
    search: 'Hello',
    replace: 'Hi',
  });
  console.log('编辑结果:', result);

  // 验证编辑是否成功
  const content = readFileSync(join(testDir, 'hello.txt'), 'utf-8');
  if (content === 'Hi, AgentForge!') {
    console.log('✅ 编辑文件成功');
  } else {
    console.error('❌ 编辑文件失败，内容:', content);
  }
}

// 测试 5: 路径穿越检查
async function testPathTraversal() {
  console.log('\n📝 测试 5: 路径穿越检查');

  const readFileTool = fsTools.find(t => t.name === 'read_file');
  if (!readFileTool) {
    console.error('❌ read_file 工具未找到');
    return;
  }

  const result = await readFileTool.execute({ path: '../../../etc/passwd' });
  console.log('路径穿越结果:', result);

  if (result.includes('Error') || result.includes('outside')) {
    console.log('✅ 路径穿越检查成功');
  } else {
    console.error('❌ 路径穿越检查失败');
  }
}

// 测试 6: Glob 模式匹配
async function testGlob() {
  console.log('\n📝 测试 6: Glob 模式匹配');

  const globTool = fsTools.find(t => t.name === 'glob');
  if (!globTool) {
    console.error('❌ glob 工具未找到');
    return;
  }

  const result = await globTool.execute({ pattern: '*.txt' });
  console.log('Glob 结果:', result);

  if (result.includes('hello.txt') && result.includes('output.txt')) {
    console.log('✅ Glob 模式匹配成功');
  } else {
    console.error('❌ Glob 模式匹配失败');
  }
}

// 测试 7: Grep 内容搜索
async function testGrep() {
  console.log('\n📝 测试 7: Grep 内容搜索');

  const grepTool = fsTools.find(t => t.name === 'grep');
  if (!grepTool) {
    console.error('❌ grep 工具未找到');
    return;
  }

  const result = await grepTool.execute({ pattern: 'AgentForge' });
  console.log('Grep 结果:', result);

  if (result.includes('hello.txt')) {
    console.log('✅ Grep 内容搜索成功');
  } else {
    console.error('❌ Grep 内容搜索失败');
  }
}

// 运行所有测试
async function runAllTests() {
  try {
    await testReadFile();
    await testWriteFile();
    await testLs();
    await testEditFile();
    await testPathTraversal();
    await testGlob();
    await testGrep();

    console.log('\n🎉 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

runAllTests();
