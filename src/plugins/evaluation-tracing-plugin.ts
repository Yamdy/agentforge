/**
 * EvaluationTracingPlugin — Bridges evaluation results into trace spans.
 *
 * Subscribes to evaluation.complete events and adds the composite score
 * as an event on the session's root span via TraceContext query.
 *
 * If TracingPlugin is not registered (no TraceContext available),
 * this plugin is naturally a no-op.
 *
 * @module plugins/evaluation-tracing-plugin
 */

import type { Plugin, PluginContext } from './plugin.js';
import type { AgentEvent } from '../core/events.js';
import type { Tracer } from '../core/interfaces.js';
import type { TraceContext } from '../observability/trace-context.js';

// ============================================================
// Types
// ============================================================

export interface EvaluationTracingPluginOptions {
  /** TraceContext from a registered TracingPlugin */
  traceContext?: TraceContext;
}

// ============================================================
// Implementation
// ============================================================

export function createEvaluationTracingPlugin(
  options: EvaluationTracingPluginOptions = {}
): Plugin {
  const { traceContext } = options;

  let tracer: Tracer | undefined;

  return {
    name: 'evaluation-tracing',
    enabled: true,

    init(ctx: PluginContext): void {
      tracer = ctx.tracer;
    },

    destroy(): void {
      tracer = undefined;
    },

    eventSubscriptions: [{ event: 'evaluation.complete', handler: handleEvaluationComplete }],
  };

  function handleEvaluationComplete(event: AgentEvent): void {
    if (event.type !== 'evaluation.complete') return;
    if (!tracer || !traceContext) return;

    const spanId = traceContext.getRootSpanId(event.sessionId);
    if (!spanId) return;

    tracer.addEvent(spanId, 'evaluation.result', {
      'agentforge.eval.run_id': event.runId,
      'agentforge.eval.score': event.compositeScore,
      'agentforge.eval.scorers': JSON.stringify(
        event.scorers.map(s => ({ name: s.name, score: s.score, weight: s.weight }))
      ),
    });
  }
}
