/**
 * Production Agent - Entry Point
 *
 * A production-ready agent using the L3 API with full Observable control,
 * observability, resilience, and security layers.
 */

import 'dotenv/config';
import { runAgent, AgentContextBuilder } from 'agentforge/api';
import { filter, tap, takeUntilTerminal, timeoutOnEventType, retryOnEventType, collectMetrics } from 'agentforge';
import config from '../agentforge.config.js';
import { logger } from './observability/index.js';
import { resilienceConfig } from './resilience/config.js';

// Build context from config with production modules
const ctx = new AgentContextBuilder()
  .withLLMAdapter(config.llm)
  .withTools(config.tools)
  .build();

// Metrics collector for production monitoring
const metricsCollector = collectMetrics({
  increment: (key: string) => {
    logger.info(`Metric: ${key}`);
  },
});

async function main(): Promise<void> {
  logger.info('🏭 Production Agent starting...');
  logger.info(`Resilience config: ${JSON.stringify(resilienceConfig)}`);

  // Handle graceful shutdown (M9)
  const shutdown = (): void => {
    logger.info('Received shutdown signal, cleaning up...');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    // Run with full production pipeline using L3 API
    await new Promise<void>((resolve, reject) => {
      runAgent(ctx, 'Analyze the current project structure and provide recommendations.', {
        maxSteps: 30,
      }).pipe(
        // M8: Observability — filter out step events for cleaner logs
        filter((event: { type: string }) => event.type !== 'agent.step'),
        // M4: Resilience — timeout and retry
        timeoutOnEventType('done', resilienceConfig.timeoutMs),
        retryOnEventType('agent.error', resilienceConfig.maxRetries),
        // M8: Observability — collect metrics
        metricsCollector,
        // M8: Observability — log all events
        tap({
          next: (event: { type: string }) => {
            logger.info(`Event: ${event.type}`);
          },
          complete: () => {
            logger.info('Agent execution completed');
            resolve();
          },
          error: (err: unknown) => {
            logger.error(`Agent error: ${err}`);
            reject(err);
          },
        }),
        takeUntilTerminal(),
      ).subscribe();
    });
  } catch (error: unknown) {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

main();