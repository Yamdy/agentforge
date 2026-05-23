# @primo-ai/tools

Built-in tool implementations for AgentForge.

## Overview

Provides 16 ready-to-use tools that can be passed to any AgentForge agent. Tools follow the `Tool<TInput, TOutput>` interface from `@primo-ai/sdk`.

```typescript
import { builtinTools, Agent } from '@primo-ai/core';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  tools: builtinTools,
});
```

## Available Tools

### File Tools

| Tool | Name | Description | Approval |
|------|------|-------------|----------|
| `fileReadTool` | `fileRead` | Read file contents. Supports line range via offset/limit. | No |
| `fileWriteTool` | `fileWrite` | Write content to a file. Creates parent directories if needed. | **Yes** |
| `fileEditTool` | `fileEdit` | Exact string replacement in a file. Set `replaceAll` for all occurrences. | **Yes** |
| `globTool` | `glob` | Find files matching a glob pattern. Returns paths sorted by mtime. | No |
| `grepTool` | `grep` | Search file contents by regex. Returns matches with file paths and line numbers. | No |

```typescript
import { fileReadTool, fileEditTool } from '@primo-ai/tools';
```

### Web Tools

| Tool | Name | Description | Approval |
|------|------|-------------|----------|
| `httpTool` | `http` | Make HTTP requests (GET/POST/PUT/PATCH/DELETE). Returns status, headers, body. | No |
| `webSearchTool` | `web_search` | Search the web using DuckDuckGo. Returns titles, URLs, and snippets. | No |
| `webFetchTool` | `web_fetch` | Fetch and extract content from a web page. Strips scripts/styles. | No |

```typescript
import { httpTool, webSearchTool, webFetchTool } from '@primo-ai/tools';

// Web tools support factory functions for custom options
import { createWebSearchTool, createWebFetchTool } from '@primo-ai/tools';

const customSearch = createWebSearchTool({ provider: 'duckduckgo' });
const customFetch = createWebFetchTool({ timeout: 60000 });
```

### System Tools

| Tool | Name | Description | Approval |
|------|------|-------------|----------|
| `shellTool` | `shell` | Execute a shell command. Returns stdout, stderr, and exit code. | **Yes** |
| `datetimeTool` | `datetime` | Get current date/time. Supports timezone and format options. | No |

```typescript
import { shellTool, datetimeTool } from '@primo-ai/tools';
```

### Utility Tools

| Tool | Name | Description | Approval |
|------|------|-------------|----------|
| `calculatorTool` | `calculator` | Evaluate a math expression. Supports `Math.*` functions. | No |
| `jsonTool` | `json` | Parse, stringify, or query JSON data. Query uses dot-notation paths. | No |
| `echoTool` | `echo` | Returns the input message unchanged. Useful for testing. | No |

```typescript
import { calculatorTool, jsonTool, echoTool } from '@primo-ai/tools';
```

### Memory Tools

| Tool | Name | Description | Approval |
|------|------|-------------|----------|
| `memoryStoreTool` | `memory_store` | Store a key-value pair in memory for later retrieval. | No |
| `memoryRetrieveTool` | `memory_retrieve` | Retrieve a stored value from memory by key. | No |
| `memoryListTool` | `memory_list` | List all stored key-value pairs in memory. | No |

```typescript
import { createMemoryTools, createInMemoryStore } from '@primo-ai/tools';

// Use factory for a shared store across all three tools
const { storeTool, retrieveTool, listTool } = createMemoryTools();

// Or provide a custom store implementation
const customStore = createInMemoryStore();
const tools = createMemoryTools({ store: customStore });
```

## Tool Collections

```typescript
import { builtinTools, toolsByCategory, registerBuiltinTools } from '@primo-ai/tools';

// All 16 tools as a flat array
builtinTools;

// Tools grouped by category
toolsByCategory.file;    // [fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool]
toolsByCategory.web;     // [httpTool, webSearchTool, webFetchTool]
toolsByCategory.system;  // [shellTool, datetimeTool]
toolsByCategory.utility; // [calculatorTool, jsonTool, echoTool]
toolsByCategory.memory;  // [memoryStoreTool, memoryRetrieveTool, memoryListTool]

// Register all (or a subset) with a tool registry
registerBuiltinTools(registry);                              // All tools
registerBuiltinTools(registry, { exclude: ['shell'] });      // All except shell
registerBuiltinTools(registry, { only: ['fileRead', 'grep'] }); // Only these two
```

## Writing a Custom Tool

Tools use Zod schemas for input validation:

```typescript
import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

const myTool: Tool<{ query: string }, string> = {
  name: 'search',
  description: 'Search for information',
  inputSchema: z.object({ query: z.string().describe('Search query') }),
  requireApproval: false,
  async execute({ query }) {
    return `Results for: ${query}`;
  },
};
```

## Dependencies

- `@primo-ai/sdk` — `Tool` interface and type definitions
- `zod` — Schema validation
