/**
 * Tool Agent - Entry Point
 *
 * An agent with custom tools for filesystem access.
 * Demonstrates tool calling with Zod-validated parameters.
 */

import 'dotenv/config';
import { createAgent } from 'agentforge';
import config from '../agentforge.config.js';

// Create the agent with tools
const agent = createAgent(config);

async function main(): Promise<void> {
  console.log('🛠️  Tool Agent started with filesystem tools.\n');

  // Example: Ask the agent to list and read files
  const result = await agent.run(
    'List the files in the current directory, then read package.json and tell me what this project is about.'
  );

  console.log('\n📋 Agent output:', result);
}

main().catch(console.error);