/**
 * Production Agent - Entry Point
 *
 * A production-ready agent using the L3 API with event-driven control,
 * observability, resilience, and security layers.
 */

import 'dotenv/config';
import { runAgent, AgentContextBuilder } from 'agentforge/api';
import type { AgentEvent } from 'agentforge/api';
import config from '../agentforge.config.js';
import { logger } from './observability/index.js';
import { resilienceConfig } from './resilience/config.js';

// Build context from config with production modules
const ctx = AgentContextBuilder.create()
  .with({
    llm: config.llm,
    tools: config.tools,
  })
  .build();

async function main(): Promise<void> {
  logger.info('Production Agent starting...');
  logger.info(`Resilience config: ${JSON.stringify(resilienceConfig)}`);

  // Handle graceful shutdown
  const shutdown = (): void => {
    logger.info('Received shutdown signal, cleaning up...');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Run with full production pipeline using L3 API
  const agent = runAgent(ctx, 'Analyze the current project structure and provide recommendations.', {
    maxSteps: 30,
  });

  // Observe agent events
  agent.onAny((event: AgentEvent) => {
    if (event.type === 'agent.step') return; // skip noisy step events
    if (event.type === 'agent.error') {
      logger.error(`Agent error: ${JSON.stringify(event)}`);
      return;
    }
    logger.info(`Event: ${event.type}`);
  });

  // Set up timeout guard
  const timeoutId = setTimeout(() => {
    logger.warn(`Timeout after ${resilienceConfig.timeoutMs}ms, cancelling agent`);
    agent.cancel();
  }, resilienceConfig.timeoutMs);

  try {
    const result = await agent.run('Analyze the current project structure and provide recommendations.');
    clearTimeout(timeoutId);
    logger.info('Agent execution completed');
    logger.info(`Result: ${result}`);
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

main();
