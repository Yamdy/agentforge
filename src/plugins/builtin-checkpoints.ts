/**
 * Built-in Checkpoint Plugins
 *
 * Replaces the hardcoded CheckpointRegistry registrations in agent-loop.
 * Each plugin provides a single checkpointHook that runs at pre-llm or
 * post-llm lifecycle phases.
 *
 * These are automatically registered by createAgent when the corresponding
 * AgentContext fields are configured. Each plugin is no-op when its
 * corresponding service is not configured.
 */

import type { Plugin } from './plugin.js';
import type { CheckpointHook } from '../core/hooks.js';
import type { AgentContext } from '../core/context.js';
import type { AgentState } from '../core/state.js';

// ============================================================
// Pre-LLM Checkpoints (quota, rate-limit)
// ============================================================

/**
 * Plugin that checks quota before each LLM call.
 * Registers at pre-llm, priority 10.
 */
export function createQuotaPlugin(): Plugin {
  const check: CheckpointHook['check'] = async (ctx: unknown) => {
    const c = ctx as AgentContext;
    if (!c.controls.quota) return { action: 'continue' };
    const currentUsage = c.controls.quota.getUsage(c.identity.sessionId);
    const allowed = await c.controls.quota.check(c.identity.sessionId, {
      promptTokens: currentUsage.promptTokens,
      completionTokens: currentUsage.completionTokens,
      ...(currentUsage.totalCost !== undefined ? { totalCost: currentUsage.totalCost } : {}),
    });
    if (!allowed) {
      return { action: 'block', reason: 'quota_exceeded' };
    }
    return { action: 'continue' };
  };

  return {
    name: 'builtin:quota',
    enabled: true,
    checkpointHooks: [{ name: 'quota-check', phase: 'pre-llm', priority: 10, check }],
  };
}

/**
 * Plugin that checks rate limiting before each LLM call.
 * Registers at pre-llm, priority 20.
 */
export function createRateLimitPlugin(): Plugin {
  const check: CheckpointHook['check'] = (ctx: unknown) => {
    const c = ctx as AgentContext;
    if (!c.controls.rateLimiter) return { action: 'continue' };
    const rateLimitKey = `llm:${c.identity.sessionId}`;
    const rateLimitConfig = { maxRequests: 60, windowMs: 60_000 };
    if (!c.controls.rateLimiter.check(rateLimitKey, rateLimitConfig)) {
      return { action: 'block', reason: 'rate_limit_exceeded' };
    }
    c.controls.rateLimiter.consume(rateLimitKey, rateLimitConfig);
    return { action: 'continue' };
  };

  return {
    name: 'builtin:rate-limit',
    enabled: true,
    checkpointHooks: [{ name: 'rate-limit-check', phase: 'pre-llm', priority: 20, check }],
  };
}

// ============================================================
// Post-LLM Checkpoints (quality gate, circuit breaker)
// ============================================================

/**
 * Plugin that runs the quality gate after each LLM response.
 * Registers at post-llm, priority 10.
 */
export function createQualityGatePlugin(): Plugin {
  const check: CheckpointHook['check'] = (ctx: unknown, state: unknown, ...args: unknown[]) => {
    const c = ctx as AgentContext;
    const s = state as AgentState;
    if (!c.memory.qualityGate) return { action: 'continue' };
    const response = args[0] as
      | { content?: string | null; toolCalls?: unknown[]; finishReason?: string; usage?: unknown }
      | undefined;
    if (!response?.content) return { action: 'continue' };
    const gateResult = c.memory.qualityGate.check(response.content, s);
    if (!gateResult.passed) {
      s.messages.push({
        role: 'user',
        content: `[System] ${gateResult.feedback ?? 'Your last response had quality issues. Please try again.'}`,
      });
      s.step++;
      return { action: 'block', reason: 'quality_gate_retry' };
    }
    return { action: 'continue' };
  };

  return {
    name: 'builtin:quality-gate',
    enabled: true,
    checkpointHooks: [{ name: 'quality-gate-check', phase: 'post-llm', priority: 10, check }],
  };
}

/**
 * Plugin that records success on the circuit breaker after each LLM response.
 * Registers at post-llm, priority 20.
 */
export function createCircuitBreakerPlugin(): Plugin {
  const check: CheckpointHook['check'] = (ctx: unknown) => {
    const c = ctx as AgentContext;
    c.resilience.circuitBreaker?.recordSuccess();
    return { action: 'continue' };
  };

  return {
    name: 'builtin:circuit-breaker',
    enabled: true,
    checkpointHooks: [{ name: 'circuit-breaker-record', phase: 'post-llm', priority: 20, check }],
  };
}
