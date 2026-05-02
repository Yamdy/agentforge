/**
 * TodoList Tool & Plugin for AgentForge
 *
 * Provides task tracking capabilities:
 * - TodoList Tool: CRUD operations for todo items (create, update, list, clear)
 * - TodoList Plugin: Injects current todo state as system message before llm.request
 *
 * Priority: 15 (after Memory at 10, before Summarization at 20)
 * Design intent: Model sees task progress first, then AGENTS.md, then skill list.
 *
 * @module
 */

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';
import type { InterceptorPlugin, PluginContext } from '../plugins/plugin.js';
import type { AgentEvent, Message } from '../core/events.js';
import { generateId } from '../core/events.js';

// ============================================================
// Types
// ============================================================

/**
 * Status of a todo item
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Priority level of a todo item
 */
export type TodoPriority = 'low' | 'medium' | 'high';

/**
 * A single todo item
 */
export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: number;
  updatedAt: number;
}

/**
 * State container for all todo items
 */
export interface TodoListState {
  items: TodoItem[];
}

// ============================================================
// Zod Schemas
// ============================================================

const TodoListSchema = z.object({
  action: z.enum(['create', 'update', 'list', 'clear']),
  create: z
    .object({
      content: z.string().describe('The task description'),
      priority: z.enum(['low', 'medium', 'high']).default('medium'),
    })
    .optional(),
  update: z
    .object({
      id: z.string().describe('The todo item ID'),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    })
    .optional(),
  list: z
    .object({
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'all']).default('all'),
    })
    .optional(),
});

// ============================================================
// TodoList Tool
// ============================================================

/**
 * Create a TodoList tool for task tracking.
 *
 * Actions:
 * - create: Add a new todo item
 * - update: Update a todo item's status
 * - list: List todo items (optionally filtered by status)
 * - clear: Remove all todo items
 *
 * @param initialState - Optional initial state (for sharing state with plugin)
 * @returns ToolDefinition for the todo_list tool
 */
export function createTodoListTool(initialState?: TodoListState): ToolDefinition {
  const state: TodoListState = initialState ?? { items: [] };

  return {
    name: 'todo_list',
    description: 'Manage a task list. Use this to track progress on multi-step tasks.',
    parameters: TodoListSchema,
    // eslint-disable-next-line @typescript-eslint/require-await
    execute: async (args: unknown): Promise<string> => {
      const parsed = TodoListSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { action, create, update, list } = parsed.data;

      switch (action) {
        case 'create': {
          if (!create) {
            return 'Error: Missing create parameters. Provide { content, priority? }.';
          }
          const item: TodoItem = {
            id: generateId('todo'),
            content: create.content,
            status: 'pending',
            priority: create.priority,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.items.push(item);
          return `Created todo: ${item.id} - ${item.content}`;
        }

        case 'update': {
          if (!update) {
            return 'Error: Missing update parameters. Provide { id, status }.';
          }
          const item = state.items.find(i => i.id === update.id);
          if (!item) return `Error: Todo ${update.id} not found`;
          item.status = update.status;
          item.updatedAt = Date.now();
          return `Updated todo ${item.id}: ${item.status}`;
        }

        case 'list': {
          const status = list?.status ?? 'all';
          const filtered =
            status === 'all' ? state.items : state.items.filter(i => i.status === status);

          if (filtered.length === 0) return 'No todos found';

          return filtered
            .map(
              i => `[${i.status === 'completed' ? 'x' : ' '}] ${i.id}: ${i.content} (${i.priority})`
            )
            .join('\n');
        }

        case 'clear': {
          state.items = [];
          return 'Cleared all todos';
        }
      }
    },
  };
}

// ============================================================
// TodoList Plugin
// ============================================================

/**
 * Format todo state as a human-readable prompt section.
 *
 * Shows:
 * - In Progress items (active work)
 * - Pending items (upcoming work)
 * - Completed items (last 3, with overflow indicator)
 */
export function formatTodoState(state: TodoListState): string {
  const pending = state.items.filter(i => i.status === 'pending');
  const inProgress = state.items.filter(i => i.status === 'in_progress');
  const completed = state.items.filter(i => i.status === 'completed');

  let prompt = '# Current Task Progress\n\n';

  if (inProgress.length > 0) {
    prompt += '## In Progress\n';
    inProgress.forEach(i => (prompt += `- ${i.content}\n`));
    prompt += '\n';
  }

  if (pending.length > 0) {
    prompt += '## Pending\n';
    pending.forEach(i => (prompt += `- ${i.content}\n`));
    prompt += '\n';
  }

  if (completed.length > 0) {
    prompt += `## Completed (${completed.length})\n`;
    completed.slice(-3).forEach(i => (prompt += `- ✓ ${i.content}\n`));
    if (completed.length > 3) {
      prompt += `- ... and ${completed.length - 3} more\n`;
    }
  }

  return prompt;
}

/**
 * Create a TodoList plugin that injects current todo state
 * as a system message before llm.request events.
 *
 * Priority: 15 (after Memory at 10, before Summarization at 20)
 *
 * @param state - Shared TodoListState (same reference as the tool)
 * @returns InterceptorPlugin
 */
export function createTodoListPlugin(state: TodoListState): InterceptorPlugin {
  return {
    name: 'todo-list',
    type: 'interceptor' as const,
    priority: 15,
    eventTypes: ['llm.request'],
    enabled: true,

    intercept(event: AgentEvent, _ctx: PluginContext): AgentEvent {
      if (event.type !== 'llm.request') return event;
      if (state.items.length === 0) return event;

      const todoPrompt = formatTodoState(state);
      const todoMessage: Message = { role: 'system', content: todoPrompt, name: 'todo-list' };

      return { ...event, messages: [todoMessage, ...event.messages] };
    },
  };
}
