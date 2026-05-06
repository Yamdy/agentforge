/**
 * Metrics Plugin - Production-grade metrics collection
 *
 * A Plugin that collects key metrics from agent execution:
 * - Token usage (prompt + completion)
 * - Tool execution counts
 * - Step counts and total duration
 * - Error counts
 *
 * Design:
 * - Non-blocking (uses eventSubscriptions which are fire-and-forget)
 * - Silent failures (try-catch, never throws)
 * - Uses Metrics interface for observability
 *
 * @module
 */

import type { Plugin, PluginContext } from './plugin.js';
import type { AgentEvent, AgentEventType } from '../core/events.js';
import type { Metrics } from '../core/interfaces.js';

/**
 * Per-session metrics collector and agent name, captured via init().
 */
let _metrics: Metrics | undefined;
let _agentName = '';

/**
 * Metrics Plugin
 *
 * Collects metrics from agent execution events.
 */
export const metricsPlugin: Plugin = {
  name: 'metrics',
  enabled: true,

  init(ctx: PluginContext): void {
    _metrics = ctx.metrics;
    _agentName = ctx.agentName;
  },

  eventSubscriptions: (
    [
      'llm.response',
      'llm.first_token',
      'tool.result',
      'agent.complete',
      'agent.error',
      'evaluation.complete',
    ] satisfies AgentEventType[]
  ).map(evt => ({
    event: evt,
    handler(event: AgentEvent): void {
      // Silent failure - never throw
      try {
        // Skip if no metrics collector available
        if (!_metrics) {
          return;
        }

        const metrics = _metrics;

        switch (event.type) {
          case 'llm.response': {
            // Record token usage if available
            if (event.usage) {
              metrics.increment('llm.tokens.prompt', event.usage.promptTokens, {
                agent: _agentName,
              });
              metrics.increment('llm.tokens.completion', event.usage.completionTokens, {
                agent: _agentName,
              });
              if (event.usage.cacheReadTokens !== undefined) {
                metrics.increment('llm.tokens.cache_read', event.usage.cacheReadTokens, {
                  agent: _agentName,
                });
              }
              if (event.usage.cacheWriteTokens !== undefined) {
                metrics.increment('llm.tokens.cache_write', event.usage.cacheWriteTokens, {
                  agent: _agentName,
                });
              }
            }
            // Record TTFT if available
            if (event.ttftMs !== undefined) {
              metrics.histogram('llm.ttft_ms', event.ttftMs, {
                agent: _agentName,
              });
            }
            break;
          }

          case 'llm.first_token': {
            metrics.histogram('llm.ttft_ms', event.ttftMs, {
              agent: _agentName,
            });
            break;
          }

          case 'tool.result': {
            // Record tool execution
            metrics.increment('tool.executions', 1, {
              agent: _agentName,
              tool: event.toolName,
              isError: event.isError ? 'true' : 'false',
            });
            break;
          }

          case 'agent.complete': {
            // Record completion metrics
            metrics.histogram('agent.steps', event.steps, {
              agent: _agentName,
            });

            // Record token totals if available
            if (event.tokens) {
              metrics.gauge('agent.tokens.input', event.tokens.input, {
                agent: _agentName,
              });
              metrics.gauge('agent.tokens.output', event.tokens.output, {
                agent: _agentName,
              });
            }
            break;
          }

          case 'agent.error': {
            // Record error
            metrics.increment('agent.errors', 1, {
              agent: _agentName,
              errorName: event.error.name,
            });
            break;
          }

          case 'evaluation.complete': {
            metrics.histogram('evaluation.score', event.compositeScore, {
              agent: _agentName,
              runId: event.runId,
            });
            break;
          }
        }
      } catch {
        // Silent failure - do nothing
        // Plugins must never throw or block the main flow
      }
    },
  })),
};
