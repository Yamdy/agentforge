import {
  PrimoConfigSchema,
  AgentConfigSchema,
  ServerConfigSchema,
  ModelConfigSchema,
  ToolConfigSchema,
  PluginConfigSchema,
} from './schema.js';
import type {
  PrimoConfig,
  AgentConfig,
  ServerConfig,
  ModelConfig,
  ToolConfig,
  PluginConfig,
} from './schema.js';

export * from './loader.js';
export { ConfigLoader, loadConfig, loadConfigSync } from './loader.js';
export type { LoadConfigOptions } from './loader.js';

export function validatePrimoConfig(config: unknown): PrimoConfig {
  return PrimoConfigSchema.parse(config);
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
  PrimoConfigSchema,
  AgentConfigSchema,
  ServerConfigSchema,
  ModelConfigSchema,
  ToolConfigSchema,
  PluginConfigSchema,
};

export type { PrimoConfig, AgentConfig, ServerConfig, ModelConfig, ToolConfig, PluginConfig };
