/**
 * SessionLifecyclePlugin — Emits session boundary events with correlation context.
 *
 * Subscribes to agent.start → emits session.start (carrying correlation context)
 * Subscribes to agent.complete → accumulates stats
 * Subscribes to done → emits session.end (carrying summary statistics)
 *
 * @module plugins/session-lifecycle-plugin
 */

import type { Plugin, PluginContext } from './plugin.js';
import type { AgentEvent, AgentEventEmitter } from '../core/events.js';
import {
  runWithCorrelation,
  type CorrelationContext,
} from '../observability/correlation/correlation-context.js';

// ============================================================
// Types
// ============================================================

export interface SessionLifecyclePluginOptions {
  /** User identifier for correlation */
  userId?: string;
  /** Organization identifier for correlation */
  orgId?: string;
  /** Environment name (e.g., 'production', 'staging') */
  environment?: string;
}

// ============================================================
// Implementation
// ============================================================

export function createSessionLifecyclePlugin(options: SessionLifecyclePluginOptions = {}): Plugin {
  const { userId, orgId, environment } = options;

  let emitter: AgentEventEmitter | undefined;

  // Accumulated stats per session
  const sessionStats = new Map<
    string,
    {
      agentName: string;
      steps: number;
      tokensInput: number;
      tokensOutput: number;
      startTime: number;
    }
  >();

  return {
    name: 'session-lifecycle',
    enabled: true,

    init(ctx: PluginContext): void {
      emitter = ctx.emitter;
    },

    destroy(): void {
      sessionStats.clear();
      emitter = undefined;
    },

    eventSubscriptions: [
      { event: 'agent.start', handler: handleAgentStart },
      { event: 'agent.complete', handler: handleAgentComplete },
      { event: 'done', handler: handleDone },
    ],
  };

  function handleAgentStart(event: AgentEvent): void {
    if (event.type !== 'agent.start') return;

    // Initialize session stats
    sessionStats.set(event.sessionId, {
      agentName: event.agentName,
      steps: 0,
      tokensInput: 0,
      tokensOutput: 0,
      startTime: event.timestamp,
    });

    // Build correlation context
    const corr: CorrelationContext = {
      sessionId: event.sessionId,
      ...(userId !== undefined ? { userId } : {}),
      ...(orgId !== undefined ? { orgId } : {}),
      ...(environment !== undefined ? { environment } : {}),
    };

    // Emit session.start within correlation scope.
    // Capture emitter before async gap — destroy() may set it to undefined.
    const capturedEmitter = emitter;
    runWithCorrelation(corr, async () => {
      if (capturedEmitter) {
        await capturedEmitter.emit({
          type: 'session.start',
          timestamp: Date.now(),
          sessionId: event.sessionId,
          agentName: event.agentName,
          model: event.model,
          correlation: {
            userId: corr.userId,
            orgId: corr.orgId,
            environment: corr.environment,
          },
        });
      }
    }).catch(() => {
      // Silent — correlation injection failures are non-blocking
    });
  }

  function handleAgentComplete(event: AgentEvent): void {
    if (event.type !== 'agent.complete') return;

    const stats = sessionStats.get(event.sessionId);
    if (stats) {
      stats.steps = event.steps;
      if (event.tokens) {
        stats.tokensInput = event.tokens.input;
        stats.tokensOutput = event.tokens.output;
      }
    }
  }

  function handleDone(event: AgentEvent): void {
    if (event.type !== 'done') return;

    const stats = sessionStats.get(event.sessionId);
    if (!stats) return;

    // Emit session.end with accumulated stats
    if (emitter) {
      emitter
        .emit({
          type: 'session.end',
          timestamp: Date.now(),
          sessionId: event.sessionId,
          reason: event.reason,
          summary: {
            steps: stats.steps,
            tokens: {
              input: stats.tokensInput,
              output: stats.tokensOutput,
            },
            duration: Date.now() - stats.startTime,
          },
        })
        .catch(() => {
          // Silent — emission failures are non-blocking
        });
    }

    sessionStats.delete(event.sessionId);
  }
}
