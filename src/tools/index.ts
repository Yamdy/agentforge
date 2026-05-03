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

export { createBashTool, type BashToolConfig } from './bash.js';

export { createWebFetchTool, type WebFetchToolConfig } from './web-fetch.js';

export { createAskUserQuestionTool } from './ask-user.js';

export {
  createSyntheticOutputTool,
  registerOutputType,
  hasOutputType,
  clearOutputTypes,
  SYNTHETIC_OUTPUT_TOOL_NAME,
} from './synthetic-output.js';

export { taskRegistry, TaskRegistry } from './task-registry.js';

export { createTaskKillTool } from './task-kill.js';

export { createWebSearchTool, type WebSearchToolConfig } from './web-search.js';

export { createMemorySearchTool } from './memory-search.js';

export { createAddNoteTool, createPinContentTool } from './working-memory-tools.js';
