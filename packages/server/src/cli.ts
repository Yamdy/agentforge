import { AgentForgeServer } from './server.js';
import { loadAndRegister } from './config-loader.js';
import { existsSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { AgentRegistry } from './registry.js';
import { resolveConfigSources, type DiscoveryOptions } from './discovery.js';
import type { StudioObservability } from './studio/observability.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export function getVersion(): string {
  return '0.0.1';
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export function formatHelp(): string {
  return `AgentForge CLI v${getVersion()}

Usage:
  agentforge <command> [options]

Commands:
  serve    Start the AgentForge HTTP server
  run      Run a single agent invocation
  dev      Start server with file watching and auto-reload

Global Options:
  --help, -h        Show this help message
  --version, -v     Show version number

Serve Options:
  --port <number>                Server port (default: 3000)
  --api-key <string>             API key for authentication
  --config <path>                Config file path (default: .agentforge/config.jsonc)
  --profile <name>               Apply built-in profile to all agents
  --no-agents-convention         Disable .agents/ directory scanning
  --no-agentforge-convention     Disable .agentforge/ directory scanning
  --skill-dir <path>             Additional skill directory (repeatable)
  --verbose                      Enable verbose logging
  --quiet                        Suppress all output except errors

Run Options:
  --agent <id>                   Agent ID to run (required)
  --input <text>                 Input text for the agent (required)
  --config <path>                Config file path
  --profile <name>               Apply built-in profile to all agents
  --no-agents-convention         Disable .agents/ directory scanning
  --no-agentforge-convention     Disable .agentforge/ directory scanning
  --skill-dir <path>             Additional skill directory (repeatable)

Dev Options:
  --port <number>     Server port
  --api-key <string>  API key for authentication
  --config <path>     Config file path
  --profile <name>    Apply built-in profile to all agents
  --verbose           Enable verbose logging
  --quiet             Suppress all output except errors
`;
}

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

type CliCommand =
  | { command: 'serve'; port?: number; apiKey?: string; config?: string; profile?: string; verbose?: boolean; quiet?: boolean; studio?: boolean; agentsConvention?: false; agentforgeConvention?: false; skillDirs?: string[] }
  | { command: 'run'; agent: string; input: string; config?: string; profile?: string; verbose?: boolean; quiet?: boolean; agentsConvention?: false; agentforgeConvention?: false; skillDirs?: string[] }
  | { command: 'dev'; config?: string; apiKey?: string; port?: number; profile?: string; verbose?: boolean; quiet?: boolean; agentsConvention?: false; agentforgeConvention?: false; skillDirs?: string[] }
  | { command: 'help' }
  | { command: 'version' }
  | { command: null };

export function parseCommand(args: string[]): CliCommand {
  // Handle global flags first
  if (args.length === 0) return { command: null };
  if (args[0] === '--help' || args[0] === '-h') return { command: 'help' };
  if (args[0] === '--version' || args[0] === '-v') return { command: 'version' };

  const first = args[0];
  if (first !== 'serve' && first !== 'run' && first !== 'dev') {
    return { command: null };
  }

  const flags: Record<string, string | boolean | string[] | undefined> = {};
  const skillDirs: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--verbose') {
      flags.verbose = true;
    } else if (args[i] === '--quiet') {
      flags.quiet = true;
    } else if (args[i] === '--no-agents-convention') {
      flags.agentsConvention = false;
    } else if (args[i] === '--no-agentforge-convention') {
      flags.agentforgeConvention = false;
    } else if (args[i] === '--studio') {
      flags.studio = true;
    } else if (args[i] === '--skill-dir' && args[i + 1]) {
      skillDirs.push(args[++i]);
    } else if (args[i].startsWith('--') && args[i + 1]) {
      flags[args[i].slice(2)] = args[++i];
    }
  }
  if (skillDirs.length > 0) flags.skillDirs = skillDirs;

  switch (first) {
    case 'serve':
      return {
        command: 'serve',
        port: flags.port ? parseInt(flags.port as string, 10) : undefined,
        apiKey: flags['api-key'] as string | undefined,
        config: flags.config as string | undefined,
        profile: flags.profile as string | undefined,
        verbose: flags.verbose as boolean | undefined,
        quiet: flags.quiet as boolean | undefined,
        studio: flags.studio as boolean | undefined,
        ...(flags.agentsConvention === false ? { agentsConvention: false } : {}),
        ...(flags.agentforgeConvention === false ? { agentforgeConvention: false } : {}),
        ...(flags.skillDirs ? { skillDirs: flags.skillDirs as string[] } : {}),
      };
    case 'run':
      return {
        command: 'run',
        agent: (flags.agent as string) ?? '',
        input: (flags.input as string) ?? '',
        config: flags.config as string | undefined,
        profile: flags.profile as string | undefined,
        verbose: flags.verbose as boolean | undefined,
        quiet: flags.quiet as boolean | undefined,
        ...(flags.agentsConvention === false ? { agentsConvention: false } : {}),
        ...(flags.agentforgeConvention === false ? { agentforgeConvention: false } : {}),
        ...(flags.skillDirs ? { skillDirs: flags.skillDirs as string[] } : {}),
      };
    case 'dev':
      return {
        command: 'dev',
        config: flags.config as string | undefined,
        apiKey: flags['api-key'] as string | undefined,
        port: flags.port ? parseInt(flags.port as string, 10) : undefined,
        profile: flags.profile as string | undefined,
        verbose: flags.verbose as boolean | undefined,
        quiet: flags.quiet as boolean | undefined,
        ...(flags.agentsConvention === false ? { agentsConvention: false } : {}),
        ...(flags.agentforgeConvention === false ? { agentforgeConvention: false } : {}),
        ...(flags.skillDirs ? { skillDirs: flags.skillDirs as string[] } : {}),
      };
  }
}

// ---------------------------------------------------------------------------
// run subcommand: single-shot agent execution
// ---------------------------------------------------------------------------

export async function runSingleShot(registry: AgentRegistry, agentId: string, input: string) {
  const agent = registry.get(agentId);
  if (!agent) throw new Error(`Agent not found: "${agentId}". Available: ${registry.list().map(a => a.id).join(', ')}`);
  return agent.run(input);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export async function handleServe(opts: Extract<CliCommand, { command: 'serve' }>) {
  const cwd = process.cwd();
  const home = homedir();
  const configSources = resolveConfigSources(cwd, home, opts.config);
  const configPath = configSources.project ?? '.agentforge/config.jsonc';

  // Create StudioObservability before server if --studio is enabled
  let observability: StudioObservability | undefined;
  if (opts.studio) {
    const { StudioObservability } = await import('./studio/observability.js');
    observability = new StudioObservability();
  }

  const server = new AgentForgeServer({ port: opts.port, apiKey: opts.apiKey, studio: observability });

  if (existsSync(resolve(configPath))) {
    const discoveryOpts: DiscoveryOptions = {
      agentsConvention: opts.agentsConvention === false ? false : undefined,
      agentforgeConvention: opts.agentforgeConvention === false ? false : undefined,
      extraSkillDirs: opts.skillDirs,
    };
    const { agentIds } = await loadAndRegister(configSources, server.registry, opts.profile, discoveryOpts, observability);
    console.log(`Loaded ${agentIds.length} agent(s): ${agentIds.join(', ')}`);
  } else {
    console.warn(`Config not found at ${configPath}, starting with empty registry`);
  }

  const handle = await server.start();
  console.log(`AgentForge server listening on port ${handle.port}`);

  const shutdown = async () => {
    console.log('\nShutting down...');
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export async function handleRun(opts: Extract<CliCommand, { command: 'run' }>) {
  const cwd = process.cwd();
  const home = homedir();
  const configSources = resolveConfigSources(cwd, home, opts.config);
  const configPath = configSources.project ?? '.agentforge/config.jsonc';
  const registry = new AgentRegistry();

  if (!existsSync(resolve(configPath))) {
    throw new Error(`Config not found at ${configPath}`);
  }

  const discoveryOpts: DiscoveryOptions = {
    agentsConvention: opts.agentsConvention === false ? false : undefined,
    agentforgeConvention: opts.agentforgeConvention === false ? false : undefined,
    extraSkillDirs: opts.skillDirs,
  };
  await loadAndRegister(configSources, registry, opts.profile, discoveryOpts);
  const result = await runSingleShot(registry, opts.agent, opts.input);
  console.log(JSON.stringify(result, null, 2));
}

export async function handleDev(opts: Extract<CliCommand, { command: 'dev' }>) {
  const cwd = process.cwd();
  const home = homedir();
  const configSources = resolveConfigSources(cwd, home, opts.config);
  const configPath = resolve(configSources.project ?? '.agentforge/config.jsonc');
  const server = new AgentForgeServer({ port: opts.port, apiKey: opts.apiKey });

  const discoveryOpts: DiscoveryOptions = {
    agentsConvention: opts.agentsConvention === false ? false : undefined,
    agentforgeConvention: opts.agentforgeConvention === false ? false : undefined,
    extraSkillDirs: opts.skillDirs,
  };

  const loadConfig = async () => {
    server.registry.clear();
    if (existsSync(configPath)) {
      const { agentIds } = await loadAndRegister(configSources, server.registry, opts.profile, discoveryOpts);
      console.log(`[dev] Loaded ${agentIds.length} agent(s): ${agentIds.join(', ')}`);
    } else {
      console.warn(`[dev] Config not found at ${configPath}`);
    }
  };

  await loadConfig();
  const handle = await server.start();
  console.log(`[dev] AgentForge server listening on port ${handle.port}`);
  console.log(`[dev] Watching ${configPath} for changes...`);

  let reloadTimeout: ReturnType<typeof setTimeout> | undefined;
  watch(configPath, () => {
    clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(loadConfig, 300);
  });

  const shutdown = async () => {
    console.log('\n[dev] Shutting down...');
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
