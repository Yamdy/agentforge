// @primo-ai/plugins — Built-in Processors

export {
  memoryPlugin,
  InMemoryBackend,
  SQLiteBackend,
  type MemoryPluginOptions,
  type MemoryBackend,
  type MemoryEntry,
  type MemoryConfig,
  type MemoryTriggerMode,
} from './memory/index.js';

export {
  compressionPlugin,
  createCompressionStrategy,
  type CompressionPluginOptions,
  type CompressionConfig,
  type CompressionPhase,
  type SummarizeFn,
  type Message as CompressionMessage,
} from './compression/index.js';

export {
  evictionPlugin,
  InMemoryEvictionStorage,
  FilesystemEvictionStorage,
  type EvictionPluginOptions,
  type FilesystemEvictionStorageOptions,
} from './eviction/index.js';

export {
  createPermissionProcessor,
  permissionPlugin,
  type PermissionRule,
  type PermissionMode,
  type PermissionConfig,
  type PermissionDecisionEvent,
  type PermissionPluginOptions,
} from './permission/index.js';

export {
  skillPlugin,
  createSkillProcessor,
  createReadSkillTool,
  discoverSkills,
  parseFrontmatter,
  type SkillDefinition,
  type SkillPluginOptions,
  type SkillFileSystem,
  type ParsedFrontmatter,
} from './skill/index.js';

export {
  mcpPlugin,
  type McpPluginOptions,
} from './mcp/index.js';

export {
  McpManager,
  type McpServerStatus,
} from './mcp/mcp-manager.js';

export {
  convertMcpTool,
  type McpToolDefinition,
} from './mcp/tool-converter.js';

export {
  createMcpClient,
  createMockMcpClient,
  type McpClient,
} from './mcp/mcp-client.js';

export {
  createFactInjectionProcessor,
  createGoalEchoProcessor,
  createTokenBudgetProcessor,
  createCostCapProcessor,
  createRateLimitProcessor,
  createRequiredToolsGate,
  setGateDecision,
  setCostAttributes,
  setBudgetAttributes,
  type FactInjectionConfig,
  type GoalEchoConfig,
  type TokenBudgetConfig,
  type CostCapConfig,
  type RateLimitConfig,
} from './harness/index.js';

export {
  createOutputValidationProcessor,
  type OutputValidationConfig,
  type ValidationStrategy,
} from './validation/index.js';
