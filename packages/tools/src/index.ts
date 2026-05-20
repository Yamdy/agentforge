// @primo-ai/tools — Built-in tools

export { echoTool } from './echo.js';
export { httpTool } from './http.js';
export { fileReadTool } from './file-read.js';
export { fileWriteTool } from './file-write.js';
export { fileEditTool } from './file-edit.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';
export { shellTool } from './shell.js';
export { calculatorTool } from './calculator.js';
export { datetimeTool } from './datetime.js';
export { jsonTool } from './json.js';

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
import { httpTool } from './http.js';
import { fileReadTool } from './file-read.js';
import { fileWriteTool } from './file-write.js';
import { fileEditTool } from './file-edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { shellTool } from './shell.js';
import { calculatorTool } from './calculator.js';
import { datetimeTool } from './datetime.js';
import { jsonTool } from './json.js';
import { webSearchTool } from './web-search.js';
import { webFetchTool } from './web-fetch.js';
import { memoryStoreTool, memoryRetrieveTool, memoryListTool } from './memory.js';

export const builtinTools = [
  echoTool,
  httpTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  globTool,
  grepTool,
  shellTool,
  calculatorTool,
  datetimeTool,
  jsonTool,
  webSearchTool,
  webFetchTool,
  memoryStoreTool,
  memoryRetrieveTool,
  memoryListTool,
];

export const toolsByCategory = {
  file: [fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool],
  web: [httpTool, webSearchTool, webFetchTool],
  system: [shellTool, datetimeTool],
  utility: [calculatorTool, jsonTool, echoTool],
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
