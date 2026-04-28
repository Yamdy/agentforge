/**
 * MCP Agent - Entry Point
 *
 * An agent connected to MCP servers for extended tool capabilities.
 * Demonstrates dynamic tool discovery and MCP integration.
 */

import 'dotenv/config';
import { createAgent } from 'agentforge';
import config from '../agentforge.config.js';

const agent = createAgent(config);

async function main(): Promise<void> {
  console.log('🔌 MCP Agent started. Connected to MCP servers.\n');

  // Example: Use MCP-provided tools
  const result = await agent.run(
    'List the files in the current directory using the available MCP tools.'
  );

  console.log('\n📋 Agent output:', result);
}

main().catch(console.error);