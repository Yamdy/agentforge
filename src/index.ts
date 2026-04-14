export { Agent, AgentFactory, createAgent } from './agent/index.js';
export type { StreamHandler, AgentFactoryOptions } from './agent/index.js';
export { ToolRegistry } from './registry.js';
export { InMemoryHistory } from './history.js';
export { AIAdapter } from './adapters/ai.js';
export { calculatorTool, searchTool, allTools } from './tools/index.js';
export * from './tools/builtin/index.js';
export { PluginManager } from './plugin/index.js';
export * as MCP from './mcp/index.js';
export * as Skill from './skill/index.js';
export * as SubAgent from './subagent/index.js';

export { createApp, startServer, type ServerConfig, type AgentRunner } from './server/index.js';
export { authMiddleware, type AuthConfig } from './server/middleware/auth.js';

export {
  AgentForgeClient,
  createAgentForgeClient,
  type AgentForgeClientConfig,
  type AgentStatus,
} from './sdk/client.js';

export type {
  Message,
  Tool,
  ToolCall,
  ToolParameters,
  ToolResult,
  LLMResponse,
  StreamEvent,
  LLMAdapter,
  HistoryManager,
  TaskStatus,
  TaskState,
  Schemas,
  RequestContext,
  RequestInterceptor,
  TimeoutConfig,
} from './types.js';
export { schemas } from './types.js';
export type { AgentConfig } from './config/index.js';
export type { Plugin, Hooks, HookEvent, ProviderContext, ProviderResult } from './plugin/types.js';
export type { Logger, LogEntry, LogLevel } from './logger/index.js';
export type { Span, TraceContext } from './tracer.js';

export { createLogger, logger, LogService } from './logger/index.js';
export { tracer, getTracer, setTracer } from './tracer.js';

export { createSessionAPI, type SessionAPI } from './session/index.js';
export type { Session, SessionMessage } from './session/index.js';

export { Storage } from './storage/index.js';

export {
  AppError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
  toErrorResponse,
} from './errors/index.js';

export {
  validateAgentForgeConfig,
  validateServerConfig,
  validateAgentConfig,
  validateModelConfig,
  ConfigLoader,
  loadConfig,
  loadConfigSync,
  AgentForgeConfigSchema,
  AgentConfigSchema,
  ServerConfigSchema,
} from './config/index.js';

export type {
  AgentForgeConfig,
  ModelConfig,
  ToolConfig,
  PluginConfig,
  LoadConfigOptions,
  // ServerConfig is already exported from server
} from './config/index.js';

export * as Config from './config/index.js';
export * as Workflow from './workflow/index.js';
export * as Memory from './memory/index.js';
export * as Observability from './observability/index.js';
export * as Sandbox from './sandbox/index.js';
export * from './context.js';
export { SQLiteMemoryStorage } from './storage/sqlite-memory.js';
