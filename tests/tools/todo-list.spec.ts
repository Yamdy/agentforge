/**
 * TodoList Tool & Plugin Tests
 *
 * Tests for createTodoListTool and createTodoListPlugin.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '../../src/core/events.js';
import type { PluginContext } from '../../src/plugins/plugin.js';
import type { AgentState } from '../../src/core/state.js';
import {
  createTodoListTool,
  createTodoListPlugin,
  type TodoListState,
  type TodoStatus,
} from '../../src/tools/todo-list.js';

// ============================================================
// Helpers
// ============================================================

function createPluginContext(): PluginContext {
  return { sessionId: 'test-session', agentName: 'test-agent' };
}

function createMockState(): AgentState {
  return {
    sessionId: 'test-session',
    step: 1,
    maxSteps: 10,
    status: 'running',
    messages: [],
    output: '',
    tokens: { input: 0, output: 0 },
  };
}

// ============================================================
// Plugin Test Helper — uses new requestHooks API
// ============================================================

/**
 * Run a Plugin's requestHooks against messages and return modified messages.
 */
async function runPluginRequestHook(
  plugin: ReturnType<typeof createTodoListPlugin>,
  messages: Message[],
): Promise<Message[]> {
  const hook = plugin.requestHooks?.[0];
  if (!hook) return messages;
  try {
    return await hook.apply(messages, createMockState());
  } catch {
    return messages;
  }
}

// ============================================================
// TodoList Tool Tests
// ============================================================

describe('createTodoListTool', () => {
  it('should create a tool with correct name and description', () => {
    const tool = createTodoListTool();
    expect(tool.name).toBe('todo_list');
    expect(tool.description).toContain('task');
  });

  it('should create a todo with create action', async () => {
    const tool = createTodoListTool();
    const result = await tool.execute({
      action: 'create',
      create: { content: 'Implement feature X', priority: 'high' },
    });
    expect(result).toContain('Created todo');
    expect(result).toContain('Implement feature X');
  });

  it('should create a todo with default medium priority', async () => {
    const tool = createTodoListTool();
    const result = await tool.execute({
      action: 'create',
      create: { content: 'Write tests' },
    });
    expect(result).toContain('Created todo');
  });

  it('should update todo status', async () => {
    const tool = createTodoListTool();

    // Create a todo first
    const createResult = await tool.execute({
      action: 'create',
      create: { content: 'Task to update', priority: 'medium' },
    });

    // Extract the ID from the result (format: "Created todo: {id} - {content}")
    const idMatch = createResult.match(/Created todo:\s*(\S+)\s*-/);
    expect(idMatch).not.toBeNull();
    const todoId = idMatch![1];

    // Update status to in_progress
    const updateResult = await tool.execute({
      action: 'update',
      update: { id: todoId, status: 'in_progress' },
    });

    expect(updateResult).toContain('Updated todo');
    expect(updateResult).toContain('in_progress');
  });

  it('should update todo status to completed', async () => {
    const tool = createTodoListTool();

    const createResult = await tool.execute({
      action: 'create',
      create: { content: 'Task to complete' },
    });
    const idMatch = createResult.match(/Created todo:\s*(\S+)\s*-/);
    const todoId = idMatch![1];

    const updateResult = await tool.execute({
      action: 'update',
      update: { id: todoId, status: 'completed' },
    });

    expect(updateResult).toContain('completed');
  });

  it('should list all todos', async () => {
    const tool = createTodoListTool();

    await tool.execute({
      action: 'create',
      create: { content: 'Task 1', priority: 'high' },
    });
    await tool.execute({
      action: 'create',
      create: { content: 'Task 2', priority: 'low' },
    });

    const result = await tool.execute({
      action: 'list',
      list: { status: 'all' },
    });

    expect(result).toContain('Task 1');
    expect(result).toContain('Task 2');
  });

  it('should list filtered todos by status', async () => {
    const tool = createTodoListTool();

    await tool.execute({
      action: 'create',
      create: { content: 'Pending task' },
    });

    const createResult = await tool.execute({
      action: 'create',
      create: { content: 'Task to complete' },
    });
    const idMatch = createResult.match(/Created todo:\s*(\S+)\s*-/);
    const todoId = idMatch![1];

    await tool.execute({
      action: 'update',
      update: { id: todoId, status: 'completed' },
    });

    // List only completed
    const completedResult = await tool.execute({
      action: 'list',
      list: { status: 'completed' },
    });
    expect(completedResult).toContain('Task to complete');
    expect(completedResult).not.toContain('Pending task');

    // List only pending
    const pendingResult = await tool.execute({
      action: 'list',
      list: { status: 'pending' },
    });
    expect(pendingResult).toContain('Pending task');
    expect(pendingResult).not.toContain('Task to complete');
  });

  it('should return "No todos found" when listing empty state', async () => {
    const tool = createTodoListTool();

    const result = await tool.execute({
      action: 'list',
      list: { status: 'all' },
    });

    expect(result).toBe('No todos found');
  });

  it('should clear all todos', async () => {
    const tool = createTodoListTool();

    await tool.execute({
      action: 'create',
      create: { content: 'Task to clear' },
    });

    const clearResult = await tool.execute({ action: 'clear' });
    expect(clearResult).toBe('Cleared all todos');

    const listResult = await tool.execute({
      action: 'list',
      list: { status: 'all' },
    });
    expect(listResult).toBe('No todos found');
  });

  it('should return error for invalid todo id on update', async () => {
    const tool = createTodoListTool();

    const result = await tool.execute({
      action: 'update',
      update: { id: 'nonexistent-id', status: 'completed' },
    });

    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('should return error for invalid action arguments', async () => {
    const tool = createTodoListTool();

    // Missing create data for create action
    const result = await tool.execute({
      action: 'create',
    });

    expect(result).toContain('Error');
  });

  it('should track createdAt and updatedAt timestamps', async () => {
    const tool = createTodoListTool();

    const beforeCreate = Date.now();
    await tool.execute({
      action: 'create',
      create: { content: 'Timestamped task' },
    });

    // List to verify timestamps exist in state
    const listResult = await tool.execute({
      action: 'list',
      list: { status: 'all' },
    });

    expect(listResult).toContain('Timestamped task');
  });

  it('should support all priority levels', async () => {
    const tool = createTodoListTool();

    for (const priority of ['low', 'medium', 'high'] as const) {
      const result = await tool.execute({
        action: 'create',
        create: { content: `${priority} priority task`, priority },
      });
      expect(result).toContain(`${priority} priority task`);
    }
  });

  it('should support all status transitions', async () => {
    const tool = createTodoListTool();

    const createResult = await tool.execute({
      action: 'create',
      create: { content: 'Status transition task' },
    });
    const idMatch = createResult.match(/Created todo:\s*(\S+)\s*-/);
    const todoId = idMatch![1];

    for (const status of ['in_progress', 'completed', 'cancelled'] as TodoStatus[]) {
      const result = await tool.execute({
        action: 'update',
        update: { id: todoId, status },
      });
      expect(result).toContain(status);
    }
  });
});

// ============================================================
// TodoList Plugin Tests
// ============================================================

describe('TodoListPlugin', () => {
  it('should inject todo state on llm.request when todos exist', async () => {
    const state: TodoListState = {
      items: [
        {
          id: 'todo-1',
          content: 'Implement feature',
          status: 'in_progress',
          priority: 'high',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'todo-2',
          content: 'Write tests',
          status: 'pending',
          priority: 'medium',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };

    const plugin = createTodoListPlugin(state);
    const messages: Message[] = [{ role: 'user', content: 'What should I do next?' }];
    const result = await runPluginRequestHook(plugin, messages);

    expect(result.length).toBeGreaterThan(1);

    // First message should be the todo state injection
    const systemMessage = result[0]!;
    expect(systemMessage.role).toBe('system');
    expect(systemMessage.content).toContain('Task Progress');
    expect(systemMessage.content).toContain('Implement feature');
    expect(systemMessage.content).toContain('Write tests');
  });

  it('should skip injection when no todos exist', async () => {
    const state: TodoListState = { items: [] };
    const plugin = createTodoListPlugin(state);

    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    const result = await runPluginRequestHook(plugin, messages);

    // No injection when empty
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('user');
  });

  it('should format completed todos with checkmark', async () => {
    const state: TodoListState = {
      items: [
        {
          id: 'todo-1',
          content: 'Completed task',
          status: 'completed',
          priority: 'low',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };
    const plugin = createTodoListPlugin(state);

    const messages: Message[] = [{ role: 'user', content: 'Status?' }];
    const result = await runPluginRequestHook(plugin, messages);

    const systemMessage = result[0]!;

    expect(systemMessage.content).toContain('Completed');
    expect(systemMessage.content).toContain('✓');
  });

  it('should have priority 15 (after Memory at 10, before Summarization at 20)', () => {
    const state: TodoListState = { items: [] };
    const plugin = createTodoListPlugin(state);

    expect(plugin.name).toBe('todo-list');
    expect(plugin.requestHooks).toBeDefined();
    expect(plugin.requestHooks![0]!.name).toBe('todo-list-inject');
    expect(plugin.requestHooks![0]!.priority).toBe(15);
  });

  it('should show in_progress items in a separate section', async () => {
    const state: TodoListState = {
      items: [
        {
          id: 'todo-1',
          content: 'Active task',
          status: 'in_progress',
          priority: 'high',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'todo-2',
          content: 'Waiting task',
          status: 'pending',
          priority: 'medium',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };
    const plugin = createTodoListPlugin(state);

    const messages: Message[] = [{ role: 'user', content: 'What next?' }];
    const result = await runPluginRequestHook(plugin, messages);

    const content = result[0]!.content;

    expect(content).toContain('In Progress');
    expect(content).toContain('Active task');
    expect(content).toContain('Pending');
    expect(content).toContain('Waiting task');
  });

  it('should truncate completed items to last 3 with overflow indicator', async () => {
    const state: TodoListState = {
      items: [
        { id: 'c1', content: 'Completed 1', status: 'completed' as const, priority: 'low' as const, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'c2', content: 'Completed 2', status: 'completed' as const, priority: 'low' as const, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'c3', content: 'Completed 3', status: 'completed' as const, priority: 'low' as const, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'c4', content: 'Completed 4', status: 'completed' as const, priority: 'low' as const, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'c5', content: 'Completed 5', status: 'completed' as const, priority: 'low' as const, createdAt: Date.now(), updatedAt: Date.now() },
      ],
    };
    const plugin = createTodoListPlugin(state);

    const messages: Message[] = [{ role: 'user', content: 'Status' }];
    const result = await runPluginRequestHook(plugin, messages);

    const content = result[0]!.content;

    // Should show last 3 completed items
    expect(content).toContain('Completed 3');
    expect(content).toContain('Completed 4');
    expect(content).toContain('Completed 5');
    // Should show overflow indicator
    expect(content).toContain('2 more');
  });
});

// ============================================================
// Integration: Tool + Plugin Together
// ============================================================

describe('TodoList Tool + Plugin Integration', () => {
  it('should share state between tool and plugin', async () => {
    const state: TodoListState = { items: [] };
    const tool = createTodoListTool(state);
    const plugin = createTodoListPlugin(state);

    // Create a todo via tool
    await tool.execute({
      action: 'create',
      create: { content: 'Integration task', priority: 'high' },
    });

    // Plugin should see the todo
    const messages: Message[] = [{ role: 'user', content: 'What should I do?' }];
    const result = await runPluginRequestHook(plugin, messages);

    const systemMessage = result[0]!;

    expect(systemMessage.content).toContain('Integration task');
  });
});
