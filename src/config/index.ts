import { ServerConfigSchema, AgentConfigSchema } from './schema.js';
import type { ServerConfig, AgentConfig } from './schema.js';

export function validateServerConfig(config: unknown): ServerConfig {
  return ServerConfigSchema.parse(config);
}

export function validateAgentConfig(config: unknown): AgentConfig {
  return AgentConfigSchema.parse(config);
}

export { ServerConfigSchema, AgentConfigSchema };
export type { ServerConfig, AgentConfig };
