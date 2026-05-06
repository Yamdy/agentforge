/**
 * Metrics Plugin — Production-grade metrics collection via event subscriptions.
 *
 * A Plugin that collects key metrics from agent execution:
 * - Token usage (prompt + completion + cache)
 * - Tool execution counts
 * - Step counts and total duration
 * - Error counts
 * - TTFT histogram
 * - Evaluation score histogram
 *
 * Design:
 * - Factory function pattern — each agent gets its own isolated instance
 * - Non-blocking (uses eventSubscriptions which are fire-and-forget)
 * - Silent failures (try-catch, never throws)
 *
 * @module
 */

import type { Plugin, PluginContext } from './plugin.js';
import type { AgentEvent, AgentEventType } from '../core/events.js';
import type { Metrics } from '../core/interfaces.js';

/**
 * Create an isolated MetricsPlugin instance.
 *
 * Uses closure-scoped state per instance — safe for multi-agent scenarios.
 */
export function createMetricsPlugin(): Plugin {
  let _metrics: Metrics | undefined;
  let _agentName = '';

  return {
    name: 'metrics',
    enabled: true,

    init(ctx: PluginContext): void {
      _metrics = ctx.metrics;
      _agentName = ctx.agentName;
    },

    destroy(): void {
      _metrics = undefined;
      _agentName = '';
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
        try {
          if (!_metrics) return;

          const metrics = _metrics;

          switch (event.type) {
            case 'llm.response': {
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
              metrics.increment('tool.executions', 1, {
                agent: _agentName,
                tool: event.toolName,
                isError: event.isError ? 'true' : 'false',
              });
              break;
            }

            case 'agent.complete': {
              metrics.histogram('agent.steps', event.steps, {
                agent: _agentName,
              });
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
          // Silent failure — plugins must never throw or block the main flow
        }
      },
    })),
  };
}
