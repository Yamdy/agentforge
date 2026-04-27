#!/usr/bin/env node

/**
 * CLI entry point for AgentForge Server.
 *
 * Usage:
 *   npx @primo512109/agentforge-server --port 3000 --config-dir ./agents
 *   node dist/cli.js --port 3000 --config-dir ./agents
 */

import { resolve } from 'node:path';
import { createAgentForgeServer } from './server.js';

const args = process.argv.slice(2);

interface ServerOptions {
  port: number;
  configDir: string;
}

function parseArgs(args: string[]): ServerOptions {
  const options: ServerOptions = {
    port: 3000,
    configDir: './agents',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const next = args[i + 1];
      if (next) {
        options.port = parseInt(next, 10);
        i++;
      }
    } else if (arg === '--config-dir' || arg === '-c') {
      const next = args[i + 1];
      if (next) {
        options.configDir = next;
        i++;
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
AgentForge Server - HTTP/SSE server for AgentForge Studio

Usage:
  agentforge-server [options]

Options:
  -p, --port <port>         Port to listen on (default: 3000)
  -c, --config-dir <dir>    Agent config directory (default: ./agents)
  -h, --help                Show this help message

Examples:
  agentforge-server --port 8080 --config-dir ./my-agents
  agentforge-server -p 3000
`);
      process.exit(0);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(args);
  const configDir = resolve(options.configDir);

  console.log(`🚀 Starting AgentForge Server`);
  console.log(`   Config directory: ${configDir}`);
  console.log(`   Port: ${options.port}`);

  const { server, start } = createAgentForgeServer({
    port: options.port,
    configDir,
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await start();
    console.log(`✅ AgentForge Server running at http://localhost:${options.port}`);
    console.log(`   Playground: http://localhost:${options.port}/playground`);
    console.log(`   Health check: http://localhost:${options.port}/health`);
    console.log(`   Press Ctrl+C to stop.`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();