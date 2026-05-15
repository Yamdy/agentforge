#!/usr/bin/env node
import { AgentForgeServer } from './server.js';
import { loadAndRegister } from './config-loader.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface CliOptions {
  port?: number;
  apiKey?: string;
  config?: string;
}

function parseArgs(args: string[]): CliOptions {
  const result: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      result.port = parseInt(args[++i], 10);
    } else if (args[i] === '--api-key' && args[i + 1]) {
      result.apiKey = args[++i];
    } else if (args[i] === '--config' && args[i + 1]) {
      result.config = args[++i];
    }
  }
  return result;
}

const command = process.argv[2];
if (command !== 'serve') {
  console.error('Usage: agentforge serve [--port 3000] [--config .agentforge/config.jsonc] [--api-key xxx]');
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(3));
const configPath = opts.config ?? '.agentforge/config.jsonc';

async function main() {
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

main().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
