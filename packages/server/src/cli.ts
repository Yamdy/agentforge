import { AgentForgeServer } from './server.js';
import { loadAndRegister } from './config-loader.js';
import { existsSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import { AgentRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

type CliCommand =
  | { command: 'serve'; port?: number; apiKey?: string; config?: string }
  | { command: 'run'; agent: string; input: string; config?: string }
  | { command: 'dev'; config?: string; apiKey?: string; port?: number }
  | { command: null };

export function parseCommand(args: string[]): CliCommand {
  const first = args[0];
  if (first !== 'serve' && first !== 'run' && first !== 'dev') {
    return { command: null };
  }

  const flags: Record<string, string | undefined> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1]) {
      flags[args[i].slice(2)] = args[++i];
    }
  }

  switch (first) {
    case 'serve':
      return {
        command: 'serve',
        port: flags.port ? parseInt(flags.port, 10) : undefined,
        apiKey: flags['api-key'],
        config: flags.config,
      };
    case 'run':
      return {
        command: 'run',
        agent: flags.agent ?? '',
        input: flags.input ?? '',
        config: flags.config,
      };
    case 'dev':
      return {
        command: 'dev',
        config: flags.config,
        apiKey: flags['api-key'],
        port: flags.port ? parseInt(flags.port, 10) : undefined,
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
  const configPath = opts.config ?? '.agentforge/config.jsonc';
  const server = new AgentForgeServer({ port: opts.port, apiKey: opts.apiKey });

  if (existsSync(resolve(configPath))) {
    const { agentIds } = await loadAndRegister(configPath, server.registry);
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
  const configPath = opts.config ?? '.agentforge/config.jsonc';
  const registry = new AgentRegistry();

  if (!existsSync(resolve(configPath))) {
    throw new Error(`Config not found at ${configPath}`);
  }

  await loadAndRegister(configPath, registry);
  const result = await runSingleShot(registry, opts.agent, opts.input);
  console.log(JSON.stringify(result, null, 2));
}

export async function handleDev(opts: Extract<CliCommand, { command: 'dev' }>) {
  const configPath = resolve(opts.config ?? '.agentforge/config.jsonc');
  const server = new AgentForgeServer({ port: opts.port, apiKey: opts.apiKey });

  const loadConfig = async () => {
    server.registry.clear();
    if (existsSync(configPath)) {
      const { agentIds } = await loadAndRegister(configPath, server.registry);
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
