import { z } from 'zod';
import type { Processor, ProcessorContext } from '@primo-ai/sdk';
import { HarnessDecisionRecorder, CircuitBreaker, type CircuitBreakerConfig } from '@primo-ai/core';

const CircuitBreakerConfigSchema = z.object({
  failureThreshold: z.number().int().min(0).optional(),
  resetTimeout: z.number().int().positive().optional(),
  halfOpenMaxRequests: z.number().int().positive().optional(),
});

export type { CircuitBreakerConfig };

export function createCircuitBreakerProcessor(config: CircuitBreakerConfig = {}): Processor {
  CircuitBreakerConfigSchema.parse(config);
  const breaker = new CircuitBreaker(config);

  return {
    stage: 'gateLLM',
    priority: 85,
    execute: async (pCtx: ProcessorContext) => {
      if (!breaker.checkBeforeCall()) {
        HarnessDecisionRecorder.record(pCtx.state, {
          processor: 'circuit-breaker',
          stage: 'gateLLM',
          decision: 'block',
          reason: `Circuit breaker is ${breaker.state}`,
          timestamp: new Date().toISOString(),
        });
        pCtx.control.abort(`Circuit breaker is ${breaker.state}`, 'gateLLM');
      }
    },
  };
}

export function createCircuitBreakerProcessorWithBreaker(breaker: CircuitBreaker): Processor {
  return {
    stage: 'gateLLM',
    priority: 85,
    execute: async (pCtx: ProcessorContext) => {
      if (!breaker.checkBeforeCall()) {
        HarnessDecisionRecorder.record(pCtx.state, {
          processor: 'circuit-breaker',
          stage: 'gateLLM',
          decision: 'block',
          reason: `Circuit breaker is ${breaker.state}`,
          timestamp: new Date().toISOString(),
        });
        pCtx.control.abort(`Circuit breaker is ${breaker.state}`, 'gateLLM');
      }
    },
  };
}
