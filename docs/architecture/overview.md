# AgentForge Architecture Overview

AgentForge is a modern, modular Agent development framework built on TypeScript, designed for building production-ready AI agents with minimal boilerplate.

## Core Architecture

### 1. Configuration System

The configuration system is based on Zod for schema validation and supports multiple file formats:

- **Schema Definition**: `src/config/schema.ts` - Zod schemas for all configuration types
- **Configuration Loader**: `src/config/loader.ts` - Multi-path search, supports Markdown (with frontmatter) and JSON
- **Features**:
  - Automatic config file discovery
  - Type-safe validation with clear error messages
  - Support for frontmatter + content system prompt in Markdown
  - Config merging from multiple sources

### 2. Agent Factory

The Agent Factory provides a unified way to create Agent instances with all dependencies:

- **Location**: `src/agent/factory.ts`
- **Features**:
  - One-shot agent creation
  - Dependency injection for all core components
  - Automatic merging of model configuration
  - Optional auto-registration of built-in tools

### 3. Core Components

- **Agent**: `src/agent/agent.ts` - Core agent execution engine
- **Adapters**: `src/adapters/` - LLM provider adapters (OpenAI, compatible endpoints)
- **Tools**: `src/tools/` - Built-in tools and tool registry
- **Memory**: `src/memory/` - Conversation history management
- **Plugins**: `src/plugin/` - Plugin system for extensibility
- **Middleware**: `src/middleware/` - Execution middleware
- **Cache**: `src/cache/` - Caching utilities

## Configuration System

### File Formats

#### Markdown with Frontmatter (Recommended)

```markdown
---
name: my-assistant
version: 1.0.0
agent:
  name: My Assistant
  model: gpt-4o
  maxSteps: 15
server:
  port: 3000
---

You are a helpful assistant...
```

The Markdown content becomes the `agent.systemPrompt`.

#### JSON

```json
{
  "name": "my-assistant",
  "agent": {
    "name": "My Assistant",
    "model": "gpt-4o"
  }
}
```

### Configuration Schema

**AgentForgeConfig** (top-level):

- `name` - Project name (required)
- `version` - Project version (default: 1.0.0)
- `description` - Project description (optional)
- `agent` - Agent configuration (required)
- `model` - Global model configuration (optional)
- `server` - Server configuration (optional)
- `environment` - development/production/test (default: development)
- `logging` - Logging configuration (optional)

**AgentConfig**:

- `name` - Agent name (required)
- `description` - Agent description (optional)
- `model` - Model identifier (default: gpt-4-turbo)
- `apiKey` - Optional API key override
- `baseURL` - Optional base URL override
- `temperature` - Sampling temperature (optional)
- `maxTokens` - Max tokens per response (optional)
- `maxSteps` - Max reasoning steps (default: 10)
- `systemPrompt` - System prompt (optional)
- `tools` - Array of tool names or tool configs (default: [])
- `plugins` - Array of plugin configs (default: [])
- `memory` - Memory configuration (optional)

## Workflow

1. Load and validate configuration
2. Create agent through factory
3. (Optional) Start HTTP server for API access
4. Agent handles conversation, tool calling, and memory

## Directory Structure

```
src/
├── config/         # Configuration system (schema, loader)
├── agent/          # Core agent and factory
├── adapters/       # LLM adapters
├── tools/          # Built-in tools
├── memory/         # Memory management
├── cache/          # Caching
├── plugin/         # Plugin system
├── middleware/     # Middleware
├── examples/       # Usage examples
tests/
├── config/         # Config system tests
├── agent/          # Agent tests
├── memory/         # Memory tests
└── ...
```
