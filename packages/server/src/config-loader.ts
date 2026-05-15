import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigLoader, OpenAICompatibleGateway, ModelFactory } from '@agentforge/core';
import type { AgentRegistry } from './registry.js';
import type { GatewayConfig, AgentConfig } from '@agentforge/sdk';

export interface ServerConfig {
  agents?: Record<string, Partial<AgentConfig> & { model: string }>;
  modelGateways?: GatewayConfig[];
}

export function validateConfig(raw: unknown): ServerConfig {
  const errors: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Config must be an object');
  }

  const config = raw as Record<string, unknown>;

  // Validate agents
  if ('agents' in config && config.agents !== undefined) {
    if (typeof config.agents !== 'object' || config.agents === null || Array.isArray(config.agents)) {
      errors.push('agents must be an object');
    } else {
      for (const [id, agent] of Object.entries(config.agents as Record<string, unknown>)) {
        if (agent === null || typeof agent !== 'object' || Array.isArray(agent)) {
          errors.push(`agent "${id}" must be an object`);
        } else {
          const a = agent as Record<string, unknown>;
          if (typeof a.model !== 'string' || a.model === '') {
            errors.push(`agent "${id}" must have a non-empty string "model"`);
          }
        }
      }
    }
  }

  // Validate modelGateways
  if ('modelGateways' in config && config.modelGateways !== undefined) {
    if (!Array.isArray(config.modelGateways)) {
      errors.push('modelGateways must be an array');
    } else {
      config.modelGateways.forEach((gw: unknown, i: number) => {
        if (gw === null || typeof gw !== 'object' || Array.isArray(gw)) {
          errors.push(`gateway [${i}] must be an object`);
        } else {
          const g = gw as Record<string, unknown>;
          if (typeof g.name !== 'string' || g.name === '') {
            errors.push(`gateway [${i}] must have a non-empty string "name"`);
          }
          if (typeof g.url !== 'string' || g.url === '') {
            errors.push(`gateway [${i}] must have a non-empty string "url"`);
          }
        }
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  return config as unknown as ServerConfig;
}

export async function loadAndRegister(
  configPath: string,
  registry: AgentRegistry,
): Promise<{ agentIds: string[] }> {
  const content = await readFile(resolve(configPath), 'utf-8');
  const loader = new ConfigLoader();
  const raw = loader.parseJsonc(content);
  const config = validateConfig(raw);

  // Build shared ModelFactory with custom gateways
  const modelFactory = new ModelFactory();
  for (const gw of config.modelGateways ?? []) {
    modelFactory.registerGateway(new OpenAICompatibleGateway({
      name: gw.name,
      url: gw.url,
      apiKey: gw.apiKey ?? process.env[`${gw.name.toUpperCase()}_API_KEY`],
    }));
  }

  // Register agents
  const agentIds: string[] = [];
  for (const [id, agentConfig] of Object.entries(config.agents ?? {})) {
    registry.register(id, agentConfig as AgentConfig, { modelFactory });
    agentIds.push(id);
  }

  return { agentIds };
}
