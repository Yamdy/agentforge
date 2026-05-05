/**
 * Tests for built-in checkpoint plugins.
 */

import { describe, it, expect } from 'vitest';
import {
  createQuotaPlugin,
  createRateLimitPlugin,
  createQualityGatePlugin,
  createCircuitBreakerPlugin,
} from '../../src/plugins/builtin-checkpoints.js';

describe('Built-in Checkpoint Plugins', () => {
  describe('createQuotaPlugin', () => {
    it('has correct identity', () => {
      const plugin = createQuotaPlugin();
      expect(plugin.name).toBe('builtin:quota');
      expect(plugin.enabled).toBe(true);
    });

    it('registers one checkpoint hook at pre-llm priority 10', () => {
      const plugin = createQuotaPlugin();
      expect(plugin.checkpointHooks).toHaveLength(1);
      expect(plugin.checkpointHooks![0]!.phase).toBe('pre-llm');
      expect(plugin.checkpointHooks![0]!.priority).toBe(10);
    });

    it('continues when no quota is configured', async () => {
      const plugin = createQuotaPlugin();
      const result = await plugin.checkpointHooks![0]!.check(
        { quota: undefined, sessionId: 'test' },
        {}
      );
      expect(result).toEqual({ action: 'continue' });
    });

    it('blocks when quota is exceeded', async () => {
      const plugin = createQuotaPlugin();
      const ctx = {
        sessionId: 'test',
        quota: {
          getUsage: () => ({ promptTokens: 9000, completionTokens: 0 }),
          check: async () => false,
        },
      };
      const result = await plugin.checkpointHooks![0]!.check(ctx, {});
      expect(result).toEqual({ action: 'block', reason: 'quota_exceeded' });
    });

    it('continues when quota allows', async () => {
      const plugin = createQuotaPlugin();
      const ctx = {
        sessionId: 'test',
        quota: {
          getUsage: () => ({ promptTokens: 100, completionTokens: 0 }),
          check: async () => true,
        },
      };
      const result = await plugin.checkpointHooks![0]!.check(ctx, {});
      expect(result).toEqual({ action: 'continue' });
    });
  });

  describe('createRateLimitPlugin', () => {
    it('has correct identity', () => {
      const plugin = createRateLimitPlugin();
      expect(plugin.name).toBe('builtin:rate-limit');
      expect(plugin.checkpointHooks![0]!.phase).toBe('pre-llm');
      expect(plugin.checkpointHooks![0]!.priority).toBe(20);
    });

    it('continues when no rate limiter is configured', async () => {
      const plugin = createRateLimitPlugin();
      const result = await plugin.checkpointHooks![0]!.check(
        { rateLimiter: undefined, sessionId: 'test' },
        {}
      );
      expect(result).toEqual({ action: 'continue' });
    });

    it('blocks when rate limit is exceeded', async () => {
      const plugin = createRateLimitPlugin();
      const ctx = {
        sessionId: 'test',
        rateLimiter: {
          check: () => false,
          consume: () => {},
        },
      };
      const result = await plugin.checkpointHooks![0]!.check(ctx, {});
      expect(result).toEqual({ action: 'block', reason: 'rate_limit_exceeded' });
    });
  });

  describe('createQualityGatePlugin', () => {
    it('has correct identity', () => {
      const plugin = createQualityGatePlugin();
      expect(plugin.name).toBe('builtin:quality-gate');
      expect(plugin.checkpointHooks![0]!.phase).toBe('post-llm');
      expect(plugin.checkpointHooks![0]!.priority).toBe(10);
    });

    it('continues when no quality gate is configured', async () => {
      const plugin = createQualityGatePlugin();
      const result = await plugin.checkpointHooks![0]!.check(
        { qualityGate: undefined },
        { messages: [], step: 0 }
      );
      expect(result).toEqual({ action: 'continue' });
    });

    it('continues when response has no content', async () => {
      const plugin = createQualityGatePlugin();
      const ctx = {
        qualityGate: { check: () => ({ passed: true }) },
      };
      const result = await plugin.checkpointHooks![0]!.check(
        ctx,
        { messages: [], step: 0 },
        { toolCalls: [{ id: '1', name: 'read', args: {} }] }
      );
      expect(result).toEqual({ action: 'continue' });
    });

    it('blocks and injects retry message when quality gate fails', async () => {
      const plugin = createQualityGatePlugin();
      const ctx = {
        qualityGate: {
          check: () => ({ passed: false, feedback: 'Too vague.' }),
        },
      };
      const state = { messages: [{ role: 'user', content: 'hello' }], step: 5 };
      const response = { content: 'OK' };
      const result = await plugin.checkpointHooks![0]!.check(ctx, state, response);
      expect(result).toEqual({ action: 'block', reason: 'quality_gate_retry' });
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]!.content).toContain('Too vague.');
      expect(state.step).toBe(6);
    });
  });

  describe('createCircuitBreakerPlugin', () => {
    it('has correct identity', () => {
      const plugin = createCircuitBreakerPlugin();
      expect(plugin.name).toBe('builtin:circuit-breaker');
      expect(plugin.checkpointHooks![0]!.phase).toBe('post-llm');
      expect(plugin.checkpointHooks![0]!.priority).toBe(20);
    });

    it('records success and continues', async () => {
      let called = false;
      const plugin = createCircuitBreakerPlugin();
      const ctx = {
        circuitBreaker: { recordSuccess: () => { called = true; } },
      };
      const result = await plugin.checkpointHooks![0]!.check(ctx, {});
      expect(result).toEqual({ action: 'continue' });
      expect(called).toBe(true);
    });

    it('does not crash when circuit breaker is not configured', async () => {
      const plugin = createCircuitBreakerPlugin();
      const result = await plugin.checkpointHooks![0]!.check(
        { circuitBreaker: undefined },
        {}
      );
      expect(result).toEqual({ action: 'continue' });
    });
  });
});
