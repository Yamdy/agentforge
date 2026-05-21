import { z } from 'zod';
import type { Processor, ProcessorContext, PipelineContext } from '@primo-ai/sdk';
import { HarnessDecisionRecorder } from '@primo-ai/core';

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
  /** What to do when the limit is exceeded: block (abort) or queue (delay). */
  strategy: 'block' | 'queue';
  /** Apply rate limits independently per model. Defaults to false. */
  perModel?: boolean;
}

interface WindowEntry {
  timestamp: number;
}

/**
 * Create a rate-limiting processor for the gateLLM stage.
 *
 * Uses a sliding-window algorithm: each request records a timestamp,
 * and timestamps older than `windowMs` are pruned on each call.
 * If the number of timestamps within the window exceeds `maxRequests`,
 * the configured strategy is applied.
 */
const RateLimitConfigSchema = z.object({
  maxRequests: z.number().int().positive(),
  windowMs: z.number().int().positive(),
  strategy: z.enum(['block', 'queue']),
  perModel: z.boolean().optional(),
});

export function createRateLimitProcessor(config: RateLimitConfig): Processor {
  RateLimitConfigSchema.parse(config);
  // Keyed by model name when perModel is true, otherwise single key "*"
  const windows = new Map<string, WindowEntry[]>();

  function getKey(ctx: PipelineContext): string {
    if (config.perModel) {
      return ctx.agent.config.model ?? '*';
    }
    return '*';
  }

  function pruneOld(key: string, now: number): void {
    const entries = windows.get(key);
    if (!entries) return;
    const cutoff = now - config.windowMs;
    while (entries.length > 0 && entries[0]!.timestamp <= cutoff) {
      entries.shift();
    }
  }

  return {
    stage: 'gateLLM',
    priority: 80,
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const now = Date.now();
      const key = getKey(ctx);

      // Ensure window exists
      if (!windows.has(key)) {
        windows.set(key, []);
      }

      // Prune expired entries
      pruneOld(key, now);

      const entries = windows.get(key)!;

      // Check limit
      if (entries.length >= config.maxRequests) {
        if (config.strategy === 'queue') {
          HarnessDecisionRecorder.record(ctx, {
            processor: 'rate-limit',
            stage: 'gateLLM',
            decision: 'queue',
            reason: `Rate limited: ${entries.length}/${config.maxRequests}`,
            timestamp: new Date().toISOString(),
          });
          ctx.session.custom = {
            ...ctx.session.custom,
            rateLimitQueued: true,
            rateLimitKey: key,
            rateLimitCurrentCount: entries.length,
            rateLimitMax: config.maxRequests,
          };
          return;
        }

        // block
        HarnessDecisionRecorder.record(ctx, {
          processor: 'rate-limit',
          stage: 'gateLLM',
          decision: 'block',
          reason: `Rate limit exceeded: ${entries.length}/${config.maxRequests}`,
          timestamp: new Date().toISOString(),
        });
        pCtx.control.abort(`Rate limit exceeded for ${key}: ${entries.length}/${config.maxRequests} requests in the last ${config.windowMs}ms`);
        return;
      }

      // Record this request
      entries.push({ timestamp: now });
    },
  };
}
