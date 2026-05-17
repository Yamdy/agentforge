import type { McpServerConfig } from '@primo-ai/sdk';
import { ConfigLoader } from '@primo-ai/core';
import { join } from 'node:path/posix';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryOptions {
  agentsConvention?: boolean;
  agentforgeConvention?: boolean;
  extraSkillDirs?: string[];
}

export interface ResolvedConfigSources {
  global?: string;
  project?: string;
  env?: string;
}

export interface McpFileSystem {
  readFile(path: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// resolveSkillDirectories
// ---------------------------------------------------------------------------

export function resolveSkillDirectories(
  cwd: string,
  home: string,
  options?: DiscoveryOptions,
): string[] {
  const agents = options?.agentsConvention !== false;
  const agentforge = options?.agentforgeConvention !== false;

  if (!agents && !agentforge && !options?.extraSkillDirs?.length) {
    return [];
  }

  const dirs: string[] = [];

  // Project-level: cwd only (single level, no ancestor walking)
  if (agentforge) dirs.push(join(cwd, '.agentforge', 'skills'));
  if (agents) dirs.push(join(cwd, '.agents', 'skills'));

  // User-level
  if (agentforge) dirs.push(join(home, '.agentforge', 'skills'));
  if (agents) dirs.push(join(home, '.agents', 'skills'));

  // Extra dirs (highest priority)
  if (options?.extraSkillDirs) {
    dirs.push(...options.extraSkillDirs);
  }

  return dirs;
}

// ---------------------------------------------------------------------------
// resolveConfigSources
// ---------------------------------------------------------------------------

export function resolveConfigSources(
  cwd: string,
  home: string,
  cliConfig?: string,
): ResolvedConfigSources {
  const sources: ResolvedConfigSources = {};

  // Global config
  sources.global = join(home, '.agentforge', 'config.jsonc');

  // Project config (or CLI override)
  if (cliConfig) {
    sources.project = cliConfig;
  } else {
    sources.project = join(cwd, '.agentforge', 'config.jsonc');
  }

  // Environment variable
  const envConfig = process.env.AGENTFORGE_CONFIG;
  if (envConfig) {
    sources.env = envConfig;
  }

  return sources;
}

// ---------------------------------------------------------------------------
// resolveMcpServers
// ---------------------------------------------------------------------------

export async function resolveMcpServers(
  cwd: string,
  home: string,
  fs: McpFileSystem,
): Promise<McpServerConfig[]> {
  const loader = new ConfigLoader();
  const serverMap = new Map<string, McpServerConfig>();

  // Global MCP config (lowest priority)
  const globalPath = join(home, '.agentforge', 'mcp.jsonc');
  await loadMcpFile(globalPath, loader, fs, serverMap);

  // Project MCP config (overrides global)
  const projectPath = join(cwd, '.agentforge', 'mcp.jsonc');
  await loadMcpFile(projectPath, loader, fs, serverMap);

  return [...serverMap.values()];
}

async function loadMcpFile(
  path: string,
  loader: ConfigLoader,
  fs: McpFileSystem,
  serverMap: Map<string, McpServerConfig>,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(path);
  } catch {
    return; // File doesn't exist — skip silently
  }

  const raw = loader.parseJsonc(content);
  const mcpServers = raw.mcpServers as Record<string, Omit<McpServerConfig, 'name'>> | undefined;
  if (!mcpServers || typeof mcpServers !== 'object') return;

  for (const [name, config] of Object.entries(mcpServers)) {
    serverMap.set(name, { name, ...config } as McpServerConfig);
  }
}
