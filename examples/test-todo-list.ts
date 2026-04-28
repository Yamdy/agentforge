/**
 * 真实示例：测试 TodoList 工具
 *
 * 运行方式：npx tsx examples/test-todo-list.ts
 */

import {
  createTodoListTool,
  createTodoListPlugin,
  formatTodoState,
} from '../src/tools/todo-list.js';
import type { TodoListState } from '../src/tools/todo-list.js';

console.log('✅ TodoList 工具导入成功');

// 测试 1: 创建 Todo
async function testCreateTodo() {
  console.log('\n📝 测试 1: 创建 Todo');

  const tool = createTodoListTool();

  const result = await tool.execute({
    action: 'create',
    create: { content: '实现文件系统工具', priority: 'high' },
  });

  console.log('创建结果:', result);

  if (result.includes('Created todo:')) {
    console.log('✅ 创建 Todo 成功');
  } else {
    console.error('❌ 创建 Todo 失败');
  }

  return result;
}

// 测试 2: 创建多个 Todo
async function testCreateMultipleTodos() {
  console.log('\n📝 测试 2: 创建多个 Todo');

  const tool = createTodoListTool();

  // 创建多个 Todo
  await tool.execute({
    action: 'create',
    create: { content: '实现 AGENTS.md 自动发现', priority: 'medium' },
  });

  await tool.execute({
    action: 'create',
    create: { content: '实现 TodoList 工具', priority: 'high' },
  });

  await tool.execute({
    action: 'create',
    create: { content: '实现 Compiled/Async 子代理', priority: 'low' },
  });

  // 列出所有 Todo
  const result = await tool.execute({ action: 'list' });
  console.log('所有 Todo:', result);

  if (
    result.includes('实现文件系统工具') &&
    result.includes('实现 AGENTS.md 自动发现') &&
    result.includes('实现 TodoList 工具')
  ) {
    console.log('✅ 创建多个 Todo 成功');
  } else {
    console.error('❌ 创建多个 Todo 失败');
  }
}

// 测试 3: 更新 Todo 状态
async function testUpdateTodo() {
  console.log('\n📝 测试 3: 更新 Todo 状态');

  const tool = createTodoListTool();

  // 创建一个 Todo
  const createResult = await tool.execute({
    action: 'create',
    create: { content: '测试任务', priority: 'medium' },
  });

  // 提取 ID
  const idMatch = createResult.match(/Created todo: (todo-[\w-]+)/);
  if (!idMatch) {
    console.error('❌ 无法提取 Todo ID');
    return;
  }

  const todoId = idMatch[1];
  console.log('Todo ID:', todoId);

  // 更新状态为 in_progress
  const updateResult = await tool.execute({
    action: 'update',
    update: { id: todoId, status: 'in_progress' },
  });

  console.log('更新结果:', updateResult);

  if (updateResult.includes('Updated todo') && updateResult.includes('in_progress')) {
    console.log('✅ 更新 Todo 状态成功');
  } else {
    console.error('❌ 更新 Todo 状态失败');
  }

  // 列出 in_progress 的 Todo
  const listResult = await tool.execute({
    action: 'list',
    list: { status: 'in_progress' },
  });

  console.log('in_progress 的 Todo:', listResult);

  if (listResult.includes('测试任务')) {
    console.log('✅ 按状态过滤成功');
  } else {
    console.error('❌ 按状态过滤失败');
  }
}

// 测试 4: 清除所有 Todo
async function testClearTodos() {
  console.log('\n📝 测试 4: 清除所有 Todo');

  const tool = createTodoListTool();

  // 创建一些 Todo
  await tool.execute({ action: 'create', create: { content: '任务 1' } });
  await tool.execute({ action: 'create', create: { content: '任务 2' } });

  // 清除所有
  const clearResult = await tool.execute({ action: 'clear' });
  console.log('清除结果:', clearResult);

  // 列出所有（应该为空）
  const listResult = await tool.execute({ action: 'list' });
  console.log('清除后的列表:', listResult);

  if (clearResult.includes('Cleared all todos') && listResult.includes('No todos found')) {
    console.log('✅ 清除所有 Todo 成功');
  } else {
    console.error('❌ 清除所有 Todo 失败');
  }
}

// 测试 5: TodoList 插件
async function testTodoListPlugin() {
  console.log('\n📝 测试 5: TodoList 插件');

  const state: TodoListState = { items: [] };
  const plugin = createTodoListPlugin(state);

  console.log('插件名称:', plugin.name);
  console.log('插件优先级:', plugin.priority);
  console.log('插件类型:', plugin.type);

  if (plugin.name === 'todo-list' && plugin.priority === 15) {
    console.log('✅ TodoList 插件创建成功');
  } else {
    console.error('❌ TodoList 插件创建失败');
  }
}

// 测试 6: formatTodoState
async function testFormatTodoState() {
  console.log('\n📝 测试 6: formatTodoState');

  const state: TodoListState = {
    items: [
      {
        id: '1',
        content: '进行中的任务',
        status: 'in_progress',
        priority: 'high',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '2',
        content: '待办任务 1',
        status: 'pending',
        priority: 'medium',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '3',
        content: '待办任务 2',
        status: 'pending',
        priority: 'low',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '4',
        content: '已完成任务',
        status: 'completed',
        priority: 'high',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  };

  const formatted = formatTodoState(state);
  console.log('格式化结果:\n', formatted);

  if (
    formatted.includes('In Progress') &&
    formatted.includes('Pending') &&
    formatted.includes('Completed')
  ) {
    console.log('✅ formatTodoState 成功');
  } else {
    console.error('❌ formatTodoState 失败');
  }
}

// 运行所有测试
async function runAllTests() {
  try {
    await testCreateTodo();
    await testCreateMultipleTodos();
    await testUpdateTodo();
    await testClearTodos();
    await testTodoListPlugin();
    await testFormatTodoState();

    console.log('\n🎉 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

runAllTests();
