/**
 * Multi-Agent Orchestrator - Entry Point
 *
 * Demonstrates an orchestrator agent that delegates tasks
 * to specialized worker agents (researcher, writer, reviewer).
 */

import 'dotenv/config';
import { createAgent } from 'agentforge';
import config from '../agentforge.config.js';

const agent = createAgent(config);

async function main(): Promise<void> {
  console.log('🎭 Multi-Agent Orchestrator started.\n');

  // Example: Research and write about a topic
  const result = await agent.run(
    'Research the benefits of TypeScript, write a summary article, and review it for accuracy.'
  );

  console.log('\n📝 Final output:', result);
}

main().catch(console.error);