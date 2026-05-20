import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigLoader, OpenAICompatibleGateway, ModelFactory } from '@primo-ai/core';
import type { AgentRegistry } from './registry.js';
import type { GatewayConfig, AgentConfig } from '@primo-ai/sdk';
import { ProfileLoader, builtinProfiles, applyProfile } from './profiles/index.js';
import { type ResolvedConfigSources, type DiscoveryOptions, resolveSkillDirectories, resolveMcpServers } from './discovery.js';
import { discoverSkills, skillPlugin, mcpPlugin, McpManager, type SkillFileSystem } from '@primo-ai/plugins';
import type { StudioObservability } from './studio/observability.js';

export interface ServerConfig {
  agents?: Record<string, Partial<AgentConfig> & { model: string; profile?: string }>;
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

const nodeFs: SkillFileSystem = {
  readdir: async (dir: string) => {
    const { readdir: fsReaddir } = await import('node:fs/promises');
    return fsReaddir(dir);
  },
  readFile: async (path: string) => {
    const { readFile: fsReadFile } = await import('node:fs/promises');
    return fsReadFile(path, 'utf-8');
  },
};

const nodeMcpFs = {
  readFile: async (path: string) => {
    return readFile(resolve(path), 'utf-8');
  },
};

export async function loadAndRegister(
  configSources: ResolvedConfigSources,
  registry: AgentRegistry,
  defaultProfile?: string,
  discoveryOpts?: DiscoveryOptions,
  observability?: StudioObservability,
): Promise<{ agentIds: string[]; modelFactory: ModelFactory; mcpManager?: McpManager }> {
  // Load and merge config from all sources
  const loader = new ConfigLoader();
  const config = await loader.load({
    env: configSources.env,
    global: configSources.global,
    project: configSources.project,
  });

  const serverConfig = validateConfig(config);

  // Build shared ModelFactory with custom gateways
  const modelFactory = new ModelFactory();
  for (const gw of serverConfig.modelGateways ?? []) {
    modelFactory.registerGateway(new OpenAICompatibleGateway({
      name: gw.name,
      url: gw.url,
      apiKey: gw.apiKey ?? process.env[`${gw.name.toUpperCase()}_API_KEY`],
    }));
  }

  // Discover skills — merge config skills.paths with discovery options
  const skillPaths = (config as { skills?: { paths?: string[] } }).skills?.paths ?? [];
  const skillDirs = resolveSkillDirectories(
    process.cwd(),
    process.env.HOME ?? '',
    { ...discoveryOpts, extraSkillDirs: [...(discoveryOpts?.extraSkillDirs ?? []), ...skillPaths] },
  );
  const skills = await discoverSkills(skillDirs, nodeFs);

  // Discover MCP servers
  const mcpServers = await resolveMcpServers(process.cwd(), process.env.HOME ?? '', nodeMcpFs);

  // Build profile loader with built-in profiles
  const profileLoader = new ProfileLoader();
  for (const profile of builtinProfiles()) {
    profileLoader.register(profile);
  }

  // Register agents and apply profiles
  const agentIds: string[] = [];
  for (const [id, agentConfig] of Object.entries(serverConfig.agents ?? {})) {
    const agent = registry.register(id, agentConfig as AgentConfig, { modelFactory });

    // Apply profile first (may include its own skillPlugin with empty skills)
    const profileName = agentConfig.profile ?? defaultProfile;
    if (profileName) {
      const profile = profileLoader.load(profileName);
      applyProfile(agent, profile);
    }

    // Attach discovery-based plugins after profile
    // (skillPlugin from discovery replaces the empty-skills one from profile)
    if (skills.length > 0) {
      agent.use(skillPlugin({ skills }));
    }

    if (mcpServers.length > 0) {
      agent.use(mcpPlugin({ servers: mcpServers }));
    }

    // Attach to Studio observability if enabled
    if (observability) {
      observability.attachAgent(agent);
    }

    agentIds.push(id);
  }

  // Expose McpManager for runtime management via API when MCP servers are configured
  const mcpManager = mcpServers.length > 0 ? new McpManager() : undefined;

  return { agentIds, modelFactory, mcpManager };
}
