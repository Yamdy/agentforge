# @primo-ai/tools

Built-in tool implementations for AgentForge.

## Overview

Provides ready-to-use tools that can be passed to any AgentForge agent. Tools follow the `Tool<TInput, TOutput>` interface from `@primo-ai/sdk`.

## Available Tools

### echo

Returns the input message unchanged. Useful for testing and debugging.

```typescript
import { echoTool } from '@primo-ai/tools';
import { Agent } from '@primo-ai/core';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  tools: [echoTool],
});
```

**Schema:** `{ message: string }`
**Output:** `string` (the input message)

## Writing a Custom Tool

Tools use Zod schemas for input validation:

```typescript
import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

const myTool: Tool<{ query: string }, string> = {
  name: 'search',
  description: 'Search for information',
  inputSchema: z.object({ query: z.string().describe('Search query') }),
  execute: async ({ query }) => {
    return `Results for: ${query}`;
  },
};
```

## Dependencies

- `@primo-ai/sdk` -- `Tool` interface and type definitions
- `zod` -- Schema validation
