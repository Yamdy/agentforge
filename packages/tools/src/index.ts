// @primo-ai/tools — Built-in tools

export { echoTool } from './echo.js';

// Web tools
export { webSearchTool, createWebSearchTool, type WebSearchOptions } from './web-search.js';
export { webFetchTool, createWebFetchTool, type WebFetchOptions } from './web-fetch.js';

// Memory tools
export {
  memoryStoreTool,
  memoryRetrieveTool,
  memoryListTool,
  createMemoryTools,
  createInMemoryStore,
  type MemoryStore,
  type MemoryToolsOptions,
} from './memory.js';

// Tool collections
import { echoTool } from './echo.js';
import { webSearchTool } from './web-search.js';
import { webFetchTool } from './web-fetch.js';
import { memoryStoreTool, memoryRetrieveTool, memoryListTool } from './memory.js';

export const builtinTools = [
  echoTool,
  webSearchTool,
  webFetchTool,
  memoryStoreTool,
  memoryRetrieveTool,
  memoryListTool,
];

export const toolsByCategory = {
  web: [webSearchTool, webFetchTool],
  utility: [echoTool],
  memory: [memoryStoreTool, memoryRetrieveTool, memoryListTool],
};

export function registerBuiltinTools(
  registry: { register(tool: unknown): void },
  options?: { exclude?: string[]; only?: string[] }
): void {
  const exclude = new Set(options?.exclude ?? []);
  const only = options?.only ? new Set(options.only) : null;
  for (const tool of builtinTools) {
    if (exclude.has((tool as { name: string }).name)) continue;
    if (only && !only.has((tool as { name: string }).name)) continue;
    registry.register(tool);
  }
}
