/**
 * Metrics Plugin - Production-grade metrics collection
 *
 * An ObserverPlugin that collects key metrics from agent execution:
 * - Token usage (prompt + completion)
 * - Tool execution counts
 * - Step counts and total duration
 * - Error counts
 *
 * Design:
 * - Non-blocking (ObserverPlugin uses tap)
 * - Silent failures (try-catch, never throws)
 * - Uses Metrics interface for observability
 *
 * @module
 */

import type { ObserverPlugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';

/**
 * Metrics Plugin
 *
 * Collects metrics from agent execution events.
 * Priority 20 (early in observer chain).
 */
export const metricsPlugin: ObserverPlugin = {
  name: 'metrics',
  type: 'observer',
  priority: 20,
  eventTypes: ['llm.response', 'tool.result', 'agent.complete', 'agent.error'],
  enabled: true,

  observe(event: AgentEvent, ctx: PluginContext): void {
    // Silent failure - never throw
    try {
      // Skip if no metrics collector available
      if (!ctx.metrics) {
        return;
      }

      const metrics = ctx.metrics;

      switch (event.type) {
        case 'llm.response': {
          // Record token usage if available
          if (event.usage) {
            metrics.increment('llm.tokens.prompt', event.usage.promptTokens, {
              agent: ctx.agentName,
            });
            metrics.increment('llm.tokens.completion', event.usage.completionTokens, {
              agent: ctx.agentName,
            });
          }
          break;
        }

        case 'tool.result': {
          // Record tool execution
          metrics.increment('tool.executions', 1, {
            agent: ctx.agentName,
            tool: event.toolName,
            isError: event.isError ? 'true' : 'false',
          });
          break;
        }

        case 'agent.complete': {
          // Record completion metrics
          metrics.histogram('agent.steps', event.steps, {
            agent: ctx.agentName,
          });

          // Record token totals if available
          if (event.tokens) {
            metrics.gauge('agent.tokens.input', event.tokens.input, {
              agent: ctx.agentName,
            });
            metrics.gauge('agent.tokens.output', event.tokens.output, {
              agent: ctx.agentName,
            });
          }
          break;
        }

        case 'agent.error': {
          // Record error
          metrics.increment('agent.errors', 1, {
            agent: ctx.agentName,
            errorName: event.error.name,
          });
          break;
        }
      }
    } catch {
      // Silent failure - do nothing
      // Observer plugins must never throw or block the main flow
    }
  },
};
