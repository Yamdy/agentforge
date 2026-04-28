/**
 * Filesystem Tools Module
 *
 * Provides sandboxed filesystem tools for agent use.
 *
 * @example
 * ```typescript
 * import { createFilesystemTools } from './tools/index.js';
 *
 * const tools = createFilesystemTools({
 *   rootDir: '/sandbox',
 *   writable: true,
 *   maxFileSize: 10 * 1024 * 1024,
 * });
 *
 * // Register with tool registry
 * for (const tool of tools) {
 *   registry.register(tool);
 * }
 * ```
 */

export {
  createFilesystemTools,
  resolveSafePath,
  isWithinRoot,
  type FilesystemToolsConfig,
} from './filesystem.js';

export {
  createTodoListTool,
  createTodoListPlugin,
  formatTodoState,
  type TodoItem,
  type TodoListState,
  type TodoStatus,
  type TodoPriority,
} from './todo-list.js';