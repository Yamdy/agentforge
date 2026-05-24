import {
  AgentForgeConfigSchema,
  AgentConfigSchema,
  ServerConfigSchema,
  ModelConfigSchema,
  ToolConfigSchema,
  PluginConfigSchema,
} from './schema.js';
import type {
  AgentForgeConfig,
  AgentConfig,
  ServerConfig,
  ModelConfig,
  ToolConfig,
  PluginConfig,
} from './schema.js';

export * from './loader.js';
export { ConfigLoader, loadConfig, loadConfigSync } from './loader.js';
export type { LoadConfigOptions } from './loader.js';

export function validateAgentForgeConfig(config: unknown): AgentForgeConfig {
  return AgentForgeConfigSchema.parse(config);
}

export function validateServerConfig(config: unknown): ServerConfig {
  return ServerConfigSchema.parse(config);
}

export function validateAgentConfig(config: unknown): AgentConfig {
  return AgentConfigSchema.parse(config);
}

export function validateModelConfig(config: unknown): ModelConfig {
  return ModelConfigSchema.parse(config);
}

export {
  AgentForgeConfigSchema,
  AgentConfigSchema,
  ServerConfigSchema,
  ModelConfigSchema,
  ToolConfigSchema,
  PluginConfigSchema,
};

export * from './paths.js';

export type { AgentForgeConfig, AgentConfig, ServerConfig, ModelConfig, ToolConfig, PluginConfig };
