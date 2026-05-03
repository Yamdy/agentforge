/**
 * TaskKillTool for AgentForge
 *
 * Provides a tool to kill background tasks registered in the TaskRegistry.
 * Background tasks are spawned by the bash tool when running in background mode.
 *
 * @example
 * ```typescript
 * import { createTaskKillTool } from './tools/task-kill.js';
 *
 * const tools = createTaskKillTool();
 * for (const tool of tools) {
 *   registry.register(tool);
 * }
 * ```
 */

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';
import { taskRegistry } from './task-registry.js';

// ============================================================
// Zod Schema
// ============================================================

const TaskKillSchema = z.object({
  task_id: z.string().describe('ID of the background task to kill'),
});

// ============================================================
// Tool Implementation
// ============================================================

function createTaskKillToolInstance(): ToolDefinition {
  return {
    name: 'task_kill',
    description:
      'Kill a background task by its ID. ' +
      'Background tasks are created when running bash commands with background=true. ' +
      'Returns the task ID and result of the kill operation.',
    parameters: TaskKillSchema,
    execute: async (args: unknown): Promise<string> => {
      const parsed = TaskKillSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { task_id } = parsed.data;

      const result = await taskRegistry.kill(task_id);

      if (!result.success) {
        return `Error: ${result.message}`;
      }

      // Note: We intentionally do NOT remove from registry here.
      // The bash.ts background mode handler will clean up the registry
      // when the process exits (via 'close' event).
      // This allows the user to query task status even after killing it.

      return `Task "${task_id}" killed. ${result.message}`;
    },
  };
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create the task_kill tool.
 *
 * @returns Array of ToolDefinition objects containing the task_kill tool
 *
 * @example
 * ```typescript
 * import { createTaskKillTool } from './tools/task-kill.js';
 *
 * const tools = createTaskKillTool();
 * for (const tool of tools) {
 *   registry.register(tool);
 * }
 * ```
 */
export function createTaskKillTool(): ToolDefinition[] {
  return [createTaskKillToolInstance()];
}
