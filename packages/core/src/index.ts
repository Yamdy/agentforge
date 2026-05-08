// ─── @agentforge/core — Public API ──────────────────────────────────

export type {
  Agent,
  AgentEvent,
  CompletedToolCall,
  JSONValue,
  LLMAdapter,
  LLMRequest,
  LLMResponse,
  Message,
  Plugin,
  RunHandlers,
  RunResult,
  ToolCall,
  ToolDef,
  ToolResult,
} from './types.js';

export { Runtime } from './runtime.js';
export type { RuntimeConfig } from './runtime.js';
export type { AgentConfig } from './runtime.js';

export { createAgentLoop } from './agent-loop.js';

export { tool, createToolRegistry } from './tool.js';

export { executePluginHook } from './plugin.js';
