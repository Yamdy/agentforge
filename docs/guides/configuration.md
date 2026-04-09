# Configuration Guide

AgentForge comes with a powerful, type-safe configuration system that supports multiple formats and automatic discovery.

## Quick Start

Create a `primo.config.md` in your project root:

```markdown
---
name: my-agent
agent:
  name: My Agent
  model: gpt-4o
  maxSteps: 15
---

You are a helpful assistant.
```

Load it in your code:

```typescript
import { loadConfig } from 'agentforge/config';
import { createAgent } from 'agentforge/agent';

const config = await loadConfig();
const agent = createAgent(config);
```

## Configuration File Discovery

The ConfigLoader automatically searches for configuration in these locations:

1. Current working directory
2. `./primo/` directory
3. `./.primo/` directory
4. Any additional custom paths you specify

It looks for these file names:

- `primo.config.md`
- `agent.md`
- `primo.md`
- `primo.config.json`
- `agent.json`
- `primo.json`

## Markdown with Frontmatter

This is the recommended format because it keeps your system prompt as clean Markdown:

```markdown
---
name: customer-support-bot
version: 1.0.0
description: 'Customer support AI agent'
environment: production
agent:
  name: Customer Support
  model: gpt-4o
  temperature: 0.5
  maxSteps: 20
  tools:
    - knowledge-base
    - ticket-system
  memory:
    enabled: true
    maxMessages: 50
server:
  port: 8080
  rateLimit:
    enabled: true
    maxRequests: 100
model:
  apiKey: ${OPENAI_API_KEY}
logging:
  level: info
  enabled: true
---

# System Prompt

You are a helpful customer support agent for Acme Corp.
Always be polite and helpful. If you don't know the answer, say so.
```

The Markdown content after the `---` frontmatter becomes `agent.systemPrompt`.

## JSON Format

You can also use plain JSON:

```json
{
  "name": "customer-support-bot",
  "version": "1.0.0",
  "agent": {
    "name": "Customer Support",
    "model": "gpt-4o",
    "systemPrompt": "You are a helpful customer support agent...",
    "maxSteps": 20,
    "tools": ["knowledge-base", "ticket-system"]
  }
}
```

## Loading Configuration

### Async Loading

```typescript
import { loadConfig, ConfigLoader } from 'agentforge/config';

// Automatic discovery
const config = await loadConfig();

// With custom search paths
const loader = new ConfigLoader(['./my-configs']);
const config = await loader.loadConfig();

// Load from specific file
const config = await loader.loadConfig({ filePath: './path/to/config.md' });
```

### Synchronous Loading

```typescript
import { loadConfigSync } from 'agentforge/config';

const config = loadConfigSync();
// or
const config = loadConfigSync({ filePath: './path/to/config.md' });
```

## Custom Search Paths

```typescript
import { ConfigLoader } from 'agentforge/config';

const loader = new ConfigLoader(['/etc/primo/', '/home/user/.config/primo/', './project-configs/']);

const foundPath = loader.findConfigFile();
if (foundPath) {
  const config = loader.loadConfigSync({ filePath: foundPath });
}
```

## Merging Configurations

```typescript
import { ConfigLoader } from 'agentforge/config';

const loader = new ConfigLoader();

const baseConfig = { name: 'base', agent: { name: 'Base' } };
const productionOverrides = { environment: 'production' as const };

const merged = loader.mergeConfigs(baseConfig, productionOverrides);
```

Arrays like `tools`, `plugins`, and `middleware` are concatenated, not replaced.

## TypeScript Types

All configurations are fully typed:

```typescript
import type {
  AgentForgeConfig,
  AgentConfig,
  ServerConfig,
  ModelConfig,
  ToolConfig,
  PluginConfig,
} from 'agentforge/config';
```

## Validation

All configurations are validated against Zod schemas automatically. If validation fails, you get a clear error message:

```
Configuration validation failed: agent.name: Required
```

## Examples

Check the `src/examples/` directory for complete working examples:

- `config-basic.ts` - Basic configuration loading
- `agent-factory.ts` - Creating agents with the factory
- `custom-config-path.ts` - Custom search paths and explicit loading
