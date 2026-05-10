// @agentforge/plugins — Built-in Processors

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
  createCompressionProcessor,
  type CompressionPluginOptions,
  type CompressionConfig,
  type CompressionPhase,
  type SummarizeFn,
  type Message as CompressionMessage,
} from './compression/index.js';

export {
  evictionPlugin,
  InMemoryEvictionStorage,
  type EvictionPluginOptions,
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
